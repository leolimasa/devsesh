package server

import (
	"context"
	"database/sql"
	"encoding/base64"
	"log/slog"
	"net/http"
	"strings"

	"github.com/leolimasa/devsesh/internal/auth"
	"github.com/leolimasa/devsesh/internal/ctxutil"
	"github.com/leolimasa/devsesh/internal/db"
)

func RequireJWT(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			slog.Warn("RequireJWT middleware called", "path", r.URL.Path, "secret_length", len(secret))
			tokenStr := ""
			tokenSource := ""

			authHeader := r.Header.Get("Authorization")
			if len(authHeader) >= 7 && authHeader[:7] == "Bearer " {
				tokenStr = authHeader[7:]
				tokenSource = "Authorization header"
			} else if queryToken := r.URL.Query().Get("token"); queryToken != "" {
				tokenStr = queryToken
				tokenSource = "query parameter"
			}

			if tokenStr == "" {
				slog.Error("JWT validation failed: no token provided", "path", r.URL.Path, "authHeader", authHeader)
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}

			slog.Warn("JWT validation starting - this should always appear", "path", r.URL.Path)
			slog.Info("JWT validation attempt",
				"path", r.URL.Path,
				"token_prefix", func() string {
					if len(tokenStr) > 20 {
						return tokenStr[:20] + "..."
					}
					return tokenStr
				}(),
				"token_length", len(tokenStr),
				"source", tokenSource)

			claims, err := auth.ValidateToken(secret, tokenStr)
			if err != nil {
				slog.Error("failed to validate token",
					"error", err,
					"path", r.URL.Path,
					"secret_length", len(secret),
					"token_userId_from_header", func() string {
						parts := strings.Split(tokenStr, ".")
						if len(parts) != 3 {
							return "invalid_token_format"
						}
						payload, err := base64.RawURLEncoding.DecodeString(parts[1])
						if err != nil {
							return "decode_error"
						}
						return string(payload)
					}())
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}

			slog.Info("JWT validation success", "userId", claims.UserID, "path", r.URL.Path)
			ctx := context.WithValue(r.Context(), ctxutil.ContextKeyUserID, claims.UserID)
			ctx = context.WithValue(ctx, ctxutil.ContextKeyHostID, claims.HostID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func RequireSessionOwner(database *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID, ok := ctxutil.UserIDFromContext(r.Context())
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

			ctx := context.WithValue(r.Context(), ctxutil.ContextKeySession, s)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func RequireValidHost(database *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			hostID, ok := ctxutil.HostIDFromContext(r.Context())
			if !ok || hostID == 0 {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}

			host, err := db.GetHostByID(database, hostID)
			if err != nil {
				slog.Error("failed to get host", "error", err, "hostId", hostID)
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
			if host == nil {
				http.Error(w, "host no longer exists, please pair again", http.StatusUnauthorized)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
