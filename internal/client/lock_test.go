package client

import (
	"testing"
)

func TestAcquireWatcherLock_SingletonPerSession(t *testing.T) {
	dir := t.TempDir()

	// First acquisition succeeds and holds the lock.
	f1, ok, err := AcquireWatcherLock(dir, "my-session")
	if err != nil {
		t.Fatalf("first acquire: unexpected error: %v", err)
	}
	if !ok || f1 == nil {
		t.Fatalf("first acquire: expected to hold the lock, got ok=%v f=%v", ok, f1)
	}

	// A second acquisition for the same session must fail while the first holds it.
	f2, ok, err := AcquireWatcherLock(dir, "my-session")
	if err != nil {
		t.Fatalf("second acquire: unexpected error: %v", err)
	}
	if ok {
		if f2 != nil {
			f2.Close()
		}
		t.Fatalf("second acquire: expected the lock to be held, but it was granted")
	}

	// A different session name is independently lockable.
	fOther, ok, err := AcquireWatcherLock(dir, "other-session")
	if err != nil || !ok {
		t.Fatalf("other session acquire: expected success, got ok=%v err=%v", ok, err)
	}
	fOther.Close()

	// Releasing the first lock lets the session be re-acquired (mirrors a crashed
	// watcher freeing the lock so `devsesh start` can respawn one).
	f1.Close()
	f3, ok, err := AcquireWatcherLock(dir, "my-session")
	if err != nil || !ok {
		t.Fatalf("re-acquire after release: expected success, got ok=%v err=%v", ok, err)
	}
	f3.Close()
}
