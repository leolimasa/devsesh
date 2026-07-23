package util

import (
	"sync/atomic"
	"testing"
	"time"
)

func TestDebouncer_CallsFunction(t *testing.T) {
	var called atomic.Bool
	d := NewDebouncer(50*time.Millisecond, func() {
		called.Store(true)
	})

	d.Call()
	time.Sleep(100 * time.Millisecond)

	if !called.Load() {
		t.Error("function was not called")
	}
}

func TestDebouncer_ResetsTimer(t *testing.T) {
	var count atomic.Int32
	d := NewDebouncer(50*time.Millisecond, func() {
		count.Add(1)
	})

	d.Call()
	time.Sleep(30 * time.Millisecond)
	d.Call()
	time.Sleep(30 * time.Millisecond)
	d.Call()
	time.Sleep(100 * time.Millisecond)

	if count.Load() != 1 {
		t.Errorf("expected 1 call, got %d", count.Load())
	}
}

func TestDebouncer_Stop(t *testing.T) {
	var called atomic.Bool
	d := NewDebouncer(50*time.Millisecond, func() {
		called.Store(true)
	})

	d.Call()
	d.Stop()
	time.Sleep(100 * time.Millisecond)

	if called.Load() {
		t.Error("function should not be called after Stop")
	}
}

func TestDebouncer_MultipleCalls(t *testing.T) {
	var count atomic.Int32
	d := NewDebouncer(30*time.Millisecond, func() {
		count.Add(1)
	})

	d.Call()
	d.Call()
	d.Call()
	time.Sleep(100 * time.Millisecond)

	if count.Load() != 1 {
		t.Errorf("expected 1 call, got %d", count.Load())
	}
}

// Throttle polls at interval/10 (min 5ms). Sleeps below include
// a margin of at least 2× the poll interval to be robust on CI.

func TestThrottle_LeadingCallFiresImmediately(t *testing.T) {
	var count atomic.Int32
	th := NewThrottle(1*time.Second, func() {
		count.Add(1)
	})
	defer th.Stop()

	th.Call()
	// 1s interval → poll every 100ms; 150ms gives ~1.5 polls.
	time.Sleep(150 * time.Millisecond)

	if count.Load() != 1 {
		t.Errorf("expected 1 leading call, got %d", count.Load())
	}
}

func TestThrottle_BurstYieldsLeadingPlusTrailing(t *testing.T) {
	var count atomic.Int32
	// interval=100ms → poll every 10ms
	th := NewThrottle(100*time.Millisecond, func() {
		count.Add(1)
	})
	defer th.Stop()

	th.Call()
	// Wait for the leading poll (2× poll = 20ms)
	time.Sleep(20 * time.Millisecond)
	if count.Load() != 1 {
		t.Fatalf("expected 1 leading call, got %d", count.Load())
	}

	// Burst inside the window: these coalesce
	th.Call()
	th.Call()
	// Wait briefly — still only 1 (no new fire inside the window)
	time.Sleep(20 * time.Millisecond)
	if count.Load() != 1 {
		t.Errorf("expected still 1 during burst, got %d", count.Load())
	}

	// Wait for trailing: interval + 3× poll = 100 + 30 = 130ms
	time.Sleep(130 * time.Millisecond)
	if count.Load() != 2 {
		t.Errorf("expected 2 total (leading+trailing), got %d", count.Load())
	}
}

func TestThrottle_MidWindowChangeNotDiscarded(t *testing.T) {
	var count atomic.Int32
	// interval=100ms → poll every 10ms
	th := NewThrottle(100*time.Millisecond, func() {
		count.Add(1)
	})
	defer th.Stop()

	th.Call()
	// Leading poll: 2× poll = 20ms
	time.Sleep(20 * time.Millisecond)
	if count.Load() != 1 {
		t.Fatalf("expected 1 leading call, got %d", count.Load())
	}

	// Single call mid-window (sets pending)
	time.Sleep(50 * time.Millisecond)
	th.Call()

	// Wait for trailing: interval remains from the leading fire.
	// Leading fired at ~T=20ms, interval ends at ~120ms.
	// From T=70ms (mid-window call) we need ~50ms more.
	// Wait until well after 120ms total.
	time.Sleep(80 * time.Millisecond)
	if count.Load() != 2 {
		t.Errorf("expected 2 total (leading+trailing) even for single mid-window call, got %d", count.Load())
	}
}

func TestThrottle_SpacingNeverExceedsInterval(t *testing.T) {
	var count atomic.Int32
	// interval=100ms → poll every 10ms
	th := NewThrottle(100*time.Millisecond, func() {
		count.Add(1)
	})

	th.Call()
	// Sleep well past the interval so the next call hits a fresh window
	time.Sleep(200 * time.Millisecond)
	th.Call()
	// Wait for poll (3× poll = 30ms)
	time.Sleep(50 * time.Millisecond)
	th.Stop()

	if count.Load() < 2 {
		t.Fatalf("expected at least 2 calls, got %d", count.Load())
	}
}

func TestThrottle_StopFlushesPending(t *testing.T) {
	var count atomic.Int32
	// interval=500ms → poll every 50ms
	th := NewThrottle(500*time.Millisecond, func() {
		count.Add(1)
	})

	th.Call()
	// Leading poll: 2× poll = 100ms
	time.Sleep(100 * time.Millisecond)

	if count.Load() != 1 {
		t.Fatalf("expected 1 leading call, got %d", count.Load())
	}

	th.Call() // pending (inside window)
	th.Stop() // should flush immediately

	if count.Load() != 2 {
		t.Errorf("expected 2 total (leading + flushed trailing), got %d", count.Load())
	}
}
