-- Add SSH principal column to hosts table
ALTER TABLE hosts ADD COLUMN ssh_principal TEXT;