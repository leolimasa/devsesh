package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/leolimasa/devsesh/internal/auth"
	"github.com/leolimasa/devsesh/internal/sessions"
)

func TestRequireJWTValidToken(t *testing.T) {
	secret := "test-secret"
	token, _ := auth.GenerateToken(secret, 42, time.Hour)

	handler := RequireJWT(secret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, ok := sessions.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "no user id", http.StatusInternalServerError)
			return
		}
		if userID != 42 {
			http.Error(w, "wrong user id", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestRequireJWTMissingHeader(t *testing.T) {
	handler := RequireJWT("secret")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", w.Code)
	}
}

func TestRequireJWTInvalidToken(t *testing.T) {
	handler := RequireJWT("secret")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer invalidtoken")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", w.Code)
	}
}

func TestRequireJWTExpiredToken(t *testing.T) {
	secret := "test-secret"
	token, _ := auth.GenerateToken(secret, 1, -time.Hour)

	handler := RequireJWT(secret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", w.Code)
	}
}

func TestRequireJWTWrongSecret(t *testing.T) {
	token, _ := auth.GenerateToken("secret1", 1, time.Hour)

	handler := RequireJWT("secret2")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", w.Code)
	}
}
