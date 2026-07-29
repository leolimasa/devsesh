package auth

import (
	"bytes"
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
			ID:             string(credential.ID),
			UserID:         userID,
			PublicKey:      credential.PublicKey,
			SignCount:      credential.Authenticator.SignCount,
			BackupEligible: credential.Flags.BackupEligible,
			BackupState:    credential.Flags.BackupState,
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
	// All per-device wrapped master keys for the authenticating credential. A
	// synced passkey has a device-specific PRF, so it carries one blob per
	// device; the client tries each until one decrypts with this device's PRF.
	Blobs []string `json:"blobs"`
	// Legacy single-blob field (= Blobs[0]) for back-compat with a stale client.
	EncryptedMasterKey string `json:"encrypted_master_key,omitempty"`
}

// decodeCredentialID decodes a base64url (or std) credential id param to raw
// bytes; credential ids are stored as string(rawBytes).
func decodeCredentialID(s string) ([]byte, bool) {
	if raw, err := base64.RawURLEncoding.DecodeString(s); err == nil {
		return raw, true
	}
	if raw, err := base64.StdEncoding.DecodeString(s); err == nil {
		return raw, true
	}
	return nil, false
}

func GetMasterKeyHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		// Resolve the authenticating credential (must belong to this user). The
		// client passes ?credential_id=<base64url(rawId)> from the assertion.
		var cred *db.WebAuthnCredential
		var err error
		if credIDParam := r.URL.Query().Get("credential_id"); credIDParam != "" {
			raw, ok := decodeCredentialID(credIDParam)
			if !ok {
				http.Error(w, "invalid credential_id", http.StatusBadRequest)
				return
			}
			cred, err = db.GetCredentialWithMasterKey(database, string(raw))
			if err != nil {
				slog.Error("failed to get credential", "error", err, "userId", userID)
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
			if cred != nil && cred.UserID != userID {
				cred = nil
			}
		} else {
			cred, err = db.GetFirstCredentialWithMasterKey(database, userID)
			if err != nil {
				slog.Error("failed to get credential", "error", err, "userId", userID)
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
		}
		if cred == nil {
			http.Error(w, "no encrypted master key found", http.StatusNotFound)
			return
		}

		blobs, err := db.GetCredentialKeyBlobs(database, cred.ID)
		if err != nil {
			slog.Error("failed to get credential key blobs", "error", err, "userId", userID)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		// Also include the legacy single-blob column (deduped): the new-passkey
		// path (registration/enrollment) still writes it, so a credential's
		// original blob lives there while provisioned per-device blobs live in the
		// table. Merging both means every device's blob is returned.
		if cred.EncryptedMasterKey != nil {
			dup := false
			for _, b := range blobs {
				if bytes.Equal(b, cred.EncryptedMasterKey) {
					dup = true
					break
				}
			}
			if !dup {
				blobs = append(blobs, cred.EncryptedMasterKey)
			}
		}
		if len(blobs) == 0 {
			http.Error(w, "no encrypted master key found", http.StatusNotFound)
			return
		}

		resp := masterKeyResponse{}
		for _, b := range blobs {
			resp.Blobs = append(resp.Blobs, base64.StdEncoding.EncodeToString(b))
		}
		resp.EncryptedMasterKey = resp.Blobs[0]

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

type addMasterKeyBlobRequest struct {
	CredentialID     string `json:"credential_id"`
	WrappedMasterKey string `json:"wrapped_master_key"`
}

// AddMasterKeyBlobHandler appends a per-device wrapped master key to an existing
// credential the user owns. This is how a device that shares a synced passkey
// but has its own device-specific PRF provisions its blob — without minting a
// new passkey. The server never sees the plaintext master key.
func AddMasterKeyBlobHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var req addMasterKeyBlobRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		raw, ok := decodeCredentialID(req.CredentialID)
		if !ok {
			http.Error(w, "invalid credential_id", http.StatusBadRequest)
			return
		}
		blob, err := base64.StdEncoding.DecodeString(req.WrappedMasterKey)
		if err != nil || len(blob) == 0 || len(blob) > 4096 {
			http.Error(w, "invalid wrapped_master_key", http.StatusBadRequest)
			return
		}

		cred, err := db.GetCredentialWithMasterKey(database, string(raw))
		if err != nil {
			slog.Error("failed to get credential", "error", err, "userId", userID)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if cred == nil || cred.UserID != userID {
			http.Error(w, "credential not found", http.StatusNotFound)
			return
		}

		if err := db.AddCredentialKeyBlob(database, cred.ID, blob); err != nil {
			slog.Error("failed to add credential key blob", "error", err, "userId", userID)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
