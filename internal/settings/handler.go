// Package settings provides HTTP handlers for per-user settings (one row per
// user; each setting is a column). The first setting is the UI theme.
package settings

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/leolimasa/devsesh/internal/ctxutil"
	"github.com/leolimasa/devsesh/internal/db"
)

// validThemes is the set of theme ids the frontend knows how to render. Keep in
// sync with web/src/lib/themes.ts.
var validThemes = map[string]bool{
	"dark-blue": true,
	"one-dark":  true,
}

// GetHandler returns the authenticated user's settings (defaults if unset).
func GetHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := ctxutil.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		s, err := db.GetUserSettings(database, userID)
		if err != nil {
			slog.Error("failed to get user settings", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(s)
	}
}

// UpdateHandler upserts the authenticated user's settings. Fields are optional;
// only provided (non-nil) fields are changed.
func UpdateHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := ctxutil.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var req struct {
			Theme *string `json:"theme"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		// Start from the current (or default) settings, then apply the patch.
		current, err := db.GetUserSettings(database, userID)
		if err != nil {
			slog.Error("failed to load user settings", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		if req.Theme != nil {
			if !validThemes[*req.Theme] {
				http.Error(w, "unknown theme", http.StatusBadRequest)
				return
			}
			current.Theme = *req.Theme
		}

		saved, err := db.UpsertUserSettings(database, db.UserSettings{UserID: userID, Theme: current.Theme})
		if err != nil {
			slog.Error("failed to save user settings", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(saved)
	}
}
