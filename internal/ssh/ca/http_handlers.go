package ca

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/leolimasa/devsesh/internal/ctxutil"
	"github.com/leolimasa/devsesh/internal/db"
)

// PublicKeyHandler returns the CA public key for the authenticated user in OpenSSH format.
// GET /api/v1/sshca/public-key
// [req.23hk63]
func (h *Handler) PublicKeyHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := ctxutil.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		ca, err := db.GetSSHCA(h.db, userID)
		if err != nil {
			slog.Error("failed to get SSH CA", "error", err, "user_id", userID)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if ca == nil {
			http.Error(w, "SSH CA not found", http.StatusNotFound)
			return
		}

		slog.Info("SSH CA public key fetched for user",
			"user_id", userID,
			"publicKey_hex", fmt.Sprintf("%x", ca.PublicKey),
			"publicKey_len", len(ca.PublicKey),
		)

		// Format the public key in OpenSSH format for use in TrustedUserCAKeys
		openSSHKey, err := FormatPublicKeyOpenSSH(ca.PublicKey)
		if err != nil {
			slog.Error("failed to format public key", "error", err, "user_id", userID)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{
			"public_key": openSSHKey,
		}); err != nil {
			slog.Error("failed to encode public key response", "error", err)
		}
	}
}

// ClientShareHandler returns the encrypted client share for the authenticated user.
// GET /api/v1/sshca/client-share
func (h *Handler) ClientShareHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := ctxutil.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		encryptedShare, err := db.GetClientShare(h.db, userID)
		if err != nil {
			slog.Error("failed to get client share", "error", err, "user_id", userID)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if encryptedShare == nil {
			http.Error(w, "client share not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{
			"encrypted_share": base64.StdEncoding.EncodeToString(encryptedShare),
		}); err != nil {
			slog.Error("failed to encode client share response", "error", err)
		}
	}
}

// UpdateClientShareHandler updates the encrypted client share for the authenticated user.
// PUT /api/v1/sshca/client-share
// The frontend should call this after registration to store the encrypted (with master key) share.
func (h *Handler) UpdateClientShareHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := ctxutil.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var req struct {
			EncryptedShare string `json:"encrypted_share"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		if req.EncryptedShare == "" {
			http.Error(w, "encrypted_share is required", http.StatusBadRequest)
			return
		}

		encryptedShare, err := base64.StdEncoding.DecodeString(req.EncryptedShare)
		if err != nil {
			http.Error(w, "invalid base64 encoding", http.StatusBadRequest)
			return
		}

		if err := db.UpdateClientShare(h.db, userID, encryptedShare); err != nil {
			slog.Error("failed to update client share", "error", err, "user_id", userID)
			http.Error(w, "failed to update client share", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
	}
}

// ConfigHandler returns the full SSH CA configuration for the authenticated user.
// GET /api/v1/sshca/config
// Returns public key, client share, and both verification shares needed for FROST signing.
func (h *Handler) ConfigHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := ctxutil.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		ca, err := db.GetSSHCA(h.db, userID)
		if err != nil {
			slog.Error("failed to get SSH CA", "error", err, "user_id", userID)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if ca == nil {
			http.Error(w, "SSH CA not found", http.StatusNotFound)
			return
		}

		clientShare, err := db.GetClientShare(h.db, userID)
		if err != nil {
			slog.Error("failed to get client share", "error", err, "user_id", userID)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if clientShare == nil {
			http.Error(w, "client share not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{
			"public_key":             base64.StdEncoding.EncodeToString(ca.PublicKey),
			"client_share":           base64.StdEncoding.EncodeToString(clientShare),
			"server_verifying_share": base64.StdEncoding.EncodeToString(ca.ServerVerifyingShare),
			"client_verifying_share": base64.StdEncoding.EncodeToString(ca.ClientVerifyingShare),
		}); err != nil {
			slog.Error("failed to encode config response", "error", err)
		}
	}
}
