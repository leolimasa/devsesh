CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    hostname TEXT NOT NULL,
    started_at DATETIME NOT NULL,
    last_ping_at DATETIME,
    ended_at DATETIME,
    metadata TEXT
);
