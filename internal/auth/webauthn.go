package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/leolimasa/devsesh/internal/config"
	"github.com/leolimasa/devsesh/internal/db"
	_ "modernc.org/sqlite"
)

type contextKey string

const ContextKeyUserID contextKey = "userID"

func NewWebAuthn(rpID, rpOrigin string) (*webauthn.WebAuthn, error) {
	wa, err := webauthn.New(&webauthn.Config{
		RPDisplayName: "devsesh",
		RPID:          rpID,
		RPOrigins:     []string{rpOrigin},
	})
	if err != nil {
		return nil, fmt.Errorf("create webauthn: %w", err)
	}
	return wa, nil
}

type challengeEntry struct {
	data      *webauthn.SessionData
	expiresAt time.Time
}

type ChallengeStore struct {
	mu      sync.Mutex
	entries map[string]challengeEntry
	ttl     time.Duration
}

func NewChallengeStore(ttl time.Duration) *ChallengeStore {
	cs := &ChallengeStore{
		entries: make(map[string]challengeEntry),
		ttl:     ttl,
	}
	go cs.cleanupLoop()
	return cs
}

func (s *ChallengeStore) cleanupLoop() {
	ticker := time.NewTicker(s.ttl)
	defer ticker.Stop()
	for range ticker.C {
		s.cleanup()
	}
}

func (s *ChallengeStore) cleanup() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for k, v := range s.entries {
		if now.After(v.expiresAt) {
			delete(s.entries, k)
		}
	}
}

func (s *ChallengeStore) Set(email string, data *webauthn.SessionData) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries[email] = challengeEntry{
		data:      data,
		expiresAt: time.Now().Add(s.ttl),
	}
}

func (s *ChallengeStore) Get(email string) (*webauthn.SessionData, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.entries[email]
	if !ok || time.Now().After(entry.expiresAt) {
		if ok {
			delete(s.entries, email)
		}
		return nil, false
	}
	return entry.data, true
}

func (s *ChallengeStore) Delete(email string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.entries, email)
}

type webauthnUser struct {
	id          int64
	email       string
	credentials []db.WebAuthnCredential
}

func (u *webauthnUser) WebAuthnID() []byte {
	return []byte(fmt.Sprintf("%d", u.id))
}

func (u *webauthnUser) WebAuthnName() string {
	return u.email
}

func (u *webauthnUser) WebAuthnDisplayName() string {
	return u.email
}

func (u *webauthnUser) WebAuthnCredentials() []webauthn.Credential {
	creds := make([]webauthn.Credential, len(u.credentials))
	for i, c := range u.credentials {
		creds[i] = webauthn.Credential{
			ID:              c.PublicKey,
			AttestationType: "",
			PublicKey:       c.PublicKey,
			Authenticator: webauthn.Authenticator{
				AAGUID:   nil,
				SignCount: c.SignCount,
			},
		}
	}
	return creds
}

func (u *webauthnUser) WebAuthnIcon() string {
	return ""
}

func (u *webauthnUser) WebAuthnCredentialDescriptors() []protocol.CredentialDescriptor {
	creds := u.WebAuthnCredentials()
	descs := make([]protocol.CredentialDescriptor, len(creds))
	for i, c := range creds {
		descs[i] = c.Descriptor()
	}
	return descs
}

type emailRequest struct {
	Email string `json:"email"`
}

