CREATE TABLE IF NOT EXISTS hosts (
    id INTEGER PRIMARY KEY,
    label TEXT NOT NULL,
    hostname TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE (user_id, label)
);