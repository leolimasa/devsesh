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
