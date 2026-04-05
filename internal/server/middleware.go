package server

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"

	"github.com/leolimasa/devsesh/internal/auth"
	"github.com/leolimasa/devsesh/internal/db"
	"github.com/leolimasa/devsesh/internal/sessions"
)

func RequireJWT(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if len(authHeader) < 7 || authHeader[:7] != "Bearer " {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}

			tokenStr := authHeader[7:]
			claims, err := auth.ValidateToken(secret, tokenStr)
			if err != nil {
				slog.Error("failed to validate token", "error", err)
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), sessions.ContextKeyUserID, claims.UserID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func RequireSessionOwner(database *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID, ok := sessions.UserIDFromContext(r.Context())
			if !ok {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}

			sessionID := r.PathValue("session_id")

			s, err := db.GetSession(database, sessionID)
			if err != nil {
				slog.Error("failed to get session", "error", err)
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
			if s == nil {
				http.Error(w, "session not found", http.StatusNotFound)
				return
			}
			if s.UserID != userID {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}

			ctx := context.WithValue(r.Context(), sessions.ContextKeySession, s)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
