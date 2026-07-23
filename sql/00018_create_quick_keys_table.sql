CREATE TABLE IF NOT EXISTS quick_keys (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    name          TEXT NOT NULL,
    display_token TEXT NOT NULL,
    spec          TEXT NOT NULL,
    pinned        INTEGER NOT NULL DEFAULT 0,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    DATETIME NOT NULL,
    updated_at    DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quick_keys_user_id ON quick_keys(user_id);
