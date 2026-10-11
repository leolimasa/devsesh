package settings

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/leolimasa/devsesh/internal/ctxutil"
	"github.com/leolimasa/devsesh/internal/db"
	_ "modernc.org/sqlite"
)

func setupTestDB(t *testing.T) *sql.DB {
	t.Helper()
	f, err := os.CreateTemp("", "devsesh-settings-test-*.db")
	if err != nil {
		t.Fatalf("create temp db: %v", err)
	}
	t.Cleanup(func() { os.Remove(f.Name()) })

	dbConn, err := sql.Open("sqlite", f.Name())
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { dbConn.Close() })

	if _, err := db.RunMigrations(dbConn); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return dbConn
}

func putTheme(t *testing.T, database *sql.DB, theme string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/settings", strings.NewReader(`{"theme":"`+theme+`"}`))
	req = req.WithContext(context.WithValue(req.Context(), ctxutil.ContextKeyUserID, int64(1)))
	rec := httptest.NewRecorder()
	UpdateHandler(database)(rec, req)
	return rec
}

func TestUpdateHandler_AcceptsEveryKnownTheme(t *testing.T) {
	database := setupTestDB(t)
	for _, theme := range []string{"dark-blue", "one-dark", "scifi-rts"} {
		if rec := putTheme(t, database, theme); rec.Code != http.StatusOK {
			t.Errorf("theme %q: got status %d, want 200 (%s)", theme, rec.Code, rec.Body.String())
		}
	}
}

func TestUpdateHandler_RejectsUnknownTheme(t *testing.T) {
	database := setupTestDB(t)
	if rec := putTheme(t, database, "no-such-theme"); rec.Code != http.StatusBadRequest {
		t.Errorf("got status %d, want 400", rec.Code)
	}
}
