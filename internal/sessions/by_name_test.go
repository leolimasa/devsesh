package sessions

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/leolimasa/devsesh/internal/ctxutil"
	"github.com/leolimasa/devsesh/internal/db"
)

// byNameReq builds a GET request whose context carries the userID and hostID
// that the jwt middleware would normally populate.
func byNameReq(name string, userID, hostID int64) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/sessions/by-name?name="+name, nil)
	ctx := req.Context()
	if userID != 0 {
		ctx = context.WithValue(ctx, ctxutil.ContextKeyUserID, userID)
	}
	if hostID != 0 {
		ctx = context.WithValue(ctx, ctxutil.ContextKeyHostID, hostID)
	}
	return req.WithContext(ctx)
}

func TestGetSessionByNameHandler(t *testing.T) {
	dbConn := setupTestDB(t)
	userID, _ := db.CreateUser(dbConn, "byname@example.com")
	now := time.Now()
	meta := `{"status":"editing"}`

	// A session for (host 1, "work") and a same-named one on host 2.
	if err := db.CreateSession(dbConn, db.Session{
		ID: "s-host1", UserID: userID, HostID: 1, Name: "work", StartedAt: now, Metadata: &meta,
	}); err != nil {
		t.Fatalf("create host1 session: %v", err)
	}
	if err := db.CreateSession(dbConn, db.Session{
		ID: "s-host2", UserID: userID, HostID: 2, Name: "work", StartedAt: now,
	}); err != nil {
		t.Fatalf("create host2 session: %v", err)
	}

	t.Run("returns the session for the caller's host", func(t *testing.T) {
		w := httptest.NewRecorder()
		GetSessionByNameHandler(dbConn)(w, byNameReq("work", userID, 1))
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
		var s db.Session
		if err := json.NewDecoder(w.Body).Decode(&s); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if s.ID != "s-host1" {
			t.Fatalf("expected s-host1 (host scoping), got %s", s.ID)
		}
	})

	t.Run("host 2 gets its own session, not host 1's", func(t *testing.T) {
		w := httptest.NewRecorder()
		GetSessionByNameHandler(dbConn)(w, byNameReq("work", userID, 2))
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
		var s db.Session
		_ = json.NewDecoder(w.Body).Decode(&s)
		if s.ID != "s-host2" {
			t.Fatalf("expected s-host2, got %s", s.ID)
		}
	})

	t.Run("404 for an unknown name", func(t *testing.T) {
		w := httptest.NewRecorder()
		GetSessionByNameHandler(dbConn)(w, byNameReq("nope", userID, 1))
		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", w.Code)
		}
	})

	t.Run("400 when name is missing", func(t *testing.T) {
		w := httptest.NewRecorder()
		GetSessionByNameHandler(dbConn)(w, byNameReq("", userID, 1))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", w.Code)
		}
	})

	t.Run("another user cannot read this host's session", func(t *testing.T) {
		otherID, _ := db.CreateUser(dbConn, "other@example.com")
		w := httptest.NewRecorder()
		GetSessionByNameHandler(dbConn)(w, byNameReq("work", otherID, 1))
		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for cross-user, got %d", w.Code)
		}
	})
}
