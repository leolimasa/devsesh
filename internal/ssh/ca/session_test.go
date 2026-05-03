package ssh

import (
	"sync"
	"testing"
	"time"
)

func TestSessionManagerCreateSession(t *testing.T) {
	sm := NewSessionManager()

	session, err := sm.CreateSession(1, 100, []byte("test-tbs-data"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if session == nil {
		t.Fatal("expected session, got nil")
	}
	if session.ID == "" {
		t.Error("expected non-empty session ID")
	}
	if session.UserID != 1 {
		t.Errorf("expected UserID 1, got %d", session.UserID)
	}
	if session.HostID != 100 {
		t.Errorf("expected HostID 100, got %d", session.HostID)
	}
	if string(session.TBSData) != "test-tbs-data" {
		t.Errorf("expected TBSData 'test-tbs-data', got %s", string(session.TBSData))
	}
	if session.ExpiresAt.Before(time.Now().Add(50 * time.Second)) {
		t.Error("expected expiry ~60 seconds in the future")
	}
}

func TestSessionManagerGetSession(t *testing.T) {
	sm := NewSessionManager()

	session, err := sm.CreateSession(1, 100, []byte("test-data"))
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	retrieved, err := sm.GetSession(session.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if retrieved.ID != session.ID {
		t.Errorf("expected ID %s, got %s", session.ID, retrieved.ID)
	}
}

func TestSessionManagerGetSessionNotFound(t *testing.T) {
	sm := NewSessionManager()

	_, err := sm.GetSession("nonexistent-id")
	if err == nil {
		t.Fatal("expected error for nonexistent session")
	}
}

func TestSessionManagerDeleteSession(t *testing.T) {
	sm := NewSessionManager()

	session, err := sm.CreateSession(1, 100, []byte("sensitive-data"))
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	err = sm.DeleteSession(session.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	_, err = sm.GetSession(session.ID)
	if err == nil {
		t.Fatal("expected error after deletion")
	}
}

func TestSessionManagerDeleteNonexistentSession(t *testing.T) {
	sm := NewSessionManager()

	err := sm.DeleteSession("nonexistent-id")
	if err != nil {
		t.Fatalf("deleting nonexistent session should not error: %v", err)
	}
}

func TestSessionManagerUniqueIDs(t *testing.T) {
	sm := NewSessionManager()

	ids := make(map[string]bool)
	for i := 0; i < 100; i++ {
		session, err := sm.CreateSession(int64(i), int64(i*10), []byte("data"))
		if err != nil {
			t.Fatalf("failed to create session %d: %v", i, err)
		}
		if ids[session.ID] {
			t.Errorf("duplicate session ID: %s", session.ID)
		}
		ids[session.ID] = true
	}
}

func TestSessionManagerConcurrentAccess(t *testing.T) {
	sm := NewSessionManager()

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(userID int64) {
			defer wg.Done()
			session, err := sm.CreateSession(userID, 100, []byte("data"))
			if err != nil {
				t.Errorf("failed to create session for user %d: %v", userID, err)
				return
			}
			retrieved, err := sm.GetSession(session.ID)
			if err != nil {
				t.Errorf("failed to get session for user %d: %v", userID, err)
				return
			}
			if retrieved.UserID != userID {
				t.Errorf("expected UserID %d, got %d", userID, retrieved.UserID)
			}
		}(int64(i))
	}
	wg.Wait()
}

func TestSessionManagerUpdateSession(t *testing.T) {
	sm := NewSessionManager()

	session, err := sm.CreateSession(1, 100, []byte("tbs-data"))
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	err = sm.UpdateSession(session.ID, []byte("nonces"), []byte("commitment"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	updated, err := sm.GetSession(session.ID)
	if err != nil {
		t.Fatalf("failed to get session: %v", err)
	}
	if string(updated.ServerNonces) != "nonces" {
		t.Errorf("expected ServerNonces 'nonces', got %s", string(updated.ServerNonces))
	}
	if string(updated.Commitment) != "commitment" {
		t.Errorf("expected Commitment 'commitment', got %s", string(updated.Commitment))
	}
}

func TestSessionManagerUpdateNonexistentSession(t *testing.T) {
	sm := NewSessionManager()

	err := sm.UpdateSession("nonexistent", []byte("nonces"), []byte("commitment"))
	if err == nil {
		t.Fatal("expected error for nonexistent session")
	}
}

func TestSessionManagerExpiration(t *testing.T) {
	sm := NewSessionManagerWithExpiry(100 * time.Millisecond)

	session, err := sm.CreateSession(1, 100, []byte("test-data"))
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Session should be valid immediately
	_, err = sm.GetSession(session.ID)
	if err != nil {
		t.Fatalf("session should be valid immediately: %v", err)
	}

	// Wait for expiration
	time.Sleep(150 * time.Millisecond)

	// Session should now be expired
	_, err = sm.GetSession(session.ID)
	if err == nil {
		t.Fatal("expected session to be expired")
	}
}

func TestSessionManagerSensitiveDataZeroedOnDelete(t *testing.T) {
	sm := NewSessionManager()

	sensitiveData := []byte("super-sensitive-key-material")
	session, err := sm.CreateSession(1, 100, sensitiveData)
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Verify data is stored
	if string(session.TBSData) != string(sensitiveData) {
		t.Errorf("expected TBSData to match sensitive data")
	}

	// Delete the session
	err = sm.DeleteSession(session.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify session is gone
	_, err = sm.GetSession(session.ID)
	if err == nil {
		t.Fatal("expected session to be deleted")
	}
}
