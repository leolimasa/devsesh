-- Per-device master-key blobs.
--
-- An iCloud-synced passkey produces a device-specific WebAuthn PRF, so one
-- credential needs a distinct wrapped master key per device that uses it. This
-- table holds N blobs per credential (one per device PRF); the single-blob
-- column on webauthn_credentials is migrated in below and kept for rollback.
CREATE TABLE credential_key_blobs (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    credential_id      TEXT NOT NULL REFERENCES webauthn_credentials(id) ON DELETE CASCADE,
    wrapped_master_key BLOB NOT NULL,
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_credential_key_blobs_cred ON credential_key_blobs(credential_id);

-- Preserve every existing wrapped master key (no lockout, no re-enroll for
-- devices whose current blob still matches).
INSERT INTO credential_key_blobs (credential_id, wrapped_master_key)
SELECT id, encrypted_master_key
FROM webauthn_credentials
WHERE encrypted_master_key IS NOT NULL;
