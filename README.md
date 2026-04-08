# Devsesh

Devsesh is a centralized development session management and monitoring system. It tracks your development sessions across machines, providing real-time visibility into your work through a web dashboard. Sessions are created using the command line tool.

Ideal for monitoring AI agents and long running processes across machines.

## Features

- **Session Tracking** - Automatically track tmux sessions with metadata like project name, branch, and working directory
- **Passkey Authentication** - Secure WebAuthn/FIDO2 passkey-based login
- **Idle detection** - Automatically detect when sessions are idle (no stdout/stderr output)
- **Real-time Updates** - Live session updates via WebSocket
- **Machine Pairing** - Easily pair CLI clients with the web interface
- **SSH Integration** - Connect to sessions remotely via SSH
- **Cross-Platform UI** - Responsive web dashboard works on desktop and mobile

## Quick Start

### Run the Server

```bash
devsesh server
```

The server starts on `http://localhost:8080` by default.

### Start a session

1. Open the web interface at http://localhost:8080
2. Create an account with your email and a passkey
3. Start a session from the CLI:

```bash
devsesh login http://localhost:8080
devsesh start
```

## Usage

### CLI Commands

| Command                     | Description                               |
|-----------------------------|-------------------------------------------|
| `devsesh server`            | Start the devsesh server                  |
| `devsesh migrate`           | Run database migrations                   |
| `devsesh start [name]`      | Start a new tracked session               |
| `devsesh stop`              | End the current session                   |
| `devsesh list`              | List all sessions for the current machine |
| `devsesh attach [name]`     | Attach to a session                       |
| `devsesh resume [name]`     | Resume an inactive session                |
| `devsesh delete [name]`     | Delete a session                          |
| `devsesh set [key] [value]` | Set session metadata                      |
| `devsesh login [url]`       | Pair CLI with server                      |
| `devsesh logout`            | Clear stored credentials                  |

### Environment Variables

| Variable                      | Description               | Default                 |
|-------------------------------|---------------------------|-------------------------|
| `DEVSESH_SERVER_URL`          | Server URL                | (from config)           |
| `DEVSESH_JWT_TOKEN`          | JWT token                 | (from config)           |
| `DEVSESH_SESSION_DIR`        | Sessions directory        | `~/.devsesh/sessions/` |
| `DEVSESH_CONFIG_FILE`        | Config file path          | `~/.devsesh/config.yml` |
| `DEVSESH_HOST`               | Server host               | `localhost`             |
| `DEVSESH_PORT`               | Server port               | `8080`                  |
| `DEVSESH_JWT_SECRET`         | JWT signing secret        | (auto-generated)        |
| `DEVSESH_ALLOW_USER_CREATION`| Allow public registration | `false`                 |

## Architecture

For a detailed architecture overview, see [doc/ARCHITECTURE.md](doc/ARCHITECTURE.md).

### Tech Stack

- **Backend**: Go with standard library (HTTP, WebSocket, SQLite)
- **Frontend**: React + TypeScript + Vite + Tailwind + shadcn/ui
- **Session Management**: tmux
- **Database**: SQLite (embedded, no external DB required)
- **Authentication**: WebAuthn/FIDO2 passkeys + JWT

## Development

### Build

Install Nix: https://nixos.org/download.html, then:

```bash
# Enter development shell (includes all dependencies)
nix develop

# Build the binary
./build.sh

# Test
./test.sh

# Integration tests
integration_tests/integration_tests.sh
```

## Documentation

- [API Endpoints](doc/SERVER_ENDPOINTS.md)
- [Architecture](doc/ARCHITECTURE.md)

## License

MIT
