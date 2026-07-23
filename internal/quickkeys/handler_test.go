package quickkeys

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/leolimasa/devsesh/internal/ctxutil"
	"github.com/leolimasa/devsesh/internal/db"
	_ "modernc.org/sqlite"
)

func setupTestDB(t *testing.T) *sql.DB {
	t.Helper()
	f, err := os.CreateTemp("", "devsesh-qk-test-*.db")
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

// withUser returns a request whose context carries the given user id, mirroring
// what the JWT middleware injects in production.
func withUser(r *http.Request, userID int64) *http.Request {
	ctx := context.WithValue(r.Context(), ctxutil.ContextKeyUserID, userID)
	return r.WithContext(ctx)
}

// validSpec is the opaque spec value the client stores — itself a JSON string
// (the server validates it is well-formed JSON but treats it as opaque text).
const validSpec = `[{"type":"combo","ctrl":true,"alt":false,"shift":false,"key":"c"}]`

func mustJSON(t *testing.T, v map[string]any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	return string(b)
}

// createKey drives CreateHandler for the given user and returns the created row.
func createKey(t *testing.T, database *sql.DB, userID int64, name, token string) db.QuickKey {
	t.Helper()
	body := mustJSON(t, map[string]any{
		"name": name, "display_token": token, "spec": validSpec,
		"pinned": false, "sort_order": 0,
	})
	req := withUser(httptest.NewRequest(http.MethodPost, "/api/v1/quick-keys", strings.NewReader(body)), userID)
	w := httptest.NewRecorder()
	CreateHandler(database)(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d (%s)", w.Code, w.Body.String())
	}
	var qk db.QuickKey
	if err := json.Unmarshal(w.Body.Bytes(), &qk); err != nil {
		t.Fatalf("decode created key: %v", err)
	}
	return qk
}

func TestQuickKeysScopedToUser(t *testing.T) {
	database := setupTestDB(t)

	// User 1 creates a key; user 2 has none.
	created := createKey(t, database, 1, "User1 Key", "U1")

	// List is per-user.
	listFor := func(userID int64) []db.QuickKey {
		req := withUser(httptest.NewRequest(http.MethodGet, "/api/v1/quick-keys", nil), userID)
		w := httptest.NewRecorder()
		ListHandler(database)(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("list: expected 200, got %d", w.Code)
		}
		var keys []db.QuickKey
		if err := json.Unmarshal(w.Body.Bytes(), &keys); err != nil {
			t.Fatalf("decode list: %v", err)
		}
		return keys
	}

	if got := listFor(1); len(got) != 1 {
		t.Fatalf("user 1 should see 1 key, got %d", len(got))
	}
	if got := listFor(2); len(got) != 0 {
		t.Fatalf("user 2 should see 0 keys, got %d", len(got))
	}

	idPath := "/api/v1/quick-keys/" + itoa(created.ID)

	// User 2 cannot GET user 1's key.
	getReq := withUser(httptest.NewRequest(http.MethodGet, idPath, nil), 2)
	getReq.SetPathValue("id", itoa(created.ID))
	getW := httptest.NewRecorder()
	GetHandler(database)(getW, getReq)
	if getW.Code != http.StatusNotFound {
		t.Fatalf("cross-user GET: expected 404, got %d", getW.Code)
	}

	// User 2 cannot UPDATE user 1's key.
	updReq := withUser(httptest.NewRequest(http.MethodPut, idPath, strings.NewReader(`{"pinned":true}`)), 2)
	updReq.SetPathValue("id", itoa(created.ID))
	updW := httptest.NewRecorder()
	UpdateHandler(database)(updW, updReq)
	if updW.Code != http.StatusNotFound {
		t.Fatalf("cross-user UPDATE: expected 404, got %d", updW.Code)
	}

	// User 2 cannot DELETE user 1's key.
	delReq := withUser(httptest.NewRequest(http.MethodDelete, idPath, nil), 2)
	delReq.SetPathValue("id", itoa(created.ID))
	delW := httptest.NewRecorder()
	DeleteHandler(database)(delW, delReq)
	if delW.Code != http.StatusNotFound {
		t.Fatalf("cross-user DELETE: expected 404, got %d", delW.Code)
	}

	// The key still belongs to user 1 and is untouched.
	if got := listFor(1); len(got) != 1 || got[0].Pinned {
		t.Fatalf("user 1's key was mutated by user 2: %+v", got)
	}
}

func TestCreateValidation(t *testing.T) {
	database := setupTestDB(t)

	cases := []struct {
		name string
		body string
	}{
		{"empty name", mustJSON(t, map[string]any{"name": "", "display_token": "X", "spec": validSpec})},
		{"empty display_token", mustJSON(t, map[string]any{"name": "N", "display_token": "", "spec": validSpec})},
		{"display_token too long", mustJSON(t, map[string]any{"name": "N", "display_token": "012345678901234567890", "spec": validSpec})},
		{"invalid spec json", mustJSON(t, map[string]any{"name": "N", "display_token": "X", "spec": "not-json"})},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := withUser(httptest.NewRequest(http.MethodPost, "/api/v1/quick-keys", strings.NewReader(tc.body)), 1)
			w := httptest.NewRecorder()
			CreateHandler(database)(w, req)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d (%s)", w.Code, w.Body.String())
			}
		})
	}
}

func TestUnauthenticatedRejected(t *testing.T) {
	database := setupTestDB(t)
	// No user id in context → 401.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/quick-keys", nil)
	w := httptest.NewRecorder()
	ListHandler(database)(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// itoa avoids pulling strconv into multiple call sites for readability.
func itoa(n int64) string {
	return strconv.FormatInt(n, 10)
}
