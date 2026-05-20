// Package ca implements SSH CA certificate issuance using FROST threshold signatures.
// The package provides HTTP and WebSocket handlers for certificate management
// and the two-round FROST signing protocol.
package ca

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/leolimasa/devsesh/internal/config"
	"github.com/leolimasa/devsesh/internal/util"
)

// Handler manages SSH CA operations including key management, certificate
// issuance, and the FROST signing protocol over WebSocket.
type Handler struct {
	db             *sql.DB
	sessionManager *SessionManager
	rateLimiter    *util.RateLimiter
	cfg            config.SSHCAConfig
	allowedOrigins []string
}

// NewHandler creates a new SSH CA handler with the given database, configuration,
// and relying party origin for WebSocket CORS validation.
func NewHandler(db *sql.DB, cfg config.SSHCAConfig, rpOrigin string) *Handler {
	origins := []string{rpOrigin}
	if rpOrigin != "http://localhost:8080" && rpOrigin != "http://localhost:5173" {
		origins = append(origins, "http://localhost:8080", "http://localhost:5173")
	}
	return &Handler{
		db:             db,
		sessionManager: NewSessionManager(),
		rateLimiter:    util.NewRateLimiter(cfg.RateLimitPerMin, time.Minute),
		cfg:            cfg,
		allowedOrigins: origins,
	}
}

// checkOrigin validates the WebSocket origin header against allowed origins.
func (h *Handler) checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	for _, allowed := range h.allowedOrigins {
		if origin == allowed {
			return true
		}
	}
	return false
}
