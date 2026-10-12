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

Liveness and activity are bound to the **tmux session's** lifetime, not to the
shell that launched it. A tmux session lives in the tmux server daemon (which is
reparented to `init`), so it outlives the process that created it — closing your
terminal or dropping an SSH connection must not stop its monitoring. To achieve
this, monitoring is owned by a dedicated `devsesh watch` process that is
decoupled from the foreground `devsesh start`.

When a session starts, `devsesh start`:
1. Creates a session file (`~/.devsesh/sessions/<uuid>.yml`) with metadata
2. Creates a **detached** tmux session (injecting the `DEVSESH_*` env vars)
3. Spawns a detached `devsesh watch` process — placed in its own session via
   `setsid`, so a `SIGHUP` delivered when the launching terminal/SSH connection
   closes cannot reach it
4. Replaces itself with an interactive `tmux attach`

The `devsesh watch <name>` process owns the session's server-side lifecycle for
as long as the tmux session is alive. It observes the session in tmux **control
mode** (`tmux -C attach -r` — a read-only client that receives all pane output
but is excluded from window-size calculations, so it never disturbs the
interactive client's size), and:
- **Registers the session** via `POST /api/v1/sessions/{id}/start`
- **Pings the server** every 5 seconds to signal liveness (drives `last_ping_at`, used for stale session cleanup)
- **Sends activity events** for pane output observed over control mode (throttled to at most 1/sec, drives `last_activity_at`, used for the Active indicator). Output that leaves what the session shows unchanged (e.g. nvim redrawing its status line on a timer) is ignored: each throttled signal is compared against a hash of every pane's visible content
- **Watches the session file** for changes and syncs metadata to the server
- **Notifies the server that the session ended** (`POST /api/v1/sessions/{id}/end`) only when the tmux session itself is gone — detaching or an SSH drop does **not** end the session

Because the watcher lives in the tmux server's world rather than the launching
shell's, closing your terminal or dropping SSH leaves the session monitored and
its heartbeat flowing. `devsesh watch <name>` can also be run standalone to
(re)attach monitoring to any existing tmux session that has no watcher.

The server broadcasts all updates via WebSocket to connected web clients for real-time display.

 Users can edit the session YAML file (manually or through automated processes) at any time. The CLI watches the file and automatically syncs any changes to the server (as long as the session is active), making the metadata available in the web dashboard in real-time.
 
## Components

### Server (Go)

The Go server provides the backend API, serves the embedded web client, and manages session state.

**Key Responsibilities:**
- REST API for authentication, session management, and pairing
- SQLite database for persistent storage (WAL mode with `synchronous=NORMAL`; the `-wal` file must be copied along with the database)
- SQLite database for persistent storage
- JWT token management
- SSH tunnel handling

**Entry Point:** `main.go` → `cmd.ExecuteWithLogger()` → commands in `cmd/`

### CLI Client

The CLI is part of the same binary as the server, accessed via subcommands.

**Key Responsibilities:**
- Session lifecycle (start, stop, resume, delete)
- tmux process management
- Session-lifetime liveness/activity monitoring via a detached `devsesh watch` process (control mode)
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

#### Browser SSH connections

The terminal runs a Go/wasm SSH client (`web/wasm/sshclient`) that is loaded once per page and outlives any one terminal component. It keeps a pool of SSH connections, one per host, each over its own WebSocket to the server's SSH proxy (`internal/ssh`).

- **Reuse.** Switching sessions on the same host, or opening a session from the dashboard or after a route change, reuses the pooled connection: no new WebSocket, no new certificate, no new unlock. When the terminal unmounts it keeps established connections pooled (`SSHClient.detach()` stops event delivery) and only abandons handshakes that are still waiting for an unlock (`disconnectPending()`).
- **Bounded pool** (`pool.go`). At most `maxPooledConns` (3, always below the server's default per-user limit of 5) connections are kept; one that has not been the active host for 10 minutes is released, checked on every connect and once a minute. Releasing only drops the SSH link; the tmux session keeps running on the host.
- **One handshake at a time.** Handshakes take turns on `connectSem` (the unlock resolvers are global). The wait is cancellable: tearing a connection down aborts a handshake that is waiting for its turn or for the unlock, so one abandoned unlock cannot leave every other connect stuck at "Connecting".
- **Server limit.** `DEVSESH_SSH_MAX_CONNECTIONS` (default 5; 20 on apps1 via `services.apps-custom.devsesh.sshMaxConnections`) caps a user's simultaneous proxy connections across all tabs and devices. An over-limit attempt is currently dropped without a message (known gap, see the skipped `TestRefusalIsExplainedToTheClient`).

#### Session tags

Each session has a list of tags (`sessions.tags`), edited in the Details pane of the session page (`TagEditor`, saved through `PUT /api/v1/sessions/{id}/tags`). They show on every row of the Sessions pane and the dashboard (`TagChips`), and a funnel button (`TagFilter`) filters both lists to sessions with ANY of the ticked tags.

- **Filtering is only a view.** `useTagFilter` hides sessions on screen; the stored order (`seq`) never changes by filtering. Row numbers in the Sessions pane (and the Ctrl+N shortcut) count the visible list, so they have no gaps. The selection is saved in the browser (`localStorage` key `tagFilter`) and shared by the dashboard and the session page. Tags that no session has any more are ignored.
- **Reordering a filtered list** (`mergeReorder` in `lib/tags.ts`): hidden sessions keep their slots and the visible ones shuffle among theirs, so only then does `seq` change.
- **New session and filter** share one toolbar at the top of the Sessions tab: a `+` icon (new session) and the funnel.

#### Themes

The UI and the xterm.js terminal share one theme, chosen per user in Settings and stored server-side (`user_settings.theme`, cached in `localStorage`). Themes live in `web/src/lib/themes.ts`; the backend's `validThemes` (`internal/settings/handler.go`) must list the same ids.

- **Colors:** each theme sets the shadcn CSS variables (HSL triplets) plus an xterm palette. `applyTheme()` writes them on `<html>`, removes variables that another theme set but the new one does not (so nothing leaks across switches), and sets `data-theme="<id>"`.
- **Skins:** a theme that needs more than colors (display font, glow, bevels) adds a `[data-theme="<id>"]` block to `web/src/index.css`. Components expose `data-ui` / `data-variant` hooks (`Button`, `Card`, `Badge`, `Input`, and the session side pane: `side-pane`, `panel-tabs`, `panel-tab`, `session-item`, `session-index`, `session-dot`, `tag`, `tag-filter-panel`) for it; text a user typed (e.g. a session name) is marked `data-user-content` so skins keep it in the readable body font. Themes without a skin block are unaffected.
- **Themes:** `dark-blue` (default), `one-dark`, and `scifi-rts` (StarCraft II front-end look: navy-black, electric blue, amber primary action, Michroma headings).
- **Accessibility:** `themes.test.ts` checks every `scifi-rts` text pair for 4.5:1 contrast and every UI-edge pair for 3:1. Do the same for a new theme's palette.
- **Terminal companions:** `scifi-rts` has matching tmux and neovim themes in the `home-manager` repo (`terminalTheme` option); keep the palettes in sync.

## Data Flow

### Session Start Flow

1. User runs `devsesh start myproject`
2. CLI generates UUID, creates session file at `~/.devsesh/sessions/<uuid>.yml`
3. CLI creates a **detached** tmux session (injecting the `DEVSESH_*` env vars)
4. CLI spawns a detached `devsesh watch` process bound to the tmux session's lifetime
5. `devsesh watch` calls `POST /api/v1/sessions/<id>/start` to register the session
6. Server creates session record in SQLite and broadcasts via WebSocket
7. CLI replaces itself with `tmux attach`; the watcher keeps pinging/observing independently
8. Dashboard updates in real-time

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

## Batched session writes

Pings (every 5 s per watcher) and activity (up to 1 per second per busy session) are the most frequent writes. `PingHandler` and `ActivityHandler` only record the newest time per session in memory (`sessions.Touches`); a loop writes everything pending in one transaction every 2 seconds (`sessions.DefaultTouchFlushInterval`) and once more on shutdown. The live WebSocket broadcast carries the fresh time at once, so open dashboards are not delayed. Reads from the database can lag by up to the flush interval, which is invisible because every consumer uses a window of 5 s or more. A crash loses at most the last interval of pings and activity. A failed flush is logged and retried on the next tick.

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
