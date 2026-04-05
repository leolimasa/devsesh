package auth

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/leobeosab/devsesh/internal/config"
	"github.com/leobeosab/devsesh/internal/db"
)

const pairingCodeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func generatePairingCode() (string, error) {
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	code := make([]byte, 6)
	for i := range b {
		code[i] = pairingCodeChars[int(b[i])%len(pairingCodeChars)]
	}
	return string(code), nil
}

type usernameRequest struct {
	Username string `json:"username"`
}

type codeRequest struct {
	Code string `json:"code"`
}

func PairStartHandler(database *sql.DB, cfg config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req usernameRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		user, err := db.GetUserByEmail(database, req.Username)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if user == nil {
			http.Error(w, "user not found", http.StatusNotFound)
			return
		}

		expiresAt := time.Now().Add(cfg.PairingCodeExpiry)

		for i := 0; i < 5; i++ {
			code, err := generatePairingCode()
			if err != nil {
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}

			if err := db.CreatePairingCode(database, code, user.ID, expiresAt); err == nil {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]string{"code": code})
				return
			}
		}

		http.Error(w, "failed to generate unique code", http.StatusInternalServerError)
	}
}

func PairExchangeHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req codeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		pc, err := db.GetPairingCode(database, req.Code)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if pc == nil || pc.Used || time.Now().After(pc.ExpiresAt) {
			http.Error(w, "invalid or expired code", http.StatusBadRequest)
			return
		}

		if err := db.ApprovePairingCode(database, req.Code); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
	}
}

func PairCompleteHandler(database *sql.DB, cfg config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req codeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		pc, err := db.GetPairingCode(database, req.Code)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if pc == nil || pc.Used || time.Now().After(pc.ExpiresAt) {
			http.Error(w, "invalid or expired code", http.StatusBadRequest)
			return
		}
		if !pc.Approved {
			http.Error(w, "code not yet approved", http.StatusBadRequest)
			return
		}

		token, err := GenerateToken(cfg.JWTSecret, pc.UserID, cfg.JWTPairExpiry)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		if err := db.MarkPairingCodeUsed(database, req.Code); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"token": token})
	}
}
