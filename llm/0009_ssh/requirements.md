# Devsesh SSH

Goal: use SSH to connect to a running tmux session and have it interactively displayed on the dashboard.

## Context

See README.md and all markdown files in `doc/` for the full project context. This feature builds on the hosts functionality from llm/0008_hosts.

## Architecture Overview

The server acts as a dumb TCP-over-WebSocket proxy. The browser runs an SSH client (Go compiled to WASM) and manages the SSH connection directly. SSH authentication uses password (temporary simplification; FIDO2/WebAuthn can be added later).

```
[Web Browser (SSH Client)] <--WebSocket (TCP proxy)--> [Devsesh Server] <--TCP--> [Host:22]
```

**Security model:** The server cannot see SSH session contents (end-to-end encrypted). Password is entered in browser and sent directly to host over SSH.

## Host SSH Configuration

Extend the hosts table to store SSH connection target info. [req.ssh001]

* Add `ssh_user` column to hosts table (username to connect as) [req.ssh002]
* Add `ssh_port` column to hosts table (defaults to 22) [req.ssh003]
* Update hosts management page to include SSH user and port fields [req.ssh006]
* Update hosts API endpoints to handle new SSH fields [req.ssh007]
* Create migration for the new SSH columns [req.ssh008]

## WebSocket TCP Proxy (Server)

The server provides a simple TCP-over-WebSocket proxy. It does not interpret SSH protocol. [req.ssh010]

* Upgrade `/api/v1/ssh/connect/{session_id}` to a WebSocket endpoint [req.ssh011]
* Validate that the user owns the session before allowing connection [req.ssh012]
* Look up the host's hostname/IP and SSH port from the hosts table [req.ssh013]
* Establish a raw TCP connection to host:port [req.ssh014]
* Bidirectionally proxy bytes between WebSocket and TCP socket [req.ssh015]
* Use binary WebSocket frames for raw TCP data [req.ssh016]
* Handle connection errors and report to client [req.ssh017]
* Clean up TCP connection when WebSocket closes [req.ssh018]
* Implement connection timeout for initial TCP connect [req.ssh019]

## WebSocket Message Protocol

Simple binary protocol for TCP-over-WebSocket. [req.ssh020]

* Binary frames contain raw TCP data (no encoding/wrapping) [req.ssh021]
* Text frames reserved for control messages (JSON) [req.ssh022]
* Control message types: "error", "connected", "closed" [req.ssh023]
* Error messages: `{"type": "error", "message": "..."}` [req.ssh024]
* Connected message: `{"type": "connected", "host": "...", "port": 22}` [req.ssh025]
* All SSH protocol framing handled by browser SSH client [req.ssh026]

## Browser SSH Client (Go WASM)

The browser runs a generic Go SSH client compiled to WebAssembly. This leverages the mature `golang.org/x/crypto/ssh` library. The Go WASM module handles SSH protocol only - application logic (e.g., running tmux) lives in TypeScript. [req.ssh030]

```
xterm.js (JS) ↔ TypeScript (app logic) ↔ Go SSH Client (WASM) ↔ WebSocket ↔ Server ↔ Host
```

### Go WASM SSH Client

Create a Go package that compiles to WASM and provides SSH client functionality. [req.ssh031]

* Create `web/wasm/sshclient/` package for the WASM SSH client [req.ssh032]
* Use `golang.org/x/crypto/ssh` for SSH protocol implementation [req.ssh033]
* Use `syscall/js` for JavaScript interop [req.ssh034]
* Compile with `GOOS=js GOARCH=wasm go build -o sshclient.wasm` [req.ssh035]
* Add wasm build to the project's build process [req.ssh036]

### WebSocket Transport Layer

Implement WebSocket transport that the Go SSH client uses. [req.ssh037]

* Create Go interface for network transport (abstracts WebSocket) [req.ssh038]
* Implement transport using browser WebSocket via `syscall/js` [req.ssh039]
* Bridge Go's `io.Reader`/`io.Writer` to WebSocket binary frames [req.ssh040]
* Handle WebSocket connection lifecycle (open, close, error) [req.ssh041]

### JavaScript API (Exported Functions)

Export functions from Go WASM for JavaScript to call. [req.ssh042]

* `Connect(wsURL, user string)` - establish SSH connection and authenticate [req.ssh043]
* `Disconnect()` - close SSH connection [req.ssh044]
* `Exec(command string)` - execute command with PTY [req.ssh045]
* `SendInput(data []byte)` - send terminal input to SSH session [req.ssh046]
* `Resize(rows, cols int)` - send window resize to SSH session [req.ssh047]
* `SetPasswordCallback(callback js.Func)` - register callback to prompt user for password [req.ssh048]
* `SetOutputCallback(callback js.Func)` - register callback for terminal output [req.ssh049]
* `SetStatusCallback(callback js.Func)` - register callback for connection status [req.ssh050]

