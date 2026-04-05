package db

import (
	"database/sql"
	"fmt"
	"time"
)

const timeFormat = "2006-01-02 15:04:05"

func parseTime(s string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	return time.Parse(timeFormat, s)
}

type User struct {
	ID        int64
	Email     string
	CreatedAt time.Time
}

type WebAuthnCredential struct {
	ID        string
	UserID    int64
	PublicKey []byte
	SignCount uint32
	CreatedAt time.Time
}

type PairingCode struct {
	Code      string
	UserID    *int64
	Approved  bool
	Used      bool
	ExpiresAt time.Time
}

type Session struct {
	ID         string
	UserID     int64
	Name       string
	Hostname   string
	StartedAt  time.Time
	LastPingAt *time.Time
	EndedAt    *time.Time
	Metadata   *string
}

func GetConfigValue(db *sql.DB, key string) (string, error) {
	var value string
	err := db.QueryRow("SELECT value FROM server_config WHERE key = ?", key).Scan(&value)
	return value, err
}

func SetConfigValue(db *sql.DB, key, value string) error {
	_, err := db.Exec(
		"INSERT INTO server_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
		key, value, value,
	)
	return err
}

func CreateUser(db *sql.DB, email string) (int64, error) {
	res, err := db.Exec("INSERT INTO users (email) VALUES (?)", email)
	if err != nil {
		return 0, fmt.Errorf("create user: %w", err)
	}
	return res.LastInsertId()
}

func GetUserByEmail(db *sql.DB, email string) (*User, error) {
	var u User
	var createdAt string
	err := db.QueryRow("SELECT id, email, created_at FROM users WHERE email = ?", email).
		Scan(&u.ID, &u.Email, &createdAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get user by email: %w", err)
	}
	u.CreatedAt, _ = parseTime(createdAt)
	return &u, nil
}

func GetUserByID(db *sql.DB, id int64) (*User, error) {
	var u User
	var createdAt string
	err := db.QueryRow("SELECT id, email, created_at FROM users WHERE id = ?", id).
		Scan(&u.ID, &u.Email, &createdAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get user by id: %w", err)
	}
	u.CreatedAt, _ = parseTime(createdAt)
	return &u, nil
}

func CountUsers(db *sql.DB) (int, error) {
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	return count, err
}

func SaveCredential(db *sql.DB, cred WebAuthnCredential) error {
	_, err := db.Exec(
		"INSERT INTO webauthn_credentials (id, user_id, public_key, sign_count) VALUES (?, ?, ?, ?)",
		cred.ID, cred.UserID, cred.PublicKey, cred.SignCount,
	)
	if err != nil {
		return fmt.Errorf("save credential: %w", err)
	}
	return nil
}

func GetCredentialsByUserID(db *sql.DB, userID int64) ([]WebAuthnCredential, error) {
	rows, err := db.Query(
		"SELECT id, user_id, public_key, sign_count FROM webauthn_credentials WHERE user_id = ?",
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("get credentials by user id: %w", err)
	}
	defer rows.Close()

	var creds []WebAuthnCredential
	for rows.Next() {
		var c WebAuthnCredential
		if err := rows.Scan(&c.ID, &c.UserID, &c.PublicKey, &c.SignCount); err != nil {
			return nil, fmt.Errorf("scan credential: %w", err)
		}
		creds = append(creds, c)
	}
	return creds, rows.Err()
}

func UpdateCredentialSignCount(db *sql.DB, credID string, count uint32) error {
	_, err := db.Exec(
		"UPDATE webauthn_credentials SET sign_count = ? WHERE id = ?",
		count, credID,
	)
	if err != nil {
		return fmt.Errorf("update credential sign count: %w", err)
	}
	return nil
}

func CreatePairingCode(db *sql.DB, code string, expiresAt time.Time) error {
	_, err := db.Exec(
		"INSERT INTO pairing_codes (code, expires_at) VALUES (?, ?)",
		code, expiresAt.UTC().Format(timeFormat),
	)
	if err != nil {
		return fmt.Errorf("create pairing code: %w", err)
	}
	return nil
}

func GetPairingCode(db *sql.DB, code string) (*PairingCode, error) {
	var pc PairingCode
	var expiresAt string
	var approved, used int
	var userID sql.NullInt64
	err := db.QueryRow(
		"SELECT code, user_id, approved, used, expires_at FROM pairing_codes WHERE code = ?",
		code,
	).Scan(&pc.Code, &userID, &approved, &used, &expiresAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get pairing code: %w", err)
	}
	if userID.Valid {
		pc.UserID = &userID.Int64
	}
	pc.Approved = approved != 0
	pc.Used = used != 0
	pc.ExpiresAt, _ = parseTime(expiresAt)
	return &pc, nil
}

func ApprovePairingCode(db *sql.DB, code string, userID int64) error {
	_, err := db.Exec("UPDATE pairing_codes SET approved = 1, user_id = ? WHERE code = ?", userID, code)
	if err != nil {
		return fmt.Errorf("approve pairing code: %w", err)
	}
	return nil
}

func MarkPairingCodeUsed(db *sql.DB, code string) error {
	_, err := db.Exec("UPDATE pairing_codes SET used = 1 WHERE code = ?", code)
	if err != nil {
		return fmt.Errorf("mark pairing code used: %w", err)
	}
	return nil
}

func CreateSession(db *sql.DB, s Session) error {
	_, err := db.Exec(
		"INSERT INTO sessions (id, user_id, name, hostname, started_at, metadata) VALUES (?, ?, ?, ?, ?, ?)",
		s.ID, s.UserID, s.Name, s.Hostname, s.StartedAt.UTC().Format(timeFormat), s.Metadata,
	)
	if err != nil {
		return fmt.Errorf("create session: %w", err)
	}
	return nil
}

func UpdateSessionPing(db *sql.DB, id string, t time.Time) error {
	_, err := db.Exec(
		"UPDATE sessions SET last_ping_at = ? WHERE id = ?",
		t.UTC().Format(timeFormat), id,
	)
	if err != nil {
		return fmt.Errorf("update session ping: %w", err)
	}
	return nil
}

func EndSession(db *sql.DB, id string, t time.Time) error {
	_, err := db.Exec(
		"UPDATE sessions SET ended_at = ? WHERE id = ?",
		t.UTC().Format(timeFormat), id,
	)
	if err != nil {
		return fmt.Errorf("end session: %w", err)
	}
	return nil
}

func UpdateSessionMeta(db *sql.DB, id, metadata string) error {
	_, err := db.Exec(
		"UPDATE sessions SET metadata = ? WHERE id = ?",
		metadata, id,
	)
	if err != nil {
		return fmt.Errorf("update session meta: %w", err)
	}
	return nil
}

func GetSessionsByUserID(db *sql.DB, userID int64) ([]Session, error) {
	rows, err := db.Query(
		"SELECT id, user_id, name, hostname, started_at, last_ping_at, ended_at, metadata FROM sessions WHERE user_id = ? ORDER BY started_at DESC",
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("get sessions by user id: %w", err)
	}
	defer rows.Close()

	var sessions []Session
	for rows.Next() {
		var s Session
		var startedAt string
		var lastPingAt, endedAt, metadata sql.NullString
		if err := rows.Scan(&s.ID, &s.UserID, &s.Name, &s.Hostname, &startedAt, &lastPingAt, &endedAt, &metadata); err != nil {
			return nil, fmt.Errorf("scan session: %w", err)
		}
		s.StartedAt, _ = parseTime(startedAt)
		if lastPingAt.Valid {
			t, _ := parseTime(lastPingAt.String)
			s.LastPingAt = &t
		}
		if endedAt.Valid {
			t, _ := parseTime(endedAt.String)
			s.EndedAt = &t
		}
		if metadata.Valid {
			s.Metadata = &metadata.String
		}
		sessions = append(sessions, s)
	}
	return sessions, rows.Err()
}

func GetSession(db *sql.DB, id string) (*Session, error) {
	var s Session
	var startedAt string
	var lastPingAt, endedAt, metadata sql.NullString
	err := db.QueryRow(
		"SELECT id, user_id, name, hostname, started_at, last_ping_at, ended_at, metadata FROM sessions WHERE id = ?",
		id,
	).Scan(&s.ID, &s.UserID, &s.Name, &s.Hostname, &startedAt, &lastPingAt, &endedAt, &metadata)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get session: %w", err)
	}
	s.StartedAt, _ = parseTime(startedAt)
	if lastPingAt.Valid {
		t, _ := parseTime(lastPingAt.String)
		s.LastPingAt = &t
	}
	if endedAt.Valid {
		t, _ := parseTime(endedAt.String)
		s.EndedAt = &t
	}
	if metadata.Valid {
		s.Metadata = &metadata.String
	}
	return &s, nil
}
