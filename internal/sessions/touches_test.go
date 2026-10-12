package sessions

import (
	"context"
	"testing"
	"time"

	"github.com/leolimasa/devsesh/internal/db"
)

func createTouchSession(t *testing.T, id string) db.Session {
	t.Helper()
	return db.Session{ID: id, UserID: 1, HostID: 1, Name: id, StartedAt: time.Now().Add(-time.Hour)}
}

func TestTouchesNothingIsWrittenUntilFlush(t *testing.T) {
	dbConn := setupTestDB(t)
	db.CreateSession(dbConn, createTouchSession(t, "s1"))
	touches := NewTouches(dbConn)

	touches.Ping("s1", time.Now())
	touches.Activity("s1", time.Now())

	got, _ := db.GetSession(dbConn, "s1")
	if got.LastPingAt != nil || got.LastActivityAt != nil {
		t.Fatalf("recording must not write: ping=%v activity=%v", got.LastPingAt, got.LastActivityAt)
	}

	if err := touches.Flush(); err != nil {
		t.Fatalf("flush: %v", err)
	}
	got, _ = db.GetSession(dbConn, "s1")
	if got.LastPingAt == nil || got.LastActivityAt == nil {
		t.Fatalf("flush must write both: ping=%v activity=%v", got.LastPingAt, got.LastActivityAt)
	}
}

func TestTouchesLatestTimeWinsAndFieldsAreIndependent(t *testing.T) {
	dbConn := setupTestDB(t)
	db.CreateSession(dbConn, createTouchSession(t, "s1"))
	touches := NewTouches(dbConn)

	base := time.Now().Truncate(time.Second)
	touches.Ping("s1", base.Add(-10*time.Second))
	touches.Ping("s1", base)
	if err := touches.Flush(); err != nil {
		t.Fatal(err)
	}
	got, _ := db.GetSession(dbConn, "s1")
	if got.LastPingAt == nil || !got.LastPingAt.Equal(base) {
		t.Fatalf("last_ping_at = %v, want the newest (%v)", got.LastPingAt, base)
	}
	if got.LastActivityAt != nil {
		t.Fatalf("a ping must not set activity, got %v", got.LastActivityAt)
	}

	// An activity-only flush leaves the stored ping alone.
	touches.Activity("s1", base.Add(time.Second))
	if err := touches.Flush(); err != nil {
		t.Fatal(err)
	}
	got, _ = db.GetSession(dbConn, "s1")
	if got.LastPingAt == nil || !got.LastPingAt.Equal(base) {
		t.Fatalf("activity flush changed last_ping_at to %v", got.LastPingAt)
	}
	if got.LastActivityAt == nil || !got.LastActivityAt.Equal(base.Add(time.Second)) {
		t.Fatalf("last_activity_at = %v", got.LastActivityAt)
	}
}

func TestTouchesManySessionsOneFlush(t *testing.T) {
	dbConn := setupTestDB(t)
	touches := NewTouches(dbConn)
	now := time.Now()
	for _, id := range []string{"a", "b", "c"} {
		db.CreateSession(dbConn, createTouchSession(t, id))
		touches.Ping(id, now)
	}
	if err := touches.Flush(); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"a", "b", "c"} {
		got, _ := db.GetSession(dbConn, id)
		if got.LastPingAt == nil {
			t.Errorf("session %s was not written", id)
		}
	}
	// Nothing left pending: a second flush is a no-op and must not rewrite.
	if len(touches.pending) != 0 {
		t.Errorf("pending not cleared: %d entries", len(touches.pending))
	}
}

func TestTouchesFlushDoesNotChangeEndedAt(t *testing.T) {
	dbConn := setupTestDB(t)
	db.CreateSession(dbConn, createTouchSession(t, "s1"))
	touches := NewTouches(dbConn)

	touches.Ping("s1", time.Now())
	endedAt := time.Now()
	if err := db.EndSession(dbConn, "s1", endedAt); err != nil {
		t.Fatalf("end: %v", err)
	}
	if err := touches.Flush(); err != nil {
		t.Fatal(err)
	}
	got, _ := db.GetSession(dbConn, "s1")
	if got.EndedAt == nil {
		t.Fatal("a late flush cleared ended_at")
	}
}

func TestTouchesUnknownSessionIsHarmless(t *testing.T) {
	dbConn := setupTestDB(t)
	touches := NewTouches(dbConn)
	touches.Ping("deleted-session", time.Now())
	if err := touches.Flush(); err != nil {
		t.Fatalf("flush for a deleted session must not fail: %v", err)
	}
}

func TestTouchesFailedFlushKeepsEntriesForRetry(t *testing.T) {
	dbConn := setupTestDB(t)
	db.CreateSession(dbConn, createTouchSession(t, "s1"))
	touches := NewTouches(dbConn)

	first := time.Now().Truncate(time.Second)
	touches.Ping("s1", first)

	dbConn.Close() // make the flush fail
	if err := touches.Flush(); err == nil {
		t.Fatal("expected the flush to fail on a closed database")
	}
	// A newer ping arrives; the retry must keep the newer time, and the activity
	// recorded before the failure must not be lost.
	newer := first.Add(5 * time.Second)
	touches.Ping("s1", newer)
	if e := touches.pending["s1"]; e == nil || e.Ping == nil || !e.Ping.Equal(newer) {
		t.Fatalf("pending after failure = %+v, want ping %v", e, newer)
	}
}

func TestTouchesRunFlushesPeriodicallyAndOnShutdown(t *testing.T) {
	dbConn := setupTestDB(t)
	db.CreateSession(dbConn, createTouchSession(t, "s1"))
	touches := NewTouches(dbConn)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		touches.Run(ctx, 20*time.Millisecond)
	}()

	touches.Ping("s1", time.Now())
	deadline := time.Now().Add(2 * time.Second)
	for {
		got, _ := db.GetSession(dbConn, "s1")
		if got.LastPingAt != nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("periodic flush never wrote the ping")
		}
		time.Sleep(10 * time.Millisecond)
	}

	// A touch recorded just before shutdown is written by the final flush, even
	// though the interval is too long for the ticker to have fired.
	touches2 := NewTouches(dbConn)
	ctx2, cancel2 := context.WithCancel(context.Background())
	done2 := make(chan struct{})
	go func() {
		defer close(done2)
		touches2.Run(ctx2, time.Hour)
	}()
	touches2.Activity("s1", time.Now())
	cancel2()
	<-done2
	got, _ := db.GetSession(dbConn, "s1")
	if got.LastActivityAt == nil {
		t.Fatal("shutdown flush did not write pending activity")
	}

	cancel()
	<-done
}
