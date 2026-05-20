package db

import (
	"database/sql"
	"fmt"
	"time"
)

type SSHCAData struct {
	UserID               int64
	PublicKey            []byte
	ServerShare          []byte
	ServerVerifyingShare []byte
	ClientVerifyingShare []byte
	CertSerial           int64
	CreatedAt            time.Time
}

type SSHCAClientShare struct {
	UserID         int64
	EncryptedShare []byte
	CreatedAt      time.Time
}

type CertAuditLog struct {
	ID           int64
	UserID       int64
	HostID       *int64
	Serial       *int64
	Success      bool
	ErrorMessage *string
	CreatedAt    time.Time
}

func CreateSSHCA(db *sql.DB, ca SSHCAData) error {
	_, err := db.Exec(
		"INSERT INTO ssh_ca (user_id, public_key, server_share, server_verifying_share, client_verifying_share, cert_serial, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		ca.UserID, ca.PublicKey, ca.ServerShare, ca.ServerVerifyingShare, ca.ClientVerifyingShare, ca.CertSerial, ca.CreatedAt.Format(timeFormat),
	)
	if err != nil {
		return fmt.Errorf("create SSH CA: %w", err)
	}
	return nil
}

func GetSSHCA(db *sql.DB, userID int64) (*SSHCAData, error) {
	var ca SSHCAData
	var createdAt string
	err := db.QueryRow(
		"SELECT user_id, public_key, server_share, server_verifying_share, client_verifying_share, cert_serial, created_at FROM ssh_ca WHERE user_id = ?",
		userID,
	).Scan(&ca.UserID, &ca.PublicKey, &ca.ServerShare, &ca.ServerVerifyingShare, &ca.ClientVerifyingShare, &ca.CertSerial, &createdAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get SSH CA: %w", err)
	}
	ca.CreatedAt, _ = parseTime(createdAt)
	return &ca, nil
}

func IncrementCertSerial(db *sql.DB, userID int64) (int64, error) {
	result, err := db.Exec(
		"UPDATE ssh_ca SET cert_serial = cert_serial + 1 WHERE user_id = ?",
		userID,
	)
	if err != nil {
		return 0, fmt.Errorf("increment cert serial: %w", err)
	}

	var newSerial int64
	err = db.QueryRow("SELECT cert_serial FROM ssh_ca WHERE user_id = ?", userID).Scan(&newSerial)
	if err != nil {
		return 0, fmt.Errorf("get new cert serial: %w", err)
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return 0, fmt.Errorf("no rows updated")
	}

	return newSerial, nil
}

// UpdateClientShare stores or updates the encrypted client share for a user.
// Uses UPSERT (INSERT OR REPLACE) to handle both create and update cases.
// This is called by the frontend after encrypting the client share with the master key.
func UpdateClientShare(db *sql.DB, userID int64, encryptedShare []byte) error {
	_, err := db.Exec(
		"INSERT OR REPLACE INTO ssh_ca_client_shares (user_id, encrypted_share, created_at) VALUES (?, ?, ?)",
		userID, encryptedShare, time.Now().UTC().Format(timeFormat),
	)
	if err != nil {
		return fmt.Errorf("update client share: %w", err)
	}
	return nil
}

func GetClientShare(db *sql.DB, userID int64) ([]byte, error) {
	var encryptedShare []byte
	err := db.QueryRow(
		"SELECT encrypted_share FROM ssh_ca_client_shares WHERE user_id = ?",
		userID,
	).Scan(&encryptedShare)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get client share: %w", err)
	}
	return encryptedShare, nil
}

func LogCertIssuance(db *sql.DB, userID int64, hostID *int64, serial *int64, success bool, errMsg string) error {
	var errorMessage *string
	if errMsg != "" {
		errorMessage = &errMsg
	}

	_, err := db.Exec(
		"INSERT INTO cert_audit_log (user_id, host_id, serial, success, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		userID, hostID, serial, success, errorMessage, time.Now().UTC().Format(timeFormat),
	)
	if err != nil {
		return fmt.Errorf("log cert issuance: %w", err)
	}
	return nil
}

func GetCertAuditLogsByUserID(db *sql.DB, userID int64) ([]CertAuditLog, error) {
	rows, err := db.Query(
		"SELECT id, user_id, host_id, serial, success, error_message, created_at FROM cert_audit_log WHERE user_id = ? ORDER BY created_at DESC",
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("get cert audit logs: %w", err)
	}
	defer rows.Close()

	var logs []CertAuditLog
	for rows.Next() {
		var log CertAuditLog
		var createdAt string
		var hostID, serial sql.NullInt64
		var errorMessage sql.NullString
		if err := rows.Scan(&log.ID, &log.UserID, &hostID, &serial, &log.Success, &errorMessage, &createdAt); err != nil {
			return nil, fmt.Errorf("scan cert audit log: %w", err)
		}
		if hostID.Valid {
			log.HostID = &hostID.Int64
		}
		if serial.Valid {
			log.Serial = &serial.Int64
		}
		if errorMessage.Valid {
			log.ErrorMessage = &errorMessage.String
		}
		log.CreatedAt, _ = parseTime(createdAt)
		logs = append(logs, log)
	}
	return logs, rows.Err()
}

func DeleteSSHCA(db *sql.DB, userID int64) error {
	_, err := db.Exec("DELETE FROM ssh_ca WHERE user_id = ?", userID)
	if err != nil {
		return fmt.Errorf("delete SSH CA: %w", err)
	}
	return nil
}

func DeleteClientShare(db *sql.DB, userID int64) error {
	_, err := db.Exec("DELETE FROM ssh_ca_client_shares WHERE user_id = ?", userID)
	if err != nil {
		return fmt.Errorf("delete client share: %w", err)
	}
	return nil
}

func DeleteCertAuditLogs(db *sql.DB, userID int64) error {
	_, err := db.Exec("DELETE FROM cert_audit_log WHERE user_id = ?", userID)
	if err != nil {
		return fmt.Errorf("delete cert audit logs: %w", err)
	}
	return nil
}
