-- User-assigned labels for a session, edited from the web UI. Stored as a JSON
-- array of strings (e.g. '["work","🔥 urgent"]'); '[]' means no tags. Kept apart
-- from `metadata` on purpose: metadata is overwritten wholesale by the CLI watcher,
-- while tags belong to the user. Not part of the (name, host) revival upsert, so
-- tags survive a session restart.
ALTER TABLE sessions ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
