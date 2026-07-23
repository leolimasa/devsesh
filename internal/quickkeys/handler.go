// Package quickkeys provides HTTP handlers for per-user Quick Key CRUD.
// Quick keys are not tied to a session — they belong to the authenticated user
// and appear across all of the user's sessions.
package quickkeys

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/leolimasa/devsesh/internal/ctxutil"
	"github.com/leolimasa/devsesh/internal/db"
)

const (
	maxSpecLength         = 4096
	maxDisplayTokenLength = 20
)

// ListHandler returns all quick keys for the authenticated user.
func ListHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := ctxutil.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		keys, err := db.GetQuickKeysByUserID(database, userID)
		if err != nil {
			slog.Error("failed to list quick keys", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		if keys == nil {
			keys = []db.QuickKey{}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(keys)
	}
}

// CreateHandler persists a new quick key for the authenticated user.
func CreateHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := ctxutil.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var req struct {
			Name         string `json:"name"`
			DisplayToken string `json:"display_token"`
			Spec         string `json:"spec"`
			Pinned       bool   `json:"pinned"`
			SortOrder    int    `json:"sort_order"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		if req.Name == "" || req.DisplayToken == "" {
			http.Error(w, "name and display_token are required", http.StatusBadRequest)
			return
		}
		if len(req.DisplayToken) > maxDisplayTokenLength {
			http.Error(w, "display_token too long", http.StatusBadRequest)
			return
		}
		if !json.Valid([]byte(req.Spec)) {
			http.Error(w, "spec must be valid JSON", http.StatusBadRequest)
			return
		}
		if len(req.Spec) > maxSpecLength {
			http.Error(w, "spec too long", http.StatusBadRequest)
			return
		}

		qk := db.QuickKey{
			UserID:       userID,
			Name:         req.Name,
			DisplayToken: req.DisplayToken,
			Spec:         req.Spec,
			Pinned:       req.Pinned,
			SortOrder:    req.SortOrder,
		}
		id, err := db.CreateQuickKey(database, qk)
		if err != nil {
			slog.Error("failed to create quick key", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		qk.ID = id
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(qk)
	}
}

// UpdateHandler applies updates to a quick key owned by the authenticated user.
// Serves edits, pin/unpin, and reorder.
func UpdateHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := ctxutil.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		qk, err := db.GetQuickKeyByID(database, id)
		if err != nil {
			slog.Error("failed to get quick key", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if qk == nil || qk.UserID != userID {
			http.Error(w, "quick key not found", http.StatusNotFound)
			return
		}

		var req struct {
			Name         *string `json:"name"`
			DisplayToken *string `json:"display_token"`
			Spec         *string `json:"spec"`
			Pinned       *bool   `json:"pinned"`
			SortOrder    *int    `json:"sort_order"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		if req.Name != nil {
			if *req.Name == "" {
				http.Error(w, "name must not be empty", http.StatusBadRequest)
				return
			}
			qk.Name = *req.Name
		}
		if req.DisplayToken != nil {
			if *req.DisplayToken == "" {
				http.Error(w, "display_token must not be empty", http.StatusBadRequest)
				return
			}
			if len(*req.DisplayToken) > maxDisplayTokenLength {
				http.Error(w, "display_token too long", http.StatusBadRequest)
				return
			}
			qk.DisplayToken = *req.DisplayToken
		}
		if req.Spec != nil {
			if !json.Valid([]byte(*req.Spec)) {
				http.Error(w, "spec must be valid JSON", http.StatusBadRequest)
				return
			}
			if len(*req.Spec) > maxSpecLength {
				http.Error(w, "spec too long", http.StatusBadRequest)
				return
			}
			qk.Spec = *req.Spec
		}
		if req.Pinned != nil {
			qk.Pinned = *req.Pinned
		}
		if req.SortOrder != nil {
			qk.SortOrder = *req.SortOrder
		}

		if err := db.UpdateQuickKey(database, *qk); err != nil {
			slog.Error("failed to update quick key", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(qk)
	}
}

// DeleteHandler removes a quick key owned by the authenticated user.
func DeleteHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := ctxutil.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		qk, err := db.GetQuickKeyByID(database, id)
		if err != nil {
			slog.Error("failed to get quick key", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if qk == nil || qk.UserID != userID {
			http.Error(w, "quick key not found", http.StatusNotFound)
			return
		}

		if err := db.DeleteQuickKey(database, id); err != nil {
			slog.Error("failed to delete quick key", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// GetHandler returns a single quick key owned by the authenticated user.
func GetHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := ctxutil.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		qk, err := db.GetQuickKeyByID(database, id)
		if err != nil {
			slog.Error("failed to get quick key", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if qk == nil || qk.UserID != userID {
			http.Error(w, "quick key not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(qk)
	}
}
