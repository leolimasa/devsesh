package hosts

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/leolimasa/devsesh/internal/db"
	"github.com/leolimasa/devsesh/internal/sessions"
)

type contextKey string

const ContextKeyHost contextKey = "host"

func ListHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := sessions.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		hosts, err := db.GetHostsByUserID(database, userID)
		if err != nil {
			slog.Error("failed to get hosts by user id", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		if hosts == nil {
			hosts = []db.Host{}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(hosts)
	}
}

func CreateHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := sessions.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var req struct {
			Label    string `json:"label"`
			Hostname string `json:"hostname"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		if req.Label == "" || req.Hostname == "" {
			http.Error(w, "label and hostname are required", http.StatusBadRequest)
			return
		}

		existing, err := db.GetHostByLabel(database, userID, req.Label)
		if err != nil {
			slog.Error("failed to check existing host", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if existing != nil {
			http.Error(w, "host label already exists", http.StatusBadRequest)
			return
		}

		host := db.Host{
			Label:    req.Label,
			Hostname: req.Hostname,
			UserID:   userID,
		}
		id, err := db.CreateHost(database, host)
		if err != nil {
			slog.Error("failed to create host", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		host.ID = id
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(host)
	}
}

func GetHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := sessions.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		hostID, err := strconv.ParseInt(r.PathValue("host_id"), 10, 64)
		if err != nil {
			http.Error(w, "invalid host id", http.StatusBadRequest)
			return
		}

		host, err := db.GetHostByID(database, hostID)
		if err != nil {
			slog.Error("failed to get host", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if host == nil || host.UserID != userID {
			http.Error(w, "host not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(host)
	}
}

func UpdateHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := sessions.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		hostID, err := strconv.ParseInt(r.PathValue("host_id"), 10, 64)
		if err != nil {
			http.Error(w, "invalid host id", http.StatusBadRequest)
			return
		}

		host, err := db.GetHostByID(database, hostID)
		if err != nil {
			slog.Error("failed to get host", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if host == nil || host.UserID != userID {
			http.Error(w, "host not found", http.StatusNotFound)
			return
		}

		var req struct {
			Label    string `json:"label"`
			Hostname string `json:"hostname"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		if req.Label != "" && req.Label != host.Label {
			existing, err := db.GetHostByLabel(database, userID, req.Label)
			if err != nil {
				slog.Error("failed to check existing host", "error", err)
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
			if existing != nil {
				http.Error(w, "host label already exists", http.StatusBadRequest)
				return
			}
			host.Label = req.Label
		}
		if req.Hostname != "" {
			host.Hostname = req.Hostname
		}

		if err := db.UpdateHost(database, *host); err != nil {
			slog.Error("failed to update host", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(host)
	}
}

func DeleteHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := sessions.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		hostID, err := strconv.ParseInt(r.PathValue("host_id"), 10, 64)
		if err != nil {
			http.Error(w, "invalid host id", http.StatusBadRequest)
			return
		}

		host, err := db.GetHostByID(database, hostID)
		if err != nil {
			slog.Error("failed to get host", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if host == nil || host.UserID != userID {
			http.Error(w, "host not found", http.StatusNotFound)
			return
		}

		if err := db.DeleteHost(database, hostID); err != nil {
			slog.Error("failed to delete host", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

func HostFromContext(ctx context.Context) (*db.Host, bool) {
	host, ok := ctx.Value(ContextKeyHost).(*db.Host)
	return host, ok
}