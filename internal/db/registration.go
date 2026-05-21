package db

import (
	"database/sql"
	"fmt"
	"time"
)

// RegistrationData contains all data needed to register a new user with SSH CA.
type RegistrationData struct {
	Email              string
	Credential         WebAuthnCredential
	EncryptedMasterKey []byte
	SSHCAData          SSHCAData
}

// RegistrationResult contains the result of a successful registration.
type RegistrationResult struct {
	UserID int64
}

// RegisterUserWithSSHCA creates a new user, saves their WebAuthn credential,
// and creates their SSH CA in a single atomic transaction.
// If any step fails, all changes are rolled back.
func RegisterUserWithSSHCA(db *sql.DB, data RegistrationData) (*RegistrationResult, error) {
	tx, err := db.Begin()
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer func() {
		if err != nil {
			tx.Rollback()
		}
	}()

	// Create user
	res, err := tx.Exec("INSERT INTO users (email) VALUES (?)", data.Email)
	if err != nil {
		return nil, fmt.Errorf("create user: %w", err)
	}
	userID, err := res.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("get user id: %w", err)
	}

	// Save WebAuthn credential with master key
	_, err = tx.Exec(
		"INSERT INTO webauthn_credentials (id, user_id, public_key, sign_count, encrypted_master_key) VALUES (?, ?, ?, ?, ?)",
		data.Credential.ID, userID, data.Credential.PublicKey, data.Credential.SignCount, data.EncryptedMasterKey,
	)
	if err != nil {
		return nil, fmt.Errorf("save credential: %w", err)
	}

	// Create SSH CA
	sshCA := data.SSHCAData
	sshCA.UserID = userID
	_, err = tx.Exec(
		"INSERT INTO ssh_ca (user_id, public_key, server_share, server_verifying_share, client_verifying_share, cert_serial, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		sshCA.UserID, sshCA.PublicKey, sshCA.ServerShare, sshCA.ServerVerifyingShare, sshCA.ClientVerifyingShare, sshCA.CertSerial, sshCA.CreatedAt.Format(timeFormat),
	)
	if err != nil {
		return nil, fmt.Errorf("create SSH CA: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit transaction: %w", err)
	}

	return &RegistrationResult{UserID: userID}, nil
}

// AddCredentialToExistingUser adds a WebAuthn credential and SSH CA to an existing user
// in a single atomic transaction. Used when a user already exists but needs CA setup.
func AddCredentialToExistingUser(db *sql.DB, userID int64, cred WebAuthnCredential, encryptedMasterKey []byte, sshCA SSHCAData) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() {
		if err != nil {
			tx.Rollback()
		}
	}()

	// Save WebAuthn credential with master key
	_, err = tx.Exec(
		"INSERT INTO webauthn_credentials (id, user_id, public_key, sign_count, encrypted_master_key) VALUES (?, ?, ?, ?, ?)",
		cred.ID, userID, cred.PublicKey, cred.SignCount, encryptedMasterKey,
	)
	if err != nil {
		return fmt.Errorf("save credential: %w", err)
	}

	// Check if user already has SSH CA
	var existingCACount int
	err = tx.QueryRow("SELECT COUNT(*) FROM ssh_ca WHERE user_id = ?", userID).Scan(&existingCACount)
	if err != nil {
		return fmt.Errorf("check existing SSH CA: %w", err)
	}

	// Only create SSH CA if user doesn't have one
	if existingCACount == 0 {
		sshCA.UserID = userID
		if sshCA.CreatedAt.IsZero() {
			sshCA.CreatedAt = time.Now().UTC()
		}
		_, err = tx.Exec(
			"INSERT INTO ssh_ca (user_id, public_key, server_share, server_verifying_share, client_verifying_share, cert_serial, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			sshCA.UserID, sshCA.PublicKey, sshCA.ServerShare, sshCA.ServerVerifyingShare, sshCA.ClientVerifyingShare, sshCA.CertSerial, sshCA.CreatedAt.Format(timeFormat),
		)
		if err != nil {
			return fmt.Errorf("create SSH CA: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}

	return nil
}
