package util

import (
	"sync"
	"sync/atomic"
	"time"
)

type Debouncer struct {
	mu     sync.Mutex
	timer  *time.Timer
	delay  time.Duration
	fn     func()
	stopCh chan struct{}
}

func NewDebouncer(delay time.Duration, fn func()) *Debouncer {
	d := &Debouncer{
		delay:  delay,
		fn:     fn,
		stopCh: make(chan struct{}),
	}
	return d
}

func (d *Debouncer) Call() {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.timer != nil {
		d.timer.Stop()
	}

	d.timer = time.AfterFunc(d.delay, func() {
		d.mu.Lock()
		defer d.mu.Unlock()
		d.fn()
	})
}

func (d *Debouncer) Stop() {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.timer != nil {
		d.timer.Stop()
		d.timer = nil
	}
	close(d.stopCh)
}

// Throttle limits calls to at most once per interval using a polling actor.
// Call() sets an atomic flag that the actor polls at a granularity of
// interval/10. The first poll after a Call() with at least one full interval
// elapsed fires the callback immediately (leading edge). Calls within the
// interval are coalesced into a trailing call at the next interval boundary,
// ensuring no changes are silently dropped.
type Throttle struct {
	pending  atomic.Bool
	stopCh   chan struct{}
	doneCh   chan struct{}
	fn       func()
	interval time.Duration
}

// NewThrottle creates a Throttle that invokes fn at most once per interval.
// It spawns an actor goroutine that polls the pending flag.
func NewThrottle(interval time.Duration, fn func()) *Throttle {
	t := &Throttle{
		stopCh:   make(chan struct{}),
		doneCh:   make(chan struct{}),
		fn:       fn,
		interval: interval,
	}
	go t.actor()
	return t
}

// Call signals the Throttle that a change has occurred. Non-blocking.
func (t *Throttle) Call() {
	t.pending.Store(true)
}

// Stop flushes any pending trailing call and shuts the actor down.
// Blocks until the actor exits.
func (t *Throttle) Stop() {
	close(t.stopCh)
	<-t.doneCh
}

// actor is the main goroutine that polls the pending flag.
// It fires at most once per interval: immediately on the first poll
// after an interval has elapsed (leading edge), or at the interval
// boundary for coalesced calls (trailing edge).
func (t *Throttle) actor() {
	var lastFired time.Time
	pollInterval := t.interval / 10
	if pollInterval < 5*time.Millisecond {
		pollInterval = 5 * time.Millisecond
	}

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	defer close(t.doneCh)

	for {
		select {
		case <-t.stopCh:
			if t.pending.Swap(false) {
				t.fn()
			}
			return
		case <-ticker.C:
			now := time.Now()
			if now.Sub(lastFired) >= t.interval {
				if t.pending.Swap(false) {
					t.fn()
					lastFired = now
				}
			}
		}
	}
}
