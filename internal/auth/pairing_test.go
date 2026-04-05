package auth

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/leobeosab/devsesh/internal/config"
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

func TestPairStartHandler(t *testing.T) {
	dbConn := setupTestDB(t)
	cfg := config.Config{
		PairingCodeExpiry: 5 * time.Minute,
	}

	userID, _ := db.CreateUser(dbConn, "pair@test.com")
	_ = userID

	handler := PairStartHandler(dbConn, cfg)

	body := `{"username":"pair@test.com"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/pair/start", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
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
}

func TestPairStartHandlerUserNotFound(t *testing.T) {
	dbConn := setupTestDB(t)
	cfg := config.Config{PairingCodeExpiry: 5 * time.Minute}

	handler := PairStartHandler(dbConn, cfg)

	body := `{"username":"nonexistent@test.com"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/pair/start", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestPairExchangeHandler(t *testing.T) {
	dbConn := setupTestDB(t)
	cfg := config.Config{PairingCodeExpiry: 5 * time.Minute}

	userID, _ := db.CreateUser(dbConn, "exchange@test.com")
	expiresAt := time.Now().Add(cfg.PairingCodeExpiry)
	db.CreatePairingCode(dbConn, "EXCHNG", userID, expiresAt)

	handler := PairExchangeHandler(dbConn)

	body := `{"code":"EXCHNG"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/pair/exchange", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	pc, _ := db.GetPairingCode(dbConn, "EXCHNG")
	if !pc.Approved {
		t.Error("expected pairing code to be approved")
	}
}

func TestPairExchangeHandlerInvalidCode(t *testing.T) {
	dbConn := setupTestDB(t)

	handler := PairExchangeHandler(dbConn)

	body := `{"code":"NOPE"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/pair/exchange", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
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
	db.CreatePairingCode(dbConn, "CMPLTE", userID, expiresAt)
	db.ApprovePairingCode(dbConn, "CMPLTE")

	handler := PairCompleteHandler(dbConn, cfg)

	body := `{"code":"CMPLTE"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/pair/complete", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
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

	userID, _ := db.CreateUser(dbConn, "unapproved@test.com")
	expiresAt := time.Now().Add(cfg.PairingCodeExpiry)
	db.CreatePairingCode(dbConn, "UNAPPR", userID, expiresAt)

	handler := PairCompleteHandler(dbConn, cfg)

	body := `{"code":"UNAPPR"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/pair/complete", bytes.NewReader([]byte(body)))
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
	db.CreatePairingCode(dbConn, "EXPRED", userID, expiresAt)
	db.ApprovePairingCode(dbConn, "EXPRED")

	handler := PairCompleteHandler(dbConn, cfg)

	body := `{"code":"EXPRED"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/pair/complete", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}
