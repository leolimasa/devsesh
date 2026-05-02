-- Create table for storing encrypted client FROST shares
CREATE TABLE IF NOT EXISTS ssh_ca_client_shares (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    encrypted_share BLOB NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);