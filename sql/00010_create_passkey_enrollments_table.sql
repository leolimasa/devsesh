CREATE TABLE IF NOT EXISTS passkey_enrollments (
    code       TEXT(8) PRIMARY KEY,
    user_id    INTEGER REFERENCES users(id),
    expires_at DATETIME NOT NULL,
    completed  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);