package ssh

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/leolimasa/devsesh/internal/db"
	"github.com/leolimasa/devsesh/internal/sessions"
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

func mockJWTMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), sessions.ContextKeyUserID, int64(1))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func parseTime(s string) time.Time {
	t, _ := time.Parse("2006-01-02 15:04:05", s)
	return t
}

func TestConnectHandler(t *testing.T) {
	dbConn := setupTestDB(t)

	userID, _ := db.CreateUser(dbConn, "ssh@test.com")
	now := parseTime("2026-01-01 00:00:00")
	db.CreateSession(dbConn, db.Session{
		ID:        "ssh-session",
		UserID:    userID,
		Name:      "SSH Session",
		Hostname:  "myhost",
		StartedAt: now,
	})

	mux := http.NewServeMux()
	RegisterRoutes(mux, dbConn, mockJWTMiddleware)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/ssh/connect/ssh-session", nil)
	w := httptest.NewRecorder()

	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestConnectHandlerNotFound(t *testing.T) {
	dbConn := setupTestDB(t)

	mux := http.NewServeMux()
	RegisterRoutes(mux, dbConn, mockJWTMiddleware)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/ssh/connect/nonexistent", nil)
	w := httptest.NewRecorder()

	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestSSHWebAuthnBeginHandler(t *testing.T) {
	handler := SSHWebAuthnBeginHandler()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/ssh/webauthn/begin", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestSSHWebAuthnCompleteHandler(t *testing.T) {
	handler := SSHWebAuthnCompleteHandler()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/ssh/webauthn/complete", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}
