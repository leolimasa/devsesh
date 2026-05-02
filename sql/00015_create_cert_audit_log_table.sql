-- Create certificate audit log table
CREATE TABLE IF NOT EXISTS cert_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    host_id INTEGER REFERENCES hosts(id),
    serial INTEGER,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cert_audit_log_user_id ON cert_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_cert_audit_log_created_at ON cert_audit_log(created_at);