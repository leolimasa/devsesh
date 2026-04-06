package util

import (
	"sync"
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