func LoginBeginHandler(wa *webauthn.WebAuthn, database *sql.DB, cs *ChallengeStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req emailRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		user, err := db.GetUserByEmail(database, req.Email)
		if err != nil {
			slog.Error("failed to get user by email", "error", err, "email", req.Email)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if user == nil {
			slog.Warn("user not found during login begin", "email", req.Email)
			user = &db.User{ID: 0, Email: req.Email}
		}

		creds, err := db.GetCredentialsByUserID(database, user.ID)
		if err != nil {
			slog.Error("failed to get credentials by user id", "error", err, "userId", user.ID)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		waUser := &webauthnUser{id: user.ID, email: user.Email, credentials: creds}
		options, sessionData, err := wa.BeginLogin(waUser)
		if err != nil {
			slog.Error("failed to begin webauthn login", "error", err, "email", req.Email)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		cs.Set(req.Email, sessionData)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(options)
	}
}

func LoginFinishHandler(wa *webauthn.WebAuthn, database *sql.DB, cfg config.Config, cs *ChallengeStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Email string `json:"email"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		sessionData, ok := cs.Get(req.Email)
		if !ok {
			http.Error(w, "challenge not found or expired", http.StatusUnauthorized)
			return
		}

		user, err := db.GetUserByEmail(database, req.Email)
		if err != nil {
			slog.Error("failed to get user by email", "error", err, "email", req.Email)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if user == nil {
			slog.Warn("user not found during login finish", "email", req.Email)
			http.Error(w, "invalid credential", http.StatusUnauthorized)
			return
		}

		creds, err := db.GetCredentialsByUserID(database, user.ID)
		if err != nil {
			slog.Error("failed to get credentials by user id", "error", err, "userId", user.ID)
			http.Error(w, "invalid credential", http.StatusUnauthorized)
			return
		}

		waUser := &webauthnUser{id: user.ID, email: user.Email, credentials: creds}
		credential, err := wa.FinishLogin(waUser, *sessionData, r)
		if err != nil {
			slog.Error("failed to finish webauthn login", "error", err)
			http.Error(w, "invalid credential", http.StatusUnauthorized)
			return
		}

		if err := db.UpdateCredentialSignCount(database, string(credential.ID), credential.Authenticator.SignCount); err != nil {
			slog.Error("failed to update credential sign count", "error", err, "credentialId", string(credential.ID))
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		cs.Delete(req.Email)

		token, err := GenerateToken(cfg.JWTSecret, user.ID, cfg.JWTExpiry)
		if err != nil {
			slog.Error("failed to generate token", "error", err, "userId", user.ID)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"token": token})
	}
}

func RegisterBeginHandler(wa *webauthn.WebAuthn, database *sql.DB, cfg config.Config, cs *ChallengeStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req emailRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		count, err := db.CountUsers(database)
		if err != nil {
			slog.Error("failed to count users", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if count > 0 && !cfg.AllowUserCreation {
			http.Error(w, "user creation disabled", http.StatusForbidden)
			return
		}

		options, sessionData, err := wa.BeginRegistration(&webauthnUser{email: req.Email})
		if err != nil {
			slog.Error("failed to begin webauthn registration", "error", err, "email", req.Email)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		cs.Set(req.Email, sessionData)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(options)
	}
}

func RegisterFinishHandler(wa *webauthn.WebAuthn, database *sql.DB, cs *ChallengeStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Email string `json:"email"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		sessionData, ok := cs.Get(req.Email)
		if !ok {
			http.Error(w, "challenge not found or expired", http.StatusUnauthorized)
			return
		}

		user, err := db.GetUserByEmail(database, req.Email)
		if err != nil {
			slog.Error("failed to get user by email", "error", err, "email", req.Email)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		var waUser webauthn.User
		if user != nil {
			creds, _ := db.GetCredentialsByUserID(database, user.ID)
			waUser = &webauthnUser{id: user.ID, email: user.Email, credentials: creds}
		} else {
			waUser = &webauthnUser{email: req.Email}
		}

		credential, err := wa.FinishRegistration(waUser, *sessionData, r)
		if err != nil {
			slog.Error("failed to finish webauthn registration", "error", err)
			http.Error(w, "invalid registration", http.StatusUnauthorized)
			return
		}

		if user == nil {
			id, err := db.CreateUser(database, req.Email)
			if err != nil {
				slog.Error("failed to create user", "error", err, "email", req.Email)
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
			user = &db.User{ID: id, Email: req.Email}
		}

		dbCred := db.WebAuthnCredential{
			ID:        string(credential.ID),
			UserID:    user.ID,
			PublicKey: credential.PublicKey,
			SignCount: credential.Authenticator.SignCount,
		}
		if err := db.SaveCredential(database, dbCred); err != nil {
			slog.Error("failed to save credential", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		cs.Delete(req.Email)

		w.WriteHeader(http.StatusCreated)
	}
}

func AuthStatusHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		count, err := db.CountUsers(database)
		if err != nil {
			slog.Error("failed to count users", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"exists": count > 0})
	}
}

type passkeyResponse struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"created_at"`
}

func ListPasskeysHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		creds, err := db.GetCredentialsByUserID(database, userID)
		if err != nil {
			slog.Error("failed to get credentials", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		passkeys := make([]passkeyResponse, len(creds))
		for i, c := range creds {
			passkeys[i] = passkeyResponse{
				ID:        c.ID,
				CreatedAt: c.CreatedAt,
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(passkeys)
	}
}

func AddPasskeyBeginHandler(wa *webauthn.WebAuthn, database *sql.DB, cs *ChallengeStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		user, err := db.GetUserByID(database, userID)
		if err != nil || user == nil {
			slog.Error("failed to get user", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		creds, err := db.GetCredentialsByUserID(database, userID)
		if err != nil {
			slog.Error("failed to get credentials", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		options, sessionData, err := wa.BeginRegistration(&webauthnUser{id: user.ID, email: user.Email, credentials: creds})
		if err != nil {
			slog.Error("failed to begin passkey registration", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		cs.Set(user.Email, sessionData)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(options)
	}
}

func AddPasskeyFinishHandler(wa *webauthn.WebAuthn, database *sql.DB, cs *ChallengeStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		user, err := db.GetUserByID(database, userID)
		if err != nil || user == nil {
			slog.Error("failed to get user", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		sessionData, ok := cs.Get(user.Email)
		if !ok {
			http.Error(w, "challenge not found or expired", http.StatusUnauthorized)
			return
		}

		creds, err := db.GetCredentialsByUserID(database, userID)
		if err != nil {
			slog.Error("failed to get credentials", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		credential, err := wa.FinishRegistration(&webauthnUser{id: user.ID, email: user.Email, credentials: creds}, *sessionData, r)
		if err != nil {
			slog.Error("failed to finish passkey registration", "error", err)
			http.Error(w, "invalid registration", http.StatusUnauthorized)
			return
		}

		dbCred := db.WebAuthnCredential{
			ID:        string(credential.ID),
			UserID:    userID,
			PublicKey: credential.PublicKey,
			SignCount: credential.Authenticator.SignCount,
		}
		if err := db.SaveCredential(database, dbCred); err != nil {
			slog.Error("failed to save credential", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		cs.Delete(user.Email)

		w.WriteHeader(http.StatusCreated)
	}
}

func UserIDFromContext(ctx context.Context) (int64, bool) {
	userID, ok := ctx.Value(ContextKeyUserID).(int64)
	return userID, ok
}

func DeletePasskeyHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		credID := r.PathValue("id")

		creds, err := db.GetCredentialsByUserID(database, userID)
		if err != nil {
			slog.Error("failed to get credentials", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		if len(creds) <= 1 {
			http.Error(w, "cannot delete last passkey", http.StatusBadRequest)
			return
		}

		found := false
		for _, c := range creds {
			if c.ID == credID {
				found = true
				break
			}
		}
		if !found {
			http.Error(w, "passkey not found", http.StatusNotFound)
			return
		}

		if err := db.DeleteCredential(database, credID); err != nil {
			slog.Error("failed to delete credential", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
