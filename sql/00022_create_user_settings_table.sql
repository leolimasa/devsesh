-- Per-user settings: exactly one row per user. Each setting is its own column;
-- new settings are added as columns in later migrations. The first setting is
-- the UI theme (see web/src/lib/themes.ts). Defaults to the original look,
-- "dark-blue".
CREATE TABLE user_settings (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme      TEXT NOT NULL DEFAULT 'dark-blue',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
