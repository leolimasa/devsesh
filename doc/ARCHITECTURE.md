# Architecture Overview

This document provides a high-level overview of the devsesh system architecture.

## System Overview

Devsesh is a client-server system for tracking development sessions. The server runs locally on the developer's machine, while the web dashboard and CLI client connect to it to display and manage sessions.

```
┌─────────────┐         ┌─────────────┐
│  CLI Client │◄───────►│   Server    │
│  (devsesh)  │  HTTP   │   (Go)      │
└─────────────┘         └──────┬──────┘
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
              ┌─────────┐ ┌─────────┐ ┌─────────┐
              │ Web UI  │ │ SQLite  │ │  tmux   │
              │(React)  │ │   DB    │ │Sessions │
              └─────────┘ └─────────┘ └─────────┘
```

## Components

### Server (Go)

The Go server provides the backend API, serves the embedded web client, and manages session state.

**Key Responsibilities:**
- REST API for authentication, session management, and pairing
- WebSocket server for real-time session updates
- SQLite database for persistent storage
- JWT token management
- SSH tunnel handling

**Entry Point:** `main.go` → `cmd.ExecuteWithLogger()` → commands in `cmd/`

### CLI Client

The CLI is part of the same binary as the server, accessed via subcommands.

**Key Responsibilities:**
- Session lifecycle (start, stop, resume, delete)
- tmux process management
- Session file watching and metadata sync
- Device pairing with server

**Configuration:** `~/.devsesh/config.yml` or environment variables

### Web Client (React)

A React SPA embedded in the Go binary and served by the server.

**Key Responsibilities:**
- User authentication (passkey registration/login)
- Session dashboard with real-time updates
- Device pairing interface
- Passkey management

## Data Flow

### Session Start Flow

1. User runs `devsesh start myproject`
2. CLI generates UUID, creates session file at `~/.devsesh/sessions/<uuid>.yml`
3. CLI starts a new tmux session
4. CLI calls `POST /api/v1/sessions/<id>/start` to notify server
5. Server creates session record in SQLite
6. Server broadcasts update via WebSocket to connected web clients
7. Dashboard updates in real-time

### Authentication Flow

1. User visits web dashboard
2. If no users exist, prompted to register with email + passkey
3. Passkey registration uses WebAuthn protocol
4. After registration, user can login with passkey
5. Login issues JWT token (24h expiry by default)
6. Token stored in browser localStorage for API calls

### Pairing Flow (CLI Login)

1. User runs `devsesh login http://localhost:8080`
2. CLI requests pairing code from server: `POST /api/v1/auth/pair/start`
3. Server generates 6-character code, stores in DB (5min expiry)
4. User enters code in web dashboard Pairing page
5. Web client calls `POST /api/v1/auth/pair/exchange` (requires JWT)
6. Server marks code as approved
7. CLI polls `POST /api/v1/auth/pair/complete` until code approved
8. On success, CLI receives JWT token (30-day expiry)
9. CLI saves token and server URL to config file

## Database Schema

The SQLite database uses migrations stored in `sql/*.sql`:

| Table | Purpose |
|-------|---------|
| `migrations` | Track applied migrations |
| `server_config` | Key-value config (includes JWT secret) |
| `users` | User accounts |
| `webauthn_credentials` | Passkey credentials |
| `pairing_codes` | Temporary pairing codes |
| `sessions` | Session records with metadata |

## API Architecture

### Authentication Endpoints

- `POST /api/v1/auth/register/begin` - Start passkey registration
- `POST /api/v1/auth/register/finish` - Complete registration
- `POST /api/v1/auth/login/begin` - Start passkey login
- `POST /api/v1/auth/login/finish` - Complete login
- `POST /api/v1/auth/pair/start` - Request pairing code
- `POST /api/v1/auth/pair/exchange` - Approve pairing (web client)
- `POST /api/v1/auth/pair/complete` - Get JWT from pairing code
- `GET /api/v1/auth/passkeys` - List user's passkeys
- `POST /api/v1/auth/passkeys/begin` - Add new passkey
- `POST /api/v1/auth/passkeys/finish` - Complete passkey addition

### Session Endpoints

- `GET /api/v1/sessions` - List user's sessions
- `GET /api/v1/sessions/:id` - Get session details
- `POST /api/v1/sessions/:id/start` - Create session
- `POST /api/v1/sessions/:id/ping` - Update last ping
- `POST /api/v1/sessions/:id/end` - End session
- `POST /api/v1/sessions/:id/meta` - Update metadata
- `DELETE /api/v1/sessions/stale` - Remove stale sessions
- `GET /api/v1/sessions/updates` - WebSocket for real-time updates

### SSH Endpoints

- `GET /api/v1/ssh/connect/:session_id` - WebSocket SSH tunnel
- `POST /api/v1/ssh/webauthn/begin` - SSH key authorization
- `POST /api/v1/ssh/webauthn/complete` - Complete SSH auth

## Security

- JWT tokens for API authentication
- WebAuthn/FIDO2 for passwordless authentication
- Config file permissions enforced (0600)
- JWT secret auto-generated if not provided
- Pairing codes expire after 5 minutes

## Deployment

The server is designed to run locally on the developer's machine. The web client is embedded in the binary, making deployment a single-file operation.

```bash
# Build
./build.sh

# Run
./devsesh server

# Access
open http://localhost:8080
```
