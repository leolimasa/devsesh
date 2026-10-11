# Database Tables

## migrations

Tracks which database migrations have been applied.

| Column     | Type     | Constraints                         |
|------------|----------|-------------------------------------|
| id         | INTEGER  | PRIMARY KEY                         |
| name       | TEXT     | NOT NULL, UNIQUE                    |
| applied_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP |

## server_config

Stores arbitrary key-value server configuration.

| Column | Type | Constraints |
|--------|------|-------------|
| key    | TEXT | PRIMARY KEY |
| value  | TEXT | NOT NULL    |

## users

User accounts in the system.

| Column     | Type     | Constraints                         |
|------------|----------|-------------------------------------|
| id         | INTEGER  | PRIMARY KEY, AUTOINCREMENT          |
| email      | TEXT     | NOT NULL, UNIQUE                    |
| created_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP |

## webauthn_credentials

Stores WebAuthn credentials for passwordless authentication linked to users.

| Column     | Type     | Constraints                         |
|------------|----------|-------------------------------------|
| id         | TEXT     | PRIMARY KEY                         |
| user_id    | INTEGER  | NOT NULL, FOREIGN KEY -> users(id)  |
| public_key | BLOB     | NOT NULL                            |
| sign_count | INTEGER  | NOT NULL, DEFAULT 0                 |
| created_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP |

## pairing_codes

Device pairing codes used to link hosts to user accounts.

| Column     | Type     | Constraints              |
|------------|----------|--------------------------|
| code       | TEXT     | PRIMARY KEY              |
| user_id    | INTEGER  | FOREIGN KEY -> users(id) |
| host_id    | INTEGER  | FOREIGN KEY -> hosts(id) |
| approved   | BOOLEAN  | NOT NULL, DEFAULT FALSE  |
| used       | BOOLEAN  | NOT NULL, DEFAULT FALSE  |
| expires_at | DATETIME | NOT NULL                 |

## sessions

Terminal sessions connecting users to hosts.

| Column           | Type     | Constraints                        |
|------------------|----------|------------------------------------|
| id               | TEXT     | PRIMARY KEY                        |
| user_id          | INTEGER  | NOT NULL, FOREIGN KEY -> users(id) |
| host_id          | INTEGER  | FOREIGN KEY -> hosts(id)           |
| name             | TEXT     | NOT NULL                           |
| started_at       | DATETIME | NOT NULL                           |
| last_ping_at     | DATETIME |                                    |
| last_activity_at | DATETIME |                                    |
| ended_at         | DATETIME |                                    |
| metadata         | TEXT     |                                    |
| seq              | INTEGER  | NOT NULL, DEFAULT 0                |
| tags             | TEXT     | NOT NULL, DEFAULT '[]'          |

`seq` is the user-controlled display order (ascending); a reorder rewrites it, filtering does not.
`tags` is a JSON array of user-assigned labels (for example `["work","🔥 urgent"]`). It is kept apart from
`metadata` because the CLI watcher overwrites metadata wholesale, and it is not touched when a session is
restarted, so tags survive a restart.

## hosts

Registered hosts that users can create sessions on.

| Column     | Type     | Constraints                        |
|------------|----------|------------------------------------|
| id         | INTEGER  | PRIMARY KEY                        |
| label      | TEXT     | NOT NULL                           |
| hostname   | TEXT     | NOT NULL                           |
| user_id    | INTEGER  | NOT NULL, FOREIGN KEY -> users(id) |
| ssh_user   | TEXT     | DEFAULT ''                         |
| ssh_port   | INTEGER  | DEFAULT 22                         |
| created_at | DATETIME | NOT NULL                           |
| updated_at | DATETIME | NOT NULL                           |

Unique constraint: (user_id, label)


## user_settings

Per-user settings: one row per user, one column per setting. A user with no row gets the defaults.

| Column     | Type      | Constraints                                         |
|------------|-----------|-----------------------------------------------------|
| user_id    | INTEGER   | PRIMARY KEY, FOREIGN KEY -> users(id) ON DELETE CASCADE |
| theme      | TEXT      | NOT NULL, DEFAULT 'dark-blue'                       |
| created_at | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP                 |
| updated_at | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP                 |
