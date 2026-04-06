# Architecture Overview

This document provides a high-level overview of the devsesh system architecture.

## System Overview

Devsesh is a client-server system for tracking development sessions and long running processes across machines.

### How It Works

1. **Start the server** - Run `devsesh server` to start a server
2. **Create an account** - Open the web UI, register with email and a passkey
3. **Pair the CLI** - Run `devsesh login <server-url>` on all target machines to pair the CLI with the server
4. **Start sessions** - Run `devsesh start` on any paired machine to create a tracked tmux session
5. **Monitor** - View all sessions in real-time on the web dashboard


### Session Sync

When a session starts, the CLI:
1. Creates a session file (`~/.devsesh/sessions/<uuid>.yml`) with metadata
2. Starts a tmux session
3. Notifies the server via `POST /api/v1/sessions/{id}/start`

While the session runs, the CLI:
- **Pings the server** when there's output from the tmux session (debounced)
- **Watches the session file** for changes and syncs metadata to the server
- **Notifies the server** when the session ends

The server broadcasts all updates via WebSocket to connected web clients for real-time display.

 Users can edit the session YAML file (manually or through automated processes) at any time. The CLI watches the file and automatically syncs any changes to the server (as long as the session is active), making the metadata available in the web dashboard in real-time.
 
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

| Table                  | Purpose                                |
|------------------------|----------------------------------------|
| `migrations`           | Track applied migrations               |
| `server_config`        | Key-value config (includes JWT secret) |
| `users`                | User accounts                          |
| `webauthn_credentials` | Passkey credentials                    |
| `pairing_codes`        | Temporary pairing codes                |
| `sessions`             | Session records with metadata          |

## API Endpoints

All API endpoints are documented in [SERVER_ENDPOINTS.md](SERVER_ENDPOINTS.md).

## Security

- JWT tokens for API authentication
- WebAuthn/FIDO2 for passwordless authentication
- Config file permissions enforced (0600)
- JWT secret auto-generated if not provided
- Pairing codes expire after 5 minutes

## Deployment

The web client is embedded in the binary, making deployment a single-file operation.

```bash
# Run with defaults (localhost:8080)
./devsesh server

# Run on a specific host/port
DEVSESH_HOST=0.0.0.0 DEVSESH_PORT=9000 ./devsesh server

# Access
open http://localhost:8080
```