### SSH Session Management

Implement generic SSH session logic in Go. No application-specific logic. [req.ssh051]

* Establish SSH connection through WebSocket transport [req.ssh052]
* Handle password authentication via JavaScript callback [req.ssh053]
* `Exec()` requests PTY with appropriate terminal modes [req.ssh054]
* `Exec()` runs the provided command on the remote host [req.ssh055]
* Forward terminal I/O between SSH channel and JavaScript callbacks [req.ssh056]
* Handle window-change requests for terminal resize [req.ssh057]
* Clean up resources on disconnect [req.ssh058]

### TypeScript Wrapper

Create TypeScript wrapper for the Go WASM module. [req.ssh059]

* Create `SSHClient` class in TypeScript that loads and manages the WASM module [req.ssh060]
* Handle WASM module initialization (`wasm_exec.js` + loading `.wasm` file) [req.ssh061]
* Provide typed API matching the exported Go functions [req.ssh062]
* Emit events for output, status changes, auth requests [req.ssh063]
* Integrate with React component lifecycle [req.ssh064]

### Application Logic (TypeScript)

Application-specific SSH usage lives in TypeScript, not Go WASM. [req.ssh065]

* After SSH connection established, call `Exec("tmux attach -t {session_name}")` [req.ssh066]
* Get session name from session metadata API [req.ssh067]
* Handle tmux-specific errors (e.g., session not found) [req.ssh068]
* Future: could support other commands beyond tmux attach [req.ssh069]

## Web Dashboard Terminal Component

Display terminal using xterm.js, connected to the Go WASM SSH client via TypeScript wrapper. [req.ssh080]

* Install xterm.js, xterm-addon-fit, and xterm-addon-webgl packages [req.ssh080a]
* Create `SSHTerminal` React component [req.ssh080b]
* Initialize xterm.js terminal instance [req.ssh080c]
* Connect to `SSHClient` TypeScript wrapper [req.ssh080d]
* Register output callback: Go WASM → SSHClient → xterm.js.write() [req.ssh080e]
* Register input handler: xterm.js.onData() → SSHClient → Go WASM [req.ssh080f]
* Handle resize: xterm-addon-fit → SSHClient.resize() → Go WASM [req.ssh080g]
* Style terminal to match dashboard theme (dark mode compatible) [req.ssh080h]
* Show loading state while WASM module initializes [req.ssh080i]

## Session Detail View with Terminal

Create a session detail page that shows the terminal. [req.ssh052]

* Add a "Connect" button to each session card on the dashboard [req.ssh053]
* Create a session detail route `/sessions/{session_id}` [req.ssh054]
* Display session metadata (name, host, status, start time) [req.ssh055]
* Embed the Terminal component for active sessions [req.ssh056]
* Show connection status indicator (connecting, authenticating, connected, disconnected) [req.ssh057]
* Show password dialog when SSH client requests authentication [req.ssh058]
* Add a disconnect button to close the SSH connection [req.ssh059]
* Handle reconnection if the connection drops [req.ssh060a]
* Display SSH host key fingerprint on first connection for user verification [req.ssh060b]

## SSH Password Authentication

SSH authentication uses password, entered via browser prompt. This is a temporary simplification; FIDO2/WebAuthn can be added later. [req.ssh063]

### Authentication Flow

```
Go SSH Client (WASM) → needs password → calls JS callback → React shows password dialog → user enters password → password returned to Go → SSH auth completes
```

### Implementation

* Go SSH client uses `ssh.Password()` auth method [req.ssh064]
* When password needed, Go calls JavaScript password callback [req.ssh065]
* JavaScript callback triggers React state update to show password dialog [req.ssh066]
* User enters password in dialog, clicks submit [req.ssh067]
* Password passed back to Go WASM to complete auth [req.ssh068]
* Handle auth failure (wrong password) - prompt again or show error [req.ssh069]

### UI Components

* Create `PasswordDialog` React component [req.ssh070]
* Show dialog when SSH client requests password [req.ssh071]
* Include username (read-only) and password input fields [req.ssh072]
* Handle cancel action (abort connection) [req.ssh073]
* Clear password from memory after use [req.ssh074]

Note: Server-side SSH handlers (`SSHWebAuthnBeginHandler`, `SSHWebAuthnCompleteHandler`) can be removed.

## Security Considerations

### Server-Side Security

