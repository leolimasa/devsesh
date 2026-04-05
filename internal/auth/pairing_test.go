package auth

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/leolimasa/devsesh/internal/config"
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

func TestPairStartHandler(t *testing.T) {
	dbConn := setupTestDB(t)
	cfg := config.Config{
		PairingCodeExpiry: 5 * time.Minute,
	}

	handler := PairStartHandler(dbConn, cfg)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/pair/start", nil)
	req = req.WithContext(context.WithValue(req.Context(), sessions.ContextKeyUserID, int64(1)))
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var resp map[string]string
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp["code"]) != 6 {
		t.Errorf("expected 6-char code, got %q", resp["code"])
	}

	code, _ := db.GetPairingCode(dbConn, resp["code"])
	if code.UserID != nil {
		t.Error("expected user_id to be nil before exchange")
	}
}

func TestPairExchangeHandler(t *testing.T) {
	dbConn := setupTestDB(t)

	userID, _ := db.CreateUser(dbConn, "exchange@test.com")
	expiresAt := time.Now().Add(5 * time.Minute)
	db.CreatePairingCode(dbConn, "EXCHNG", expiresAt)

	handler := PairExchangeHandler(dbConn)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/pair/exchange", bytes.NewReader([]byte(`{"code":"EXCHNG"}`)))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(context.WithValue(req.Context(), sessions.ContextKeyUserID, userID))
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d, body: %s", w.Code, w.Body.String())
	}

	pc, _ := db.GetPairingCode(dbConn, "EXCHNG")
	if !pc.Approved {
		t.Error("expected pairing code to be approved")
	}
	if pc.UserID == nil || *pc.UserID != userID {
		t.Errorf("expected user_id to be %d, got %v", userID, pc.UserID)
	}
}

func TestPairExchangeHandlerInvalidCode(t *testing.T) {
	dbConn := setupTestDB(t)

	userID, _ := db.CreateUser(dbConn, "invalid@test.com")

	handler := PairExchangeHandler(dbConn)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/pair/exchange", bytes.NewReader([]byte(`{"code":"NOPE"}`)))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(context.WithValue(req.Context(), sessions.ContextKeyUserID, userID))
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestPairCompleteHandler(t *testing.T) {
	dbConn := setupTestDB(t)
	cfg := config.Config{
		JWTPairExpiry:     720 * time.Hour,
		JWTSecret:         "test-secret",
		PairingCodeExpiry: 5 * time.Minute,
	}

	userID, _ := db.CreateUser(dbConn, "complete@test.com")
	expiresAt := time.Now().Add(cfg.PairingCodeExpiry)
	db.CreatePairingCode(dbConn, "CMPLTE", expiresAt)
	db.ApprovePairingCode(dbConn, "CMPLTE", userID)

	handler := PairCompleteHandler(dbConn, cfg)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/pair/complete", bytes.NewReader([]byte(`{"code":"CMPLTE"}`)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d, body: %s", w.Code, w.Body.String())
	}

	var resp map[string]string
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp["token"] == "" {
		t.Error("expected non-empty token")
	}

	pc, _ := db.GetPairingCode(dbConn, "CMPLTE")
	if !pc.Used {
		t.Error("expected pairing code to be marked used")
	}
}

func TestPairCompleteHandlerUnapprovedCode(t *testing.T) {
	dbConn := setupTestDB(t)
	cfg := config.Config{
		JWTPairExpiry:     720 * time.Hour,
		JWTSecret:         "test-secret",
		PairingCodeExpiry: 5 * time.Minute,
	}

	expiresAt := time.Now().Add(cfg.PairingCodeExpiry)
	db.CreatePairingCode(dbConn, "UNAPPR", expiresAt)

	handler := PairCompleteHandler(dbConn, cfg)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/pair/complete", bytes.NewReader([]byte(`{"code":"UNAPPR"}`)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestPairCompleteHandlerExpiredCode(t *testing.T) {
	dbConn := setupTestDB(t)
	cfg := config.Config{
		JWTPairExpiry:     720 * time.Hour,
		JWTSecret:         "test-secret",
		PairingCodeExpiry: 5 * time.Minute,
	}

	userID, _ := db.CreateUser(dbConn, "expired@test.com")
	expiresAt := time.Now().Add(-time.Hour)
	db.CreatePairingCode(dbConn, "EXPRED", expiresAt)
	db.ApprovePairingCode(dbConn, "EXPRED", userID)

	handler := PairCompleteHandler(dbConn, cfg)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/pair/complete", bytes.NewReader([]byte(`{"code":"EXPRED"}`)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestPairCompleteHandlerNoUser(t *testing.T) {
	dbConn := setupTestDB(t)
	cfg := config.Config{
		JWTPairExpiry:     720 * time.Hour,
		JWTSecret:         "test-secret",
		PairingCodeExpiry: 5 * time.Minute,
	}

	expiresAt := time.Now().Add(5 * time.Minute)
	db.CreatePairingCode(dbConn, "NOUSER", expiresAt)
	db.ApprovePairingCode(dbConn, "NOUSER", 999)

	handler := PairCompleteHandler(dbConn, cfg)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/pair/complete", bytes.NewReader([]byte(`{"code":"NOUSER"}`)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}
