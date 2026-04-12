-- Delete all existing sessions first
DELETE FROM sessions;

-- Add host_id to pairing_codes table first
ALTER TABLE pairing_codes ADD COLUMN host_id INTEGER;

-- Drop old sessions table and recreate with host_id instead of hostname
DROP TABLE sessions;

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    host_id INTEGER REFERENCES hosts(id),
    name TEXT NOT NULL,
    started_at DATETIME NOT NULL,
    last_ping_at DATETIME,
    ended_at DATETIME,
    metadata TEXT
);