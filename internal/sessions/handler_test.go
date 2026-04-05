package sessions

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/leobeosab/devsesh/internal/db"
	_ "modernc.org/sqlite"
)

func setupTestDB(t *testing.T) *sql.DB {
	t.Helper()
	f, err := os.CreateTemp("", "devsesh-test-*.db")
	if err != nil {
		t.Fatalf("create temp db: %v", err)
	}
	t.Cleanup(func() { os.Remove(f.Name()) })

	dbConn, err := sql.Open("sqlite", f.Name())
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { dbConn.Close() })

	_, err = db.RunMigrations(dbConn)
	if err != nil {
		t.Fatalf("migrate: %v", err)
	}

	return dbConn
}

func TestHubBroadcast(t *testing.T) {
	hub := NewHub()

	var received []SessionUpdate
	done := make(chan struct{})

	send := make(chan []byte, 64)
	hub.clients[1] = map[*client]bool{
		{send: send, userID: 1}: true,
	}

	go func() {
		for msg := range send {
			var u SessionUpdate
			json.Unmarshal(msg, &u)
			received = append(received, u)
			if len(received) == 2 {
				close(done)
			}
		}
	}()

	hub.Broadcast(1, SessionUpdate{Event: "start", SessionID: "s1"})
	hub.Broadcast(1, SessionUpdate{Event: "ping", SessionID: "s1"})

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for messages")
	}

	if len(received) != 2 {
		t.Errorf("expected 2 messages, got %d", len(received))
	}
	if received[0].Event != "start" {
		t.Errorf("expected first event 'start', got '%s'", received[0].Event)
	}
}

func TestHubUnregister(t *testing.T) {
	hub := NewHub()

	send := make(chan []byte, 64)
	c := &client{
		send:   send,
		userID: 1,
	}

	hub.Register(c)
	hub.Unregister(c)

	_, ok := <-send
	if ok {
		t.Error("expected send channel to be closed")
	}

	hub.mu.RLock()
	_, exists := hub.clients[1]
	hub.mu.RUnlock()
	if exists {
		t.Error("expected client to be removed from hub")
	}
}

func TestStartHandler(t *testing.T) {
	dbConn := setupTestDB(t)
	hub := NewHub()
	userID := int64(1)

	handler := StartHandler(dbConn, hub)

	body := `{"name":"Test Session","hostname":"localhost","start_time":"2026-01-01T00:00:00Z"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sessions/session-1/start", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(context.WithValue(req.Context(), ContextKeyUserID, userID))
	req.SetPathValue("session_id", "session-1")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected status 201, got %d", w.Code)
	}

	s, _ := db.GetSession(dbConn, "session-1")
	if s == nil {
		t.Fatal("expected session to be created")
	}
	if s.Name != "Test Session" {
		t.Errorf("expected name 'Test Session', got '%s'", s.Name)
	}
}

func TestPingHandler(t *testing.T) {
	dbConn := setupTestDB(t)
	hub := NewHub()
	userID := int64(1)

	now := time.Now()
	s := db.Session{
		ID:        "ping-session",
		UserID:    userID,
		Name:      "Ping Test",
		Hostname:  "localhost",
		StartedAt: now,
	}
	db.CreateSession(dbConn, s)

	handler := PingHandler(dbConn, hub)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sessions/ping-session/ping", nil)
	req = req.WithContext(context.WithValue(req.Context(), ContextKeySession, &s))
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	updated, _ := db.GetSession(dbConn, "ping-session")
	if updated.LastPingAt == nil {
		t.Error("expected last_ping_at to be set")
	}
}

func TestEndHandler(t *testing.T) {
	dbConn := setupTestDB(t)
	hub := NewHub()
	userID := int64(1)

	now := time.Now()
	s := db.Session{
		ID:        "end-session",
		UserID:    userID,
		Name:      "End Test",
		Hostname:  "localhost",
		StartedAt: now,
	}
	db.CreateSession(dbConn, s)

	handler := EndHandler(dbConn, hub)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sessions/end-session/end", nil)
	req = req.WithContext(context.WithValue(req.Context(), ContextKeySession, &s))
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	updated, _ := db.GetSession(dbConn, "end-session")
	if updated.EndedAt == nil {
		t.Error("expected ended_at to be set")
	}
}

func TestMetaHandler(t *testing.T) {
	dbConn := setupTestDB(t)
	hub := NewHub()
	userID := int64(1)

	now := time.Now()
	s := db.Session{
		ID:        "meta-session",
		UserID:    userID,
		Name:      "Meta Test",
		Hostname:  "localhost",
		StartedAt: now,
	}
	db.CreateSession(dbConn, s)

	handler := MetaHandler(dbConn, hub)

	body := `{"branch":"main","project":"myapp"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sessions/meta-session/meta", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(context.WithValue(req.Context(), ContextKeySession, &s))
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	updated, _ := db.GetSession(dbConn, "meta-session")
	if updated.Metadata == nil {
		t.Fatal("expected metadata to be set")
	}
	if !strings.Contains(*updated.Metadata, "main") {
		t.Errorf("expected metadata to contain 'main', got %s", *updated.Metadata)
	}
}

func TestListHandler(t *testing.T) {
	dbConn := setupTestDB(t)
	userID := int64(1)

	now := time.Now()
	db.CreateSession(dbConn, db.Session{
		ID:        "list-1",
		UserID:    userID,
		Name:      "Session 1",
		Hostname:  "localhost",
		StartedAt: now,
	})
	db.CreateSession(dbConn, db.Session{
		ID:        "list-2",
		UserID:    userID,
		Name:      "Session 2",
		Hostname:  "localhost",
		StartedAt: now.Add(time.Hour),
	})

	handler := ListHandler(dbConn)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/sessions", nil)
	req = req.WithContext(context.WithValue(req.Context(), ContextKeyUserID, userID))
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var sessions []db.Session
	if err := json.NewDecoder(w.Body).Decode(&sessions); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(sessions) != 2 {
		t.Errorf("expected 2 sessions, got %d", len(sessions))
	}
}

func TestUserIDFromContext(t *testing.T) {
	ctx := context.WithValue(context.Background(), ContextKeyUserID, int64(42))
	id, ok := UserIDFromContext(ctx)
	if !ok || id != 42 {
		t.Errorf("expected userID 42, got %d, ok=%v", id, ok)
	}
}

func TestSessionFromContext(t *testing.T) {
	s := &db.Session{ID: "test"}
	ctx := context.WithValue(context.Background(), ContextKeySession, s)
	got, ok := SessionFromContext(ctx)
	if !ok || got.ID != "test" {
		t.Errorf("expected session 'test', got %v, ok=%v", got, ok)
	}
}
