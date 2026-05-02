-- Create SSH CA table for storing CA public key and server's FROST share
CREATE TABLE IF NOT EXISTS ssh_ca (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    public_key BLOB NOT NULL,
    server_share BLOB NOT NULL,
    cert_serial INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);