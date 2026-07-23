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

type Host struct {
	ID           int64     `json:"id"`
	Label        string    `json:"label"`
	Hostname     string    `json:"hostname"`
	SSHUser      string    `json:"ssh_user"`
	SSHPort      int       `json:"ssh_port"`
	SSHPrincipal string    `json:"ssh_principal"`
	UserID       int64     `json:"user_id"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type WebAuthnCredential struct {
	ID                 string
	UserID             int64
	PublicKey          []byte
	SignCount          uint32
	CreatedAt          time.Time
	EncryptedMasterKey []byte
	BackupEligible     bool
	BackupState        bool
}

type PasskeyEnrollment struct {
	Code      string
	UserID    *int64
	ExpiresAt time.Time
	Completed bool
	CreatedAt time.Time
}

type PairingCode struct {
	Code      string
	UserID    *int64
	HostID    *int64
	Approved  bool
	Used      bool
	ExpiresAt time.Time
}

type Session struct {
	ID         string     `json:"id"`
	UserID     int64      `json:"user_id"`
	HostID     int64      `json:"host_id"`
	Host       *Host      `json:"host,omitempty"`
	Name       string     `json:"name"`
	StartedAt  time.Time  `json:"started_at"`
	LastPingAt *time.Time `json:"last_ping_at"`
	EndedAt    *time.Time `json:"ended_at"`
	Metadata   *string    `json:"metadata"`
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
		"INSERT INTO webauthn_credentials (id, user_id, public_key, sign_count, backup_eligible, backup_state) VALUES (?, ?, ?, ?, ?, ?)",
		cred.ID, cred.UserID, cred.PublicKey, cred.SignCount, cred.BackupEligible, cred.BackupState,
	)
	if err != nil {
		return fmt.Errorf("save credential: %w", err)
	}
	return nil
}

func GetCredentialsByUserID(db *sql.DB, userID int64) ([]WebAuthnCredential, error) {
	rows, err := db.Query(
		"SELECT id, user_id, public_key, sign_count, created_at, encrypted_master_key, backup_eligible, backup_state FROM webauthn_credentials WHERE user_id = ?",
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("get credentials by user id: %w", err)
	}
	defer rows.Close()

	var creds []WebAuthnCredential
	for rows.Next() {
		var c WebAuthnCredential
		var createdAt string
		if err := rows.Scan(&c.ID, &c.UserID, &c.PublicKey, &c.SignCount, &createdAt, &c.EncryptedMasterKey, &c.BackupEligible, &c.BackupState); err != nil {
			return nil, fmt.Errorf("scan credential: %w", err)
		}
		c.CreatedAt, _ = parseTime(createdAt)
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
	var userID, hostID sql.NullInt64
	err := db.QueryRow(
		"SELECT code, user_id, host_id, approved, used, expires_at FROM pairing_codes WHERE code = ?",
		code,
	).Scan(&pc.Code, &userID, &hostID, &approved, &used, &expiresAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get pairing code: %w", err)
	}
	if userID.Valid {
		pc.UserID = &userID.Int64
	}
	if hostID.Valid {
		pc.HostID = &hostID.Int64
	}
	pc.Approved = approved != 0
	pc.Used = used != 0
	pc.ExpiresAt, _ = parseTime(expiresAt)
	return &pc, nil
}

func ApprovePairingCode(db *sql.DB, code string, userID int64, hostID int64) error {
	_, err := db.Exec("UPDATE pairing_codes SET approved = 1, user_id = ?, host_id = ? WHERE code = ?", userID, hostID, code)
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
	var lastPingAt *string
	if s.LastPingAt != nil {
		formatted := s.LastPingAt.UTC().Format(timeFormat)
		lastPingAt = &formatted
	}
	_, err := db.Exec(
		"INSERT INTO sessions (id, user_id, host_id, name, started_at, last_ping_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
		s.ID, s.UserID, s.HostID, s.Name, s.StartedAt.UTC().Format(timeFormat), lastPingAt, s.Metadata,
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
		"SELECT id, user_id, host_id, name, started_at, last_ping_at, ended_at, metadata FROM sessions WHERE user_id = ? ORDER BY started_at DESC",
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
		if err := rows.Scan(&s.ID, &s.UserID, &s.HostID, &s.Name, &startedAt, &lastPingAt, &endedAt, &metadata); err != nil {
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
	var h Host
	var startedAt string
	var lastPingAt, endedAt, metadata sql.NullString
	var hostID, hostUserID sql.NullInt64
	var hostLabel, hostHostname, hostSSHUser, hostSSHPrincipal sql.NullString
	var hostSSHPort sql.NullInt64
	var hostCreatedAt, hostUpdatedAt sql.NullString
	err := db.QueryRow(`
		SELECT s.id, s.user_id, s.host_id, s.name, s.started_at, s.last_ping_at, s.ended_at, s.metadata,
		       h.id, h.label, h.hostname, h.ssh_user, h.ssh_port, h.ssh_principal, h.user_id, h.created_at, h.updated_at
		FROM sessions s
		LEFT JOIN hosts h ON s.host_id = h.id
		WHERE s.id = ?`,
		id,
	).Scan(&s.ID, &s.UserID, &s.HostID, &s.Name, &startedAt, &lastPingAt, &endedAt, &metadata,
		&hostID, &hostLabel, &hostHostname, &hostSSHUser, &hostSSHPort, &hostSSHPrincipal, &hostUserID, &hostCreatedAt, &hostUpdatedAt)
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
	if hostID.Valid {
		h.ID = hostID.Int64
		h.Label = hostLabel.String
		h.Hostname = hostHostname.String
		h.SSHUser = hostSSHUser.String
		h.SSHPort = int(hostSSHPort.Int64)
		h.SSHPrincipal = hostSSHPrincipal.String
		h.UserID = hostUserID.Int64
		h.CreatedAt, _ = parseTime(hostCreatedAt.String)
		h.UpdatedAt, _ = parseTime(hostUpdatedAt.String)
		s.Host = &h
	}
	return &s, nil
}

func DeleteStaleSessions(db *sql.DB) (int64, error) {
	threshold := time.Now().Add(-1 * time.Hour)
	result, err := db.Exec(
		"DELETE FROM sessions WHERE ended_at IS NULL AND last_ping_at < ?",
		threshold.UTC().Format(timeFormat),
	)
	if err != nil {
		return 0, fmt.Errorf("delete stale sessions: %w", err)
	}
	return result.RowsAffected()
}

func DeleteCredential(db *sql.DB, id string) error {
	_, err := db.Exec("DELETE FROM webauthn_credentials WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete credential: %w", err)
	}
	return nil
}

func CreateHost(db *sql.DB, host Host) (int64, error) {
	now := time.Now().UTC()
	res, err := db.Exec(
		"INSERT INTO hosts (label, hostname, ssh_user, ssh_port, ssh_principal, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		host.Label, host.Hostname, host.SSHUser, host.SSHPort, host.SSHPrincipal, host.UserID, now.Format(timeFormat), now.Format(timeFormat),
	)
	if err != nil {
		return 0, fmt.Errorf("create host: %w", err)
	}
	return res.LastInsertId()
}

func GetHostByID(db *sql.DB, id int64) (*Host, error) {
	var h Host
	var createdAt, updatedAt string
	err := db.QueryRow(
		"SELECT id, label, hostname, ssh_user, ssh_port, ssh_principal, user_id, created_at, updated_at FROM hosts WHERE id = ?",
		id,
	).Scan(&h.ID, &h.Label, &h.Hostname, &h.SSHUser, &h.SSHPort, &h.SSHPrincipal, &h.UserID, &createdAt, &updatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get host by id: %w", err)
	}
	h.CreatedAt, _ = parseTime(createdAt)
	h.UpdatedAt, _ = parseTime(updatedAt)
	return &h, nil
}

func GetHostsByUserID(db *sql.DB, userID int64) ([]Host, error) {
	rows, err := db.Query(
		"SELECT id, label, hostname, ssh_user, ssh_port, ssh_principal, user_id, created_at, updated_at FROM hosts WHERE user_id = ? ORDER BY label",
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("get hosts by user id: %w", err)
	}
	defer rows.Close()

	var hosts []Host
	for rows.Next() {
		var h Host
		var createdAt, updatedAt string
		if err := rows.Scan(&h.ID, &h.Label, &h.Hostname, &h.SSHUser, &h.SSHPort, &h.SSHPrincipal, &h.UserID, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("scan host: %w", err)
		}
		h.CreatedAt, _ = parseTime(createdAt)
		h.UpdatedAt, _ = parseTime(updatedAt)
		hosts = append(hosts, h)
	}
	return hosts, rows.Err()
}

func UpdateHost(db *sql.DB, host Host) error {
	now := time.Now().UTC()
	_, err := db.Exec(
		"UPDATE hosts SET label = ?, hostname = ?, ssh_user = ?, ssh_port = ?, ssh_principal = ?, updated_at = ? WHERE id = ?",
		host.Label, host.Hostname, host.SSHUser, host.SSHPort, host.SSHPrincipal, now.Format(timeFormat), host.ID,
	)
	if err != nil {
		return fmt.Errorf("update host: %w", err)
	}
	return nil
}

func DeleteHost(db *sql.DB, id int64) error {
	_, err := db.Exec("DELETE FROM hosts WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete host: %w", err)
	}
	return nil
}

// QuickKey stores only user-defined quick keys and their pin/order state.
// Presets are client-side and are never persisted.
type QuickKey struct {
	ID           int64     `json:"id"`
	UserID       int64     `json:"user_id"`
	Name         string    `json:"name"`
	DisplayToken string    `json:"display_token"`
	Spec         string    `json:"spec"`
	Pinned       bool      `json:"pinned"`
	SortOrder    int       `json:"sort_order"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func CreateQuickKey(db *sql.DB, qk QuickKey) (int64, error) {
	now := time.Now().UTC()
	pinned := 0
	if qk.Pinned {
		pinned = 1
	}
	res, err := db.Exec(
		"INSERT INTO quick_keys (user_id, name, display_token, spec, pinned, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		qk.UserID, qk.Name, qk.DisplayToken, qk.Spec, pinned, qk.SortOrder, now.Format(timeFormat), now.Format(timeFormat),
	)
	if err != nil {
		return 0, fmt.Errorf("create quick key: %w", err)
	}
	return res.LastInsertId()
}

func GetQuickKeysByUserID(db *sql.DB, userID int64) ([]QuickKey, error) {
	rows, err := db.Query(
		"SELECT id, user_id, name, display_token, spec, pinned, sort_order, created_at, updated_at FROM quick_keys WHERE user_id = ? ORDER BY sort_order, id",
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("get quick keys by user id: %w", err)
	}
	defer rows.Close()

	var keys []QuickKey
	for rows.Next() {
		var k QuickKey
		var createdAt, updatedAt string
		var pinned int
		if err := rows.Scan(&k.ID, &k.UserID, &k.Name, &k.DisplayToken, &k.Spec, &pinned, &k.SortOrder, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("scan quick key: %w", err)
		}
		k.Pinned = pinned != 0
		k.CreatedAt, _ = parseTime(createdAt)
		k.UpdatedAt, _ = parseTime(updatedAt)
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

func GetQuickKeyByID(db *sql.DB, id int64) (*QuickKey, error) {
	var k QuickKey
	var createdAt, updatedAt string
	var pinned int
	err := db.QueryRow(
		"SELECT id, user_id, name, display_token, spec, pinned, sort_order, created_at, updated_at FROM quick_keys WHERE id = ?",
		id,
	).Scan(&k.ID, &k.UserID, &k.Name, &k.DisplayToken, &k.Spec, &pinned, &k.SortOrder, &createdAt, &updatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get quick key by id: %w", err)
	}
	k.Pinned = pinned != 0
	k.CreatedAt, _ = parseTime(createdAt)
	k.UpdatedAt, _ = parseTime(updatedAt)
	return &k, nil
}

func UpdateQuickKey(db *sql.DB, qk QuickKey) error {
	now := time.Now().UTC()
	pinned := 0
	if qk.Pinned {
		pinned = 1
	}
	_, err := db.Exec(
		"UPDATE quick_keys SET name = ?, display_token = ?, spec = ?, pinned = ?, sort_order = ?, updated_at = ? WHERE id = ?",
		qk.Name, qk.DisplayToken, qk.Spec, pinned, qk.SortOrder, now.Format(timeFormat), qk.ID,
	)
	if err != nil {
		return fmt.Errorf("update quick key: %w", err)
	}
	return nil
}

func DeleteQuickKey(db *sql.DB, id int64) error {
	_, err := db.Exec("DELETE FROM quick_keys WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete quick key: %w", err)
	}
	return nil
}

func GetHostByLabel(db *sql.DB, userID int64, label string) (*Host, error) {
	var h Host
	var createdAt, updatedAt string
	err := db.QueryRow(
		"SELECT id, label, hostname, ssh_user, ssh_port, ssh_principal, user_id, created_at, updated_at FROM hosts WHERE user_id = ? AND label = ?",
		userID, label,
	).Scan(&h.ID, &h.Label, &h.Hostname, &h.SSHUser, &h.SSHPort, &h.SSHPrincipal, &h.UserID, &createdAt, &updatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get host by label: %w", err)
	}
	h.CreatedAt, _ = parseTime(createdAt)
	h.UpdatedAt, _ = parseTime(updatedAt)
	return &h, nil
}

func CreatePasskeyEnrollment(db *sql.DB, code string, expiresAt time.Time) error {
	_, err := db.Exec(
		"INSERT INTO passkey_enrollments (code, expires_at) VALUES (?, ?)",
		code, expiresAt.UTC().Format(timeFormat),
	)
	if err != nil {
		return fmt.Errorf("create passkey enrollment: %w", err)
	}
	return nil
}

func GetPasskeyEnrollment(db *sql.DB, code string) (*PasskeyEnrollment, error) {
	var pe PasskeyEnrollment
	var expiresAt string
	var createdAt string
	var userID sql.NullInt64
	var completed int

	err := db.QueryRow(
		"SELECT code, user_id, expires_at, completed, created_at FROM passkey_enrollments WHERE code = ?",
		code,
	).Scan(&pe.Code, &userID, &expiresAt, &completed, &createdAt)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get passkey enrollment: %w", err)
	}

	if userID.Valid {
		pe.UserID = &userID.Int64
	}
	pe.ExpiresAt, _ = parseTime(expiresAt)
	pe.Completed = completed != 0
	pe.CreatedAt, _ = parseTime(createdAt)

	return &pe, nil
}

func LinkEnrollmentToUser(db *sql.DB, code string, userID int64) error {
	_, err := db.Exec(
		"UPDATE passkey_enrollments SET user_id = ? WHERE code = ?",
		userID, code,
	)
	if err != nil {
		return fmt.Errorf("link enrollment to user: %w", err)
	}
	return nil
}

func CompleteEnrollment(db *sql.DB, code string) error {
	_, err := db.Exec(
		"UPDATE passkey_enrollments SET completed = 1 WHERE code = ?",
		code,
	)
	if err != nil {
		return fmt.Errorf("complete enrollment: %w", err)
	}
	return nil
}

func SaveCredentialWithMasterKey(db *sql.DB, cred WebAuthnCredential, encryptedMasterKey []byte) error {
	_, err := db.Exec(
		"INSERT INTO webauthn_credentials (id, user_id, public_key, sign_count, encrypted_master_key, backup_eligible, backup_state) VALUES (?, ?, ?, ?, ?, ?, ?)",
		cred.ID, cred.UserID, cred.PublicKey, cred.SignCount, encryptedMasterKey, cred.BackupEligible, cred.BackupState,
	)
	if err != nil {
		return fmt.Errorf("save credential with master key: %w", err)
	}
	return nil
}

func GetCredentialWithMasterKey(db *sql.DB, credID string) (*WebAuthnCredential, error) {
	var c WebAuthnCredential
	var createdAt string

	err := db.QueryRow(
		"SELECT id, user_id, public_key, sign_count, created_at, encrypted_master_key FROM webauthn_credentials WHERE id = ?",
		credID,
	).Scan(&c.ID, &c.UserID, &c.PublicKey, &c.SignCount, &createdAt, &c.EncryptedMasterKey)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get credential with master key: %w", err)
	}

	c.CreatedAt, _ = parseTime(createdAt)
	return &c, nil
}

func GetFirstCredentialWithMasterKey(db *sql.DB, userID int64) (*WebAuthnCredential, error) {
	var c WebAuthnCredential
	var createdAt string

	err := db.QueryRow(
		"SELECT id, user_id, public_key, sign_count, created_at, encrypted_master_key FROM webauthn_credentials WHERE user_id = ? AND encrypted_master_key IS NOT NULL LIMIT 1",
		userID,
	).Scan(&c.ID, &c.UserID, &c.PublicKey, &c.SignCount, &createdAt, &c.EncryptedMasterKey)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get first credential with master key: %w", err)
	}

	c.CreatedAt, _ = parseTime(createdAt)
	return &c, nil
}

func GetSessionsWithHostByUserID(db *sql.DB, userID int64) ([]Session, error) {
	rows, err := db.Query(`
		SELECT s.id, s.user_id, s.host_id, s.name, s.started_at, s.last_ping_at, s.ended_at, s.metadata,
		       h.id, h.label, h.hostname, h.ssh_user, h.ssh_port, h.ssh_principal, h.user_id, h.created_at, h.updated_at
		FROM sessions s
		LEFT JOIN hosts h ON s.host_id = h.id
		WHERE s.user_id = ?
		ORDER BY s.started_at DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("get sessions with host by user id: %w", err)
	}
	defer rows.Close()

	var sessions []Session
	for rows.Next() {
		var s Session
		var h Host
		var hostID, hostUserID sql.NullInt64
		var hostLabel, hostHostname, hostSSHUser, hostSSHPrincipal sql.NullString
		var hostSSHPort sql.NullInt64
		var hostCreatedAt, hostUpdatedAt sql.NullString
		var startedAt string
		var lastPingAt, endedAt, metadata sql.NullString

		if err := rows.Scan(
			&s.ID, &s.UserID, &s.HostID, &s.Name, &startedAt, &lastPingAt, &endedAt, &metadata,
			&hostID, &hostLabel, &hostHostname, &hostSSHUser, &hostSSHPort, &hostSSHPrincipal, &hostUserID, &hostCreatedAt, &hostUpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan session with host: %w", err)
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
		if hostID.Valid {
			h.ID = hostID.Int64
			h.Label = hostLabel.String
			h.Hostname = hostHostname.String
			h.SSHUser = hostSSHUser.String
			if hostSSHPort.Valid {
				h.SSHPort = int(hostSSHPort.Int64)
			}
			h.SSHPrincipal = hostSSHPrincipal.String
			h.UserID = hostUserID.Int64
			if hostCreatedAt.Valid {
				h.CreatedAt, _ = parseTime(hostCreatedAt.String)
			}
			if hostUpdatedAt.Valid {
				h.UpdatedAt, _ = parseTime(hostUpdatedAt.String)
			}
			s.Host = &h
		}
		sessions = append(sessions, s)
	}
	return sessions, rows.Err()
}
