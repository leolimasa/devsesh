-- Persist the WebAuthn Backup Eligible (BE) and Backup State (BS) flags for each
-- credential. go-webauthn rejects a login when the stored BE flag differs from
-- the one presented in the assertion ("Backup Eligible flag inconsistency").
-- Synced passkeys (iCloud Keychain, Google Password Manager) are BE=1, so
-- without persisting these flags every synced/discoverable passkey fails login.
-- Existing rows default to 0; those credentials must be re-registered.
ALTER TABLE webauthn_credentials ADD COLUMN backup_eligible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE webauthn_credentials ADD COLUMN backup_state INTEGER NOT NULL DEFAULT 0;
