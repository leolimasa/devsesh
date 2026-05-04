-- Add verification shares to ssh_ca table for FROST Configuration
ALTER TABLE ssh_ca ADD COLUMN server_verifying_share BLOB NOT NULL DEFAULT '';
ALTER TABLE ssh_ca ADD COLUMN client_verifying_share BLOB NOT NULL DEFAULT '';