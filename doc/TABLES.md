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

| Column       | Type     | Constraints                        |
|--------------|----------|------------------------------------|
| id           | TEXT     | PRIMARY KEY                        |
| user_id      | INTEGER  | NOT NULL, FOREIGN KEY -> users(id) |
| host_id      | INTEGER  | FOREIGN KEY -> hosts(id)           |
| name         | TEXT     | NOT NULL                           |
| started_at   | DATETIME | NOT NULL                           |
| last_ping_at | DATETIME |                                    |
| ended_at     | DATETIME |                                    |
| metadata     | TEXT     |                                    |

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
