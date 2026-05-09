// Package ctxutil provides shared context utilities for request handling.
// These utilities are extracted to avoid import cycles between auth, sessions, and ssh/ca packages.
package ctxutil

import (
	"context"

	"github.com/leolimasa/devsesh/internal/db"
)

// ContextKey is a type for context keys to avoid collisions.
type ContextKey string

// Context keys for request context values.
const (
	ContextKeyUserID  ContextKey = "userID"
	ContextKeyHostID  ContextKey = "hostID"
	ContextKeySession ContextKey = "session"
)

// UserIDFromContext extracts the user ID from the context.
// Returns the user ID and a boolean indicating whether the value was found.
func UserIDFromContext(ctx context.Context) (int64, bool) {
	userID, ok := ctx.Value(ContextKeyUserID).(int64)
	return userID, ok
}

// HostIDFromContext extracts the host ID from the context.
// Returns the host ID and a boolean indicating whether the value was found.
func HostIDFromContext(ctx context.Context) (int64, bool) {
	hostID, ok := ctx.Value(ContextKeyHostID).(int64)
	return hostID, ok
}

// SessionFromContext extracts the session from the context.
// Returns the session and a boolean indicating whether the value was found.
func SessionFromContext(ctx context.Context) (*db.Session, bool) {
	session, ok := ctx.Value(ContextKeySession).(*db.Session)
	return session, ok
}
