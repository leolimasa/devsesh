package auth

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/leolimasa/devsesh/internal/config"
	"github.com/leolimasa/devsesh/internal/db"
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

type codeRequest struct {
	Code    string          `json:"code"`
	HostID  *int64          `json:"host_id"`
	NewHost *newHostRequest `json:"new_host"`
}

type newHostRequest struct {
	Label    string `json:"label"`
	Hostname string `json:"hostname"`
}

func PairStartHandler(database *sql.DB, cfg config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		expiresAt := time.Now().Add(cfg.PairingCodeExpiry)

		for i := 0; i < 5; i++ {
			code, err := generatePairingCode()
			if err != nil {
				slog.Error("failed to generate pairing code", "error", err)
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}

			if err := db.CreatePairingCode(database, code, expiresAt); err == nil {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]string{"code": code})
				return
			}
		}

		slog.Error("failed to generate unique pairing code after 5 attempts")
		http.Error(w, "failed to generate unique code", http.StatusInternalServerError)
	}
}

func PairExchangeHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var req codeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		pc, err := db.GetPairingCode(database, req.Code)
		if err != nil {
			slog.Error("failed to get pairing code", "error", err, "code", req.Code)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if pc == nil || pc.Used || time.Now().After(pc.ExpiresAt) {
			http.Error(w, "invalid or expired code", http.StatusBadRequest)
			return
		}

		var hostID int64
		if req.HostID != nil {
			host, err := db.GetHostByID(database, *req.HostID)
			if err != nil {
				slog.Error("failed to get host", "error", err, "hostId", *req.HostID)
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
			if host == nil || host.UserID != userID {
				http.Error(w, "host not found", http.StatusBadRequest)
				return
			}
			hostID = *req.HostID
		} else if req.NewHost != nil {
			existing, err := db.GetHostByLabel(database, userID, req.NewHost.Label)
			if err != nil {
				slog.Error("failed to check existing host", "error", err)
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
			if existing != nil {
				http.Error(w, "host label already exists", http.StatusBadRequest)
				return
			}
			newHost := db.Host{
				Label:    req.NewHost.Label,
				Hostname: req.NewHost.Hostname,
				UserID:   userID,
			}
			id, err := db.CreateHost(database, newHost)
			if err != nil {
				slog.Error("failed to create host", "error", err)
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
			hostID = id
		} else {
			http.Error(w, "host_id or new_host required", http.StatusBadRequest)
			return
		}

		if err := db.ApprovePairingCode(database, req.Code, userID, hostID); err != nil {
			slog.Error("failed to approve pairing code", "error", err, "code", req.Code)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
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
			slog.Error("failed to get pairing code", "error", err, "code", req.Code)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if pc == nil || pc.Used || time.Now().After(pc.ExpiresAt) {
			http.Error(w, "invalid or expired code", http.StatusBadRequest)
			return
		}
		if !pc.Approved || pc.UserID == nil {
			http.Error(w, "code not yet approved", http.StatusBadRequest)
			return
		}

		user, err := db.GetUserByID(database, *pc.UserID)
		if err != nil {
			slog.Error("failed to get user by id", "error", err, "userId", *pc.UserID)
			http.Error(w, "invalid or expired code", http.StatusBadRequest)
			return
		}
		if user == nil {
			slog.Warn("user not found for pairing code", "userId", *pc.UserID, "code", req.Code)
			http.Error(w, "invalid or expired code", http.StatusBadRequest)
			return
		}

		if pc.HostID == nil {
			slog.Error("host_id not set for pairing code", "code", req.Code)
			http.Error(w, "invalid pairing code", http.StatusBadRequest)
			return
		}

		host, err := db.GetHostByID(database, *pc.HostID)
		if err != nil {
			slog.Error("failed to get host", "error", err, "hostId", *pc.HostID)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if host == nil {
			slog.Warn("host not found for pairing code", "hostId", *pc.HostID, "code", req.Code)
			http.Error(w, "host no longer exists, please pair again", http.StatusBadRequest)
			return
		}

		token, err := GenerateToken(cfg.JWTSecret, *pc.UserID, *pc.HostID, cfg.JWTPairExpiry)
		if err != nil {
			slog.Error("failed to generate token", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		if err := db.MarkPairingCodeUsed(database, req.Code); err != nil {
			slog.Error("failed to mark pairing code used", "error", err, "code", req.Code)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"token": token})
	}
}
