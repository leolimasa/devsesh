package db

import (
	"testing"
	"time"
)

func TestGetSessionByHostAndName(t *testing.T) {
	db := openTestDB(t)
	_, _ = RunMigrations(db)

	userID, _ := CreateUser(db, "reuse@example.com")
	base := time.Now()

	// No session yet -> nil, nil.
	got, err := GetSessionByHostAndName(db, 1, "work")
	if err != nil {
		t.Fatalf("lookup empty: %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil for missing session, got %+v", got)
	}

	meta := `{"status":"editing"}`
	if err := CreateSession(db, Session{
		ID: "s1", UserID: userID, HostID: 1, Name: "work", StartedAt: base, Metadata: &meta,
	}); err != nil {
		t.Fatalf("create s1: %v", err)
	}

	// Same name on a different host must NOT match host 1.
	if err := CreateSession(db, Session{
		ID: "s2", UserID: userID, HostID: 2, Name: "work", StartedAt: base,
	}); err != nil {
		t.Fatalf("create s2: %v", err)
	}

	got, err = GetSessionByHostAndName(db, 1, "work")
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if got == nil || got.ID != "s1" {
		t.Fatalf("expected s1 for (host 1, work), got %+v", got)
	}
	if got.Metadata == nil || *got.Metadata != meta {
		t.Fatalf("expected metadata carried through, got %v", got.Metadata)
	}

	// A different name on the same host does not match.
	got, err = GetSessionByHostAndName(db, 1, "other")
	if err != nil {
		t.Fatalf("lookup other: %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil for unknown name, got %+v", got)
	}
}

func TestGetSessionByHostAndNameReturnsMostRecent(t *testing.T) {
	db := openTestDB(t)
	_, _ = RunMigrations(db)

	userID, _ := CreateUser(db, "recent@example.com")
	base := time.Now()

	if err := CreateSession(db, Session{
		ID: "old", UserID: userID, HostID: 1, Name: "dev", StartedAt: base.Add(-time.Hour),
	}); err != nil {
		t.Fatalf("create old: %v", err)
	}
	if err := CreateSession(db, Session{
		ID: "new", UserID: userID, HostID: 1, Name: "dev", StartedAt: base,
	}); err != nil {
		t.Fatalf("create new: %v", err)
	}

	got, err := GetSessionByHostAndName(db, 1, "dev")
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if got == nil || got.ID != "new" {
		t.Fatalf("expected most recent 'new', got %+v", got)
	}
}

// A session revived under its original id (the reuse path) must come back
// online: CreateSession's upsert clears ended_at.
func TestReviveSessionClearsEndedAt(t *testing.T) {
	db := openTestDB(t)
	_, _ = RunMigrations(db)

	userID, _ := CreateUser(db, "revive@example.com")
	now := time.Now()

	if err := CreateSession(db, Session{
		ID: "r1", UserID: userID, HostID: 1, Name: "svc", StartedAt: now,
	}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := EndSession(db, "r1", now.Add(time.Minute)); err != nil {
		t.Fatalf("end: %v", err)
	}

	ended, err := GetSession(db, "r1")
	if err != nil {
		t.Fatalf("get ended: %v", err)
	}
	if ended.EndedAt == nil {
		t.Fatal("expected session to be ended before revive")
	}

	// Reuse: recreate under the same id.
	if err := CreateSession(db, Session{
		ID: "r1", UserID: userID, HostID: 1, Name: "svc", StartedAt: now,
	}); err != nil {
		t.Fatalf("revive: %v", err)
	}

	revived, err := GetSession(db, "r1")
	if err != nil {
		t.Fatalf("get revived: %v", err)
	}
	if revived.EndedAt != nil {
		t.Fatalf("expected ended_at cleared on revive, got %v", *revived.EndedAt)
	}
}
