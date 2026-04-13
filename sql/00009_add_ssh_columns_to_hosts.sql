-- Add SSH columns to hosts table
ALTER TABLE hosts ADD COLUMN ssh_user TEXT DEFAULT '';
ALTER TABLE hosts ADD COLUMN ssh_port INTEGER DEFAULT 22;