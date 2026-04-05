package db

import (
	"database/sql"
	"os"
	"testing"
	"time"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	f, err := os.CreateTemp("", "devsesh-test-*.db")
	if err != nil {
		t.Fatalf("create temp db: %v", err)
	}
	t.Cleanup(func() { os.Remove(f.Name()) })

	db, err := sql.Open("sqlite", f.Name())
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	return db
}

func TestRunMigrationsIdempotent(t *testing.T) {
	db := openTestDB(t)

	applied, err := RunMigrations(db)
	if err != nil {
		t.Fatalf("first migration run: %v", err)
	}
	if len(applied) != 6 {
		t.Errorf("expected 6 migrations applied, got %d", len(applied))
	}

	applied, err = RunMigrations(db)
	if err != nil {
		t.Fatalf("second migration run: %v", err)
	}
	if len(applied) != 0 {
		t.Errorf("expected 0 migrations on second run, got %d", len(applied))
	}
}

func TestResolveJWTSecretAutoGenerate(t *testing.T) {
	db := openTestDB(t)
	_, _ = RunMigrations(db)

	secret, err := ResolveJWTSecret(db, "")
	if err != nil {
		t.Fatalf("resolve jwt secret: %v", err)
	}
	if len(secret) != 64 {
		t.Errorf("expected 64 char hex secret, got %d chars", len(secret))
	}

	stored, err := GetConfigValue(db, "jwt_secret")
	if err != nil {
		t.Fatalf("get stored secret: %v", err)
	}
	if stored != secret {
		t.Error("stored secret does not match returned secret")
	}
}

func TestResolveJWTSecretEnvTakesPrecedence(t *testing.T) {
	db := openTestDB(t)
	_, _ = RunMigrations(db)

	secret, err := ResolveJWTSecret(db, "myenvsecret")
	if err != nil {
		t.Fatalf("resolve jwt secret: %v", err)
	}
	if secret != "myenvsecret" {
		t.Errorf("expected 'myenvsecret', got '%s'", secret)
	}
}

func TestUserCRUD(t *testing.T) {
	db := openTestDB(t)
	_, _ = RunMigrations(db)

	id, err := CreateUser(db, "test@example.com")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	if id == 0 {
		t.Error("expected non-zero user id")
	}

	count, err := CountUsers(db)
	if err != nil {
		t.Fatalf("count users: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 user, got %d", count)
	}

	u, err := GetUserByEmail(db, "test@example.com")
	if err != nil {
		t.Fatalf("get user: %v", err)
	}
	if u == nil {
		t.Fatal("expected user, got nil")
	}
	if u.Email != "test@example.com" {
		t.Errorf("expected email 'test@example.com', got '%s'", u.Email)
	}

	u, err = GetUserByEmail(db, "nonexistent@example.com")
	if err != nil {
		t.Fatalf("get nonexistent user: %v", err)
	}
	if u != nil {
		t.Error("expected nil for nonexistent user")
	}
}

func TestPairingCodeCRUD(t *testing.T) {
	db := openTestDB(t)
	_, _ = RunMigrations(db)

	userID, _ := CreateUser(db, "pair@example.com")
	expiresAt := time.Now().Add(5 * time.Minute)

	err := CreatePairingCode(db, "ABC123", expiresAt)
	if err != nil {
		t.Fatalf("create pairing code: %v", err)
	}

	pc, err := GetPairingCode(db, "ABC123")
	if err != nil {
		t.Fatalf("get pairing code: %v", err)
	}
	if pc == nil {
		t.Fatal("expected pairing code, got nil")
	}
	if pc.UserID != nil {
		t.Errorf("expected user id nil, got %d", *pc.UserID)
	}
	if pc.Approved {
		t.Error("expected approved to be false")
	}
	if pc.Used {
		t.Error("expected used to be false")
	}

	err = ApprovePairingCode(db, "ABC123", userID)
	if err != nil {
		t.Fatalf("approve pairing code: %v", err)
	}

	pc, _ = GetPairingCode(db, "ABC123")
	if !pc.Approved {
		t.Error("expected approved to be true after approval")
	}
	if pc.UserID == nil || *pc.UserID != userID {
		t.Errorf("expected user id %d, got %v", userID, pc.UserID)
	}

	err = MarkPairingCodeUsed(db, "ABC123")
	if err != nil {
		t.Fatalf("mark pairing code used: %v", err)
	}

	pc, _ = GetPairingCode(db, "ABC123")
	if !pc.Used {
		t.Error("expected used to be true after marking")
	}
}

func TestSessionCRUD(t *testing.T) {
	db := openTestDB(t)
	_, _ = RunMigrations(db)

	userID, _ := CreateUser(db, "session@example.com")
	now := time.Now()
	meta := `{"key":"value"}`

	s := Session{
		ID:        "test-session-uuid",
		UserID:    userID,
		Name:      "Test Session",
		Hostname:  "localhost",
		StartedAt: now,
		Metadata:  &meta,
	}

	err := CreateSession(db, s)
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	got, err := GetSession(db, "test-session-uuid")
	if err != nil {
		t.Fatalf("get session: %v", err)
	}
	if got == nil {
		t.Fatal("expected session, got nil")
	}
	if got.Name != "Test Session" {
		t.Errorf("expected name 'Test Session', got '%s'", got.Name)
	}

	err = UpdateSessionPing(db, "test-session-uuid", now.Add(time.Minute))
	if err != nil {
		t.Fatalf("update session ping: %v", err)
	}

	err = EndSession(db, "test-session-uuid", now.Add(2*time.Minute))
	if err != nil {
		t.Fatalf("end session: %v", err)
	}

	newMeta := `{"key":"updated"}`
	err = UpdateSessionMeta(db, "test-session-uuid", newMeta)
	if err != nil {
		t.Fatalf("update session meta: %v", err)
	}

	sessions, err := GetSessionsByUserID(db, userID)
	if err != nil {
		t.Fatalf("get sessions by user: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}
	if *sessions[0].Metadata != newMeta {
		t.Errorf("expected metadata '%s', got '%s'", newMeta, *sessions[0].Metadata)
	}
}

func TestDeleteExpiredPairingCodes(t *testing.T) {
	db := openTestDB(t)
	_, _ = RunMigrations(db)

	_, _ = CreateUser(db, "expired@example.com")

	err := CreatePairingCode(db, "EXPIRED1", time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatalf("create expired pairing code: %v", err)
	}

	err = CreatePairingCode(db, "VALID1", time.Now().Add(time.Hour))
	if err != nil {
		t.Fatalf("create valid pairing code: %v", err)
	}

	err = DeleteExpiredPairingCodes(db)
	if err != nil {
		t.Fatalf("delete expired: %v", err)
	}

	pc, _ := GetPairingCode(db, "EXPIRED1")
	if pc != nil {
		t.Error("expected expired pairing code to be deleted")
	}

	pc, _ = GetPairingCode(db, "VALID1")
	if pc == nil {
		t.Error("expected valid pairing code to still exist")
	}
}
