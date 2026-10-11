package client

import (
	"errors"
	"testing"
)

func TestChangeFilter_IgnoresUnchangedScreen(t *testing.T) {
	screen := "a"
	calls := 0
	f := NewChangeFilter(func() (string, error) { return screen, nil }, func() { calls++ })

	f()
	f()
	if calls != 0 {
		t.Fatalf("redraw of an unchanged screen reported activity %d times", calls)
	}
}

func TestChangeFilter_ReportsChangedScreen(t *testing.T) {
	screen := "a"
	calls := 0
	f := NewChangeFilter(func() (string, error) { return screen, nil }, func() { calls++ })

	screen = "b"
	f()
	if calls != 1 {
		t.Fatalf("expected 1 report after a change, got %d", calls)
	}
	f() // same screen again
	if calls != 1 {
		t.Fatalf("expected no further report for the same screen, got %d", calls)
	}
	screen = "c"
	f()
	if calls != 2 {
		t.Fatalf("expected 2 reports, got %d", calls)
	}
}

func TestChangeFilter_ReportsWhenFingerprintFails(t *testing.T) {
	fail := false
	calls := 0
	f := NewChangeFilter(func() (string, error) {
		if fail {
			return "", errors.New("tmux gone")
		}
		return "a", nil
	}, func() { calls++ })

	fail = true
	f()
	if calls != 1 {
		t.Fatalf("expected activity to be reported when the fingerprint fails, got %d", calls)
	}
}