* Validate session ownership before allowing WebSocket proxy connection [req.ssh080]
* Rate limit proxy connection attempts per user [req.ssh081]
* Log all proxy connection attempts for audit purposes [req.ssh082]
* Proxy connections should timeout after configurable idle period [req.ssh083]
* Only allow connections to hosts registered in the hosts table (no arbitrary host:port) [req.ssh084]

### Client-Side Security

* SSH session contents are end-to-end encrypted (server cannot see) [req.ssh085]
* Password entered in browser, sent directly to host over encrypted SSH channel [req.ssh086]
* Password not stored - cleared from memory after auth [req.ssh087]
* Browser SSH client should validate host keys to prevent MITM [req.ssh088]
* Consider host key pinning/TOFU (trust on first use) with user confirmation [req.ssh089]

### Future Enhancement

* Replace password auth with FIDO2/WebAuthn for hardware-backed security [req.ssh089a]

## Configuration

* Add `DEVSESH_SSH_TIMEOUT` environment variable for connection timeout (default: 30s) [req.ssh074]
* Add `DEVSESH_SSH_IDLE_TIMEOUT` environment variable for idle timeout (default: 30m) [req.ssh075]
* Add `DEVSESH_SSH_MAX_CONNECTIONS` environment variable for max concurrent proxy connections per user (default: 5) [req.ssh076]

## Testing

### Unit Tests (Server - TCP Proxy)

Server-side unit tests for the WebSocket TCP proxy. [req.ssh090]

* Test WebSocket upgrade handling [req.ssh091]
* Test session ownership validation [req.ssh092]
* Test TCP connection establishment to host [req.ssh093]
* Test bidirectional byte proxying [req.ssh094]
* Test connection error handling and client notification [req.ssh095]
* Test cleanup on WebSocket close [req.ssh096]
* Test rate limiting logic [req.ssh097]

### Unit Tests (Go WASM SSH Client)

Test the Go SSH client code (can run as native Go tests, not just in browser). [req.ssh098]

* Test SSH connection logic with mock transport [req.ssh099]
* Test PTY request and terminal mode handling [req.ssh100a]
* Test window resize handling [req.ssh100b]
* Test password auth callback flow [req.ssh100c]
* Test graceful disconnect and cleanup [req.ssh100d]
* Test error handling and recovery [req.ssh100e]

### Unit Tests (TypeScript Wrapper)

Test the TypeScript wrapper and React components. [req.ssh100f]

* Test SSHClient wrapper initialization [req.ssh100g]
* Test callback registration and invocation [req.ssh100h]
* Test password dialog component [req.ssh100i]
* Test React component lifecycle (mount, unmount, reconnect) [req.ssh100j]
* Test xterm.js integration [req.ssh100k]
* Mock the WASM module for isolated testing [req.ssh100l]

### Integration Tests with Docker

End-to-end tests using Docker container with real SSH server + tmux. [req.ssh101]

* Create a Dockerfile in `integration_tests/ssh/` with `openssh-server` and `tmux` [req.ssh102]
* Configure container with password authentication enabled [req.ssh103]
* Create test user with known password for automated testing [req.ssh104]
* Container should start a tmux session on startup for testing attachment [req.ssh105]
* Test full flow: start session on CLI, connect via browser, verify tmux output [req.ssh106]
* Test terminal input: send keystrokes, verify they execute in tmux [req.ssh107]
* Test terminal resize: send resize event, verify tmux receives new dimensions [req.ssh108]
* Test disconnection: close connection, verify cleanup [req.ssh109]
* Test reconnection behavior [req.ssh110]
* Test auth failure handling (wrong password) [req.ssh111]
* Add Docker to the Nix devshell if not already present [req.ssh112]
* Integration test script should start/stop the Docker container automatically [req.ssh113]

## Implementation Notes

* Read the `README.md` file to understand the overall project scope [req.ssh120]
* Read the markdown files in `doc/` to understand the project architecture [req.ssh121]
* Check llm/0008_hosts for hosts table structure and management [req.ssh122]
* Replace `internal/ssh/handler.go` stubs with TCP proxy implementation [req.ssh123]
* USE THE `flake.nix` FILE FOR ALL DEPENDENCIES [req.ssh125]
* Testing strategy: unit tests mock TCP connections; integration tests use Docker with real sshd+tmux [req.ssh126]
* **Start with proof-of-concept** to validate Go WASM + WebSocket + SSH flow [req.ssh127]
* Go WASM requires `wasm_exec.js` from Go installation (copy to web assets) [req.ssh128]
* Consider using TinyGo for smaller WASM binary if standard Go WASM is too large [req.ssh129]
* Go WASM is single-threaded; use goroutines carefully (they work but share the JS event loop) [req.ssh130]
