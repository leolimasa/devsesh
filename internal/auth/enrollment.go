package auth

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/leolimasa/devsesh/internal/db"
)

const (
	enrollmentCodeChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	enrollmentCodeLen   = 8
	enrollmentExpiry    = 5 * time.Minute
	prfSaltString       = "devsesh-master-key-v1"
)

func generateEnrollmentCode() (string, error) {
	code := make([]byte, enrollmentCodeLen)
	charsLen := byte(len(enrollmentCodeChars))
	// 256 - (256 % 36) = 252 for 36 chars, ensures uniform distribution
	maxValid := byte(256 - (256 % int(charsLen)))

	for i := 0; i < enrollmentCodeLen; {
		b := make([]byte, 1)
		if _, err := rand.Read(b); err != nil {
			return "", fmt.Errorf("generate random byte: %w", err)
		}
		// Rejection sampling: only use values that won't cause modulo bias
		if b[0] < maxValid {
			code[i] = enrollmentCodeChars[b[0]%charsLen]
			i++
		}
	}
	return string(code), nil
}

type enrollmentResponse struct {
	Code string `json:"code"`
}

func CreateEnrollmentHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		code, err := generateEnrollmentCode()
		if err != nil {
			slog.Error("failed to generate enrollment code", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		expiresAt := time.Now().Add(enrollmentExpiry)
		if err := db.CreatePasskeyEnrollment(database, code, expiresAt); err != nil {
			slog.Error("failed to create passkey enrollment", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(enrollmentResponse{Code: code})
	}
}

// Note: protocol.CredentialCreation already has structure {publicKey: {...}}
// so we encode it directly without wrapping

func EnrollmentBeginHandler(wa *webauthn.WebAuthn, database *sql.DB, cs *ChallengeStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		code := r.PathValue("code")

		enrollment, err := db.GetPasskeyEnrollment(database, code)
		if err != nil {
			slog.Error("failed to get passkey enrollment", "error", err, "code", code)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if enrollment == nil {
			http.Error(w, "enrollment not found", http.StatusNotFound)
			return
		}
		if time.Now().After(enrollment.ExpiresAt) {
			http.Error(w, "enrollment expired", http.StatusGone)
			return
		}
		if enrollment.Completed {
			http.Error(w, "enrollment already completed", http.StatusBadRequest)
			return
		}
		if enrollment.UserID == nil {
			http.Error(w, "enrollment not linked to user", http.StatusBadRequest)
			return
		}

		userID := *enrollment.UserID
		user, err := db.GetUserByID(database, userID)
		if err != nil || user == nil {
			slog.Error("failed to get user", "error", err, "userId", userID)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		creds, err := db.GetCredentialsByUserID(database, userID)
		if err != nil {
			slog.Error("failed to get credentials", "error", err, "userId", userID)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		options, sessionData, err := wa.BeginRegistration(&webauthnUser{id: user.ID, email: user.Email, credentials: creds})
		if err != nil {
			slog.Error("failed to begin webauthn registration", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		// PRF extension is added client-side with proper ArrayBuffer salt
		// The client uses the fixed salt "devsesh-master-key-v1" for PRF derivation

		cs.Set(code, sessionData)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(options)
	}
}

type enrollmentCompleteRequest struct {
	Credential         json.RawMessage `json:"credential"`
	EncryptedMasterKey string          `json:"encrypted_master_key"`
}

func EnrollmentCompleteHandler(wa *webauthn.WebAuthn, database *sql.DB, cs *ChallengeStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		code := r.PathValue("code")

		enrollment, err := db.GetPasskeyEnrollment(database, code)
		if err != nil {
			slog.Error("failed to get passkey enrollment", "error", err, "code", code)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if enrollment == nil {
			http.Error(w, "enrollment not found", http.StatusNotFound)
			return
		}
		if time.Now().After(enrollment.ExpiresAt) {
			http.Error(w, "enrollment expired", http.StatusGone)
			return
		}
		if enrollment.Completed {
			http.Error(w, "enrollment already completed", http.StatusBadRequest)
			return
		}
		if enrollment.UserID == nil {
			http.Error(w, "enrollment not linked to user", http.StatusBadRequest)
			return
		}

		var req enrollmentCompleteRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			slog.Error("failed to decode enrollment complete request", "error", err)
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		sessionData, ok := cs.Get(code)
		if !ok {
			http.Error(w, "challenge not found or expired", http.StatusUnauthorized)
			return
		}

		userID := *enrollment.UserID
		user, err := db.GetUserByID(database, userID)
		if err != nil || user == nil {
			slog.Error("failed to get user", "error", err, "userId", userID)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		creds, err := db.GetCredentialsByUserID(database, userID)
		if err != nil {
			slog.Error("failed to get credentials", "error", err, "userId", userID)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		parsedResponse, err := protocol.ParseCredentialCreationResponseBody(strings.NewReader(string(req.Credential)))
		if err != nil {
			slog.Error("failed to parse credential creation response", "error", err)
			http.Error(w, "invalid credential", http.StatusBadRequest)
			return
		}

		credential, err := wa.CreateCredential(&webauthnUser{id: user.ID, email: user.Email, credentials: creds}, *sessionData, parsedResponse)
		if err != nil {
			slog.Error("failed to finish webauthn registration", "error", err)
			http.Error(w, "invalid registration", http.StatusUnauthorized)
			return
		}

		var encryptedMasterKey []byte
		if req.EncryptedMasterKey != "" {
			encryptedMasterKey, err = base64.StdEncoding.DecodeString(req.EncryptedMasterKey)
			if err != nil {
				slog.Error("failed to decode encrypted master key", "error", err)
				http.Error(w, "invalid encrypted master key", http.StatusBadRequest)
				return
			}
		}

		dbCred := db.WebAuthnCredential{
			ID:        string(credential.ID),
			UserID:    userID,
			PublicKey: credential.PublicKey,
			SignCount: credential.Authenticator.SignCount,
		}

		if err := db.SaveCredentialWithMasterKey(database, dbCred, encryptedMasterKey); err != nil {
			slog.Error("failed to save credential with master key", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		if err := db.CompleteEnrollment(database, code); err != nil {
			slog.Error("failed to complete enrollment", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		cs.Delete(code)

		w.WriteHeader(http.StatusCreated)
	}
}

type masterKeyResponse struct {
	EncryptedMasterKey string `json:"encrypted_master_key"`
}

func GetMasterKeyHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		cred, err := db.GetFirstCredentialWithMasterKey(database, userID)
		if err != nil {
			slog.Error("failed to get credential with master key", "error", err, "userId", userID)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if cred == nil || cred.EncryptedMasterKey == nil {
			http.Error(w, "no encrypted master key found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(masterKeyResponse{
			EncryptedMasterKey: base64.StdEncoding.EncodeToString(cred.EncryptedMasterKey),
		})
	}
}
