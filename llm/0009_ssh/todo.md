# SSH Implementation TODO

This checklist implements SSH connectivity for devsesh as described in requirements.md and implementation.md.

---

## Project Status

- 🟢 COMMITTED: Phase 1 (Database & Configuration) - SSH columns migration, Go struct, Config, TypeScript types
- 🟢 COMMITTED: Phase 2 (Server-Side TCP Proxy) - proxy.go, handler.go, server.go, security
- 🟢 COMMITTED: Phase 3 (Go WASM SSH Client) - transport.go, client.go, main.go, build script
- 🟢 COMMITTED: Phase 4 (TypeScript/React Frontend) - SSHClient wrapper, components, pages
- 🟢 COMMITTED: Phase 5 (Session Detail View) - Connect button, terminal, password dialog
- 🟢 COMMITTED: Phase 6 (Integration Tests) - Docker setup and test scripts
- 🟢 COMMITTED: Phase 7 (Documentation) - Update docs

---

## Phase 1: Database & Configuration

### Database Migration
- [x] Create `sql/00009_add_ssh_columns_to_hosts.sql` with SSH columns [req.ssh008]
  - [x] Add `ssh_user TEXT DEFAULT ''` column [req.ssh002]
  - [x] Add `ssh_port INTEGER DEFAULT 22` column [req.ssh003]

### Go Struct Updates
- [x] Modify `internal/db/queries.go` Host struct to include SSH fields [req.ssh001]
  - [x] Add `SSHUser string` field [req.ssh002]
  - [x] Add `SSHPort int` field [req.ssh003]
- [x] Update `CreateHost()` to include `ssh_user`, `ssh_port` [req.ssh007]
- [x] Update `GetHostByID()` to include `ssh_user`, `ssh_port` [req.ssh007]
- [x] Update `GetHostsByUserID()` to include `ssh_user`, `ssh_port` [req.ssh007]
- [x] Update `UpdateHost()` to include `ssh_user`, `ssh_port` [req.ssh007]
- [x] Update `GetHostByLabel()` to include `ssh_user`, `ssh_port` [req.ssh007]

### Configuration
- [x] Modify `internal/config/config.go` to add SSH configuration fields [req.ssh074] [req.ssh075] [req.ssh076]
  - [x] Add `SSHTimeout time.Duration` field [req.ssh074]
  - [x] Add `SSHIdleTimeout time.Duration` field [req.ssh075]
  - [x] Add `SSHMaxConnections int` field [req.ssh076]
- [x] Modify `LoadFromEnv()` to parse SSH environment variables [req.ssh074] [req.ssh075] [req.ssh076]
  - [x] Parse `DEVSESH_SSH_TIMEOUT` (default: 30s) [req.ssh074]
  - [x] Parse `DEVSESH_SSH_IDLE_TIMEOUT` (default: 30m) [req.ssh075]
  - [x] Parse `DEVSESH_SSH_MAX_CONNECTIONS` (default: 5) [req.ssh076]

### TypeScript Types
- [x] Modify `web/src/types/api.ts` Host interface to include SSH fields [req.ssh007]
  - [x] Add `ssh_user: string` field [req.ssh002]
  - [x] Add `ssh_port: number` field [req.ssh003]

### Testing Phase 1
- [x] Run existing Go unit tests to ensure no regressions
- [x] Run database migration against test database
- [x] Verify host API endpoints still work with new fields

---

## Phase 2: Server-Side TCP Proxy

### TCP Proxy Implementation
- [x] Create `internal/ssh/proxy.go` [req.ssh010]
  - [x] Define `TCPProxy struct` with `ws`, `tcp`, `done` fields
  - [x] Implement `NewTCPProxy(ws, tcp) *TCPProxy`
  - [x] Implement `Run()` for bidirectional proxying [req.ssh015]
    - [x] Use binary WebSocket frames for raw TCP data [req.ssh016] [req.ssh021]
    - [x] Clean up TCP connection when WebSocket closes [req.ssh018]
  - [x] Implement `sendControlMessage()` for JSON control messages [req.ssh022]

### WebSocket Handler
- [x] Create `internal/ssh/handler.go` with `ConnectHandler` [req.ssh011]
  - [x] Extract user ID from JWT context [req.ssh012]
  - [x] Get host ID from path parameter
  - [x] Look up host and verify user ownership [req.ssh012] [req.ssh013]
  - [x] Upgrade HTTP to WebSocket connection
  - [x] Dial TCP to host:port with timeout [req.ssh014] [req.ssh019]
  - [x] Send "connected" control message [req.ssh025]
  - [x] Handle connection errors and report to client [req.ssh017] [req.ssh024]
  - [x] Send "closed" control message on completion [req.ssh023]
  - [x] Only allow connections to registered hosts [req.ssh084]

### Security Features
- [x] Implement rate limiting per user [req.ssh081]
- [x] Implement audit logging for connection attempts [req.ssh082]
- [x] Implement idle timeout [req.ssh083]
- [x] Validate session ownership [req.ssh080]

### Route Registration
- [x] Modify `internal/server/server.go` to add SSH WebSocket route
- [x] Remove old `ssh.RegisterRoutes()` call if present [req.ssh123]

### Hosts Handler Updates
- [x] Modify `internal/hosts/handler.go` CreateHandler to accept SSH fields [req.ssh007]
- [x] Modify `internal/hosts/handler.go` UpdateHandler to accept SSH fields [req.ssh007]

### Testing Phase 2
- [x] Create `internal/ssh/proxy_test.go` [req.ssh090]
  - [x] Test bidirectional data flow [req.ssh094]
  - [x] Test WebSocket close cleanup [req.ssh096]
  - [x] Test TCP close cleanup
  - [x] Test connection error handling [req.ssh095]
  - [x] Test rate limiting logic [req.ssh097]
- [x] Create `internal/ssh/handler_test.go` [req.ssh090]
  - [x] Test WebSocket upgrade [req.ssh091]
  - [x] Test host ownership validation [req.ssh092]
  - [x] Test host lookup and TCP connection [req.ssh093]
- [x] Run `go test ./internal/ssh/...` to verify all tests pass

---

## Phase 3: Go WASM SSH Client

### Project Structure
- [x] Create `web/wasm/sshclient/` directory [req.ssh032]
- [x] Add `golang.org/x/crypto/ssh` dependency [req.ssh033]

### WebSocket Transport
- [x] Create `web/wasm/sshclient/transport.go` [req.ssh037]
  - [x] Define `WSTransport struct` implementing `net.Conn` [req.ssh038]
  - [x] Implement `NewWSTransport(wsURL)` using `syscall/js` [req.ssh039] [req.ssh034]
  - [x] Implement `Read()` bridging WebSocket to `io.Reader` [req.ssh040]
  - [x] Implement `Write()` bridging `io.Writer` to WebSocket [req.ssh040]
  - [x] Implement `Close()` and other `net.Conn` methods
  - [x] Handle WebSocket lifecycle (open, close, error) [req.ssh041]

### SSH Client Logic
- [x] Create `web/wasm/sshclient/client.go` [req.ssh051]
  - [x] Define global state for current client/session
  - [x] Implement `Connect(wsURL, user)` [req.ssh043] [req.ssh052]
  - [x] Implement `Disconnect()` [req.ssh044] [req.ssh058]
  - [x] Implement `Exec(command)` with PTY request [req.ssh045] [req.ssh054] [req.ssh055]
  - [x] Implement `SendInput(data)` [req.ssh046]
  - [x] Implement `Resize(rows, cols)` [req.ssh047] [req.ssh057]
  - [x] Implement `SetPasswordCallback()` [req.ssh048]
  - [x] Implement `SetOutputCallback()` [req.ssh049]
  - [x] Implement `SetStatusCallback()` [req.ssh050]
  - [x] Implement `passwordAuthCallback()` for SSH auth [req.ssh053] [req.ssh064] [req.ssh065]
  - [x] Forward terminal I/O via callbacks [req.ssh056]
  - [x] Use `ssh.Password()` auth method [req.ssh064]

### WASM Entry Point
- [x] Create `web/wasm/sshclient/main.go` [req.ssh030] [req.ssh031]
  - [x] Register all exported functions via `syscall/js` [req.ssh042] [req.ssh034]
  - [x] Block forever to keep WASM alive

### Build Script
- [x] Create `build_wasm.sh` script [req.ssh035] [req.ssh036]
  - [x] Compile with `GOOS=js GOARCH=wasm go build`
  - [x] Copy `wasm_exec.js` from Go installation [req.ssh128]
- [x] Modify `build.sh` to include WASM build step [req.ssh036]
- [x] Verify `flake.nix` has necessary Go dependencies [req.ssh125]

### Testing Phase 3
- [x] Create `web/wasm/sshclient/client_test.go` [req.ssh098]
  - [x] Test SSH connection with mock transport [req.ssh099]
  - [x] Test PTY request and terminal modes [req.ssh100a] [req.0xr2f6]
  - [x] Test window resize handling [req.ssh100b] [req.pmgs7a]
  - [x] Test password auth callback flow [req.ssh100c] [req.rhfxp5]
  - [x] Test graceful disconnect and cleanup [req.ssh100d] [req.wrop99]
  - [x] Test error handling and recovery [req.ssh100e] [req.7y35vq]
- [x] Run `go test ./web/wasm/sshclient/...` to verify tests pass
- [x] Build WASM and verify output file is created

---

## Phase 4: TypeScript/React Frontend

### Install Dependencies
- [x] Install xterm.js packages [req.ssh080a] [req.yqy0e8]
  - [x] `npm install xterm`
  - [x] `npm install xterm-addon-fit`
  - [x] `npm install xterm-addon-webgl`

### SSHClient Wrapper
- [x] Create `web/src/lib/ssh-client.ts` [req.ssh059] [req.ssh060]
  - [x] Create `SSHClient` class extending EventEmitter [req.ssh060]
  - [x] Implement `init()` to load WASM module [req.ssh061]
  - [x] Implement typed API methods matching Go exports [req.ssh062]
  - [x] Emit events for output, status, password requests [req.ssh063]

### API Updates
- [x] Modify `web/src/lib/api.ts` [req.ssh007]
  - [x] Update `createHost()` to include SSH fields
  - [x] Update `updateHost()` to include SSH fields
  - [x] Create `getSSHWebSocketURL(hostId)` function

### Password Dialog Component
- [x] Create `web/src/components/PasswordDialog.tsx` [req.ssh070]
  - [x] Show dialog when SSH client requests password [req.ssh071]
  - [x] Display username as read-only [req.ssh072]
  - [x] Password input field
  - [x] Handle cancel action (abort connection) [req.ssh073]
  - [x] Clear password from memory after use [req.ssh074] [req.ssh087]

### SSH Terminal Component
- [x] Create `web/src/components/SSHTerminal.tsx` [req.ssh080] [req.ssh080b] [req.aproft]
  - [x] Initialize xterm.js Terminal instance [req.ssh080c] [req.udrcf4]
  - [x] Connect to SSHClient wrapper [req.ssh080d] [req.l7nrow]
  - [x] Register output callback: WASM → xterm.write() [req.ssh080e] [req.fmbpee]
  - [x] Register input handler: xterm.onData() → WASM [req.ssh080f] [req.fzzuax]
  - [x] Handle resize with FitAddon [req.ssh080g] [req.gdrj3r]
  - [x] Style for dark mode [req.ssh080h] [req.wt0cme]
  - [x] Show loading state during WASM init [req.ssh080i] [req.y9ydcb]

### Host Form Updates
- [x] Modify `web/src/components/HostForm.tsx` [req.ssh006]
  - [x] Add SSH User input field
  - [x] Add SSH Port input field (default 22)
  - [x] Validate port 1-65535

### Hosts Page Updates
- [x] Modify `web/src/pages/HostsPage.tsx` [req.ssh006]
  - [x] Update form to include SSH fields

### Testing Phase 4
- [x] Create `web/src/lib/ssh-client.test.ts` [req.ssh100f]
  - [x] Test SSHClient initialization [req.ssh100g] [req.j1pfc7]
  - [x] Test callback registration [req.ssh100h] [req.tk9ees]
  - [x] Test password dialog component [req.ssh100i] [req.pj2glt]
  - [x] Test React component lifecycle [req.ssh100j] [req.tjhoi8]
  - [x] Test xterm.js integration [req.ssh100k] [req.muq1nd]
  - [x] Use WASM mock for isolated testing [req.ssh100l] [req.zjvnf8]
- [x] Run frontend tests with `npm test`
- [x] Manually test host form with new SSH fields

---

## Phase 5: Session Detail View

### Session Detail Page
- [x] Modify `web/src/pages/SessionDetailPage.tsx` [req.ssh052]
  - [x] Add "Connect" button for active sessions [req.ssh053] [req.ssh054]
  - [x] Implement connection state (idle/connecting/authenticating/connected/disconnected/error) [req.ssh057]
  - [x] Display session metadata (name, host, status, start time) [req.ssh055]
  - [x] Embed SSHTerminal component for active sessions [req.ssh056]
  - [x] Show PasswordDialog when auth requested [req.ssh058] [req.ssh066] [req.ssh067]
  - [x] Add "Disconnect" button [req.ssh059]
  - [x] Show connection status indicator [req.ssh057]
  - [x] Handle reconnection on disconnect [req.ssh060a] [req.zwhix2]
  - [x] Display host key fingerprint on first connect [req.ssh060b] [req.fm1rex]
  - [x] Handle auth failure (wrong password) [req.ssh069]

### Application Logic
- [x] After SSH connection, call `Exec("tmux attach -t {session_name}")` [req.ssh066] [req.ssh065]
- [x] Get session name from metadata API [req.ssh067]
- [x] Handle tmux-specific errors (session not found) [req.ssh068]

### Client Security
- [x] Ensure password is cleared from memory after auth [req.ssh087]
- [x] Implement host key validation [req.ssh088]
- [x] Consider TOFU for host key verification [req.ssh089]
- [x] SSH session contents are end-to-end encrypted [req.ssh085]
- [x] Password sent directly to host over SSH [req.ssh086]

### Testing Phase 5
- [x] Manually test Connect button on session card
- [x] Test password dialog flow
- [x] Test terminal display and interaction
- [x] Test disconnect and reconnect functionality
- [x] Test with wrong password to verify error handling

---

## Phase 6: Integration Tests

### Docker Setup
- [x] Verify Docker is available in devshell [req.ssh112] [req.ssh125]
- [x] Create `integration_tests/ssh/Dockerfile` [req.ssh101] [req.ssh102]
  - [x] Install openssh-server and tmux
  - [x] Configure password authentication [req.ssh103]
  - [x] Create test user with known password [req.ssh104]
- [x] Create `integration_tests/ssh/entrypoint.sh` [req.ssh105]
  - [x] Start sshd
  - [x] Create tmux session on startup

### Integration Test Script
- [x] Create `integration_tests/ssh/ssh_test.sh` [req.ssh101] [req.ssh113]
  - [x] Start Docker container automatically
  - [x] Test full flow: start session, connect, verify output [req.ssh106]
  - [x] Test terminal input [req.ssh107]
  - [x] Test terminal resize [req.ssh108]
  - [x] Test disconnection cleanup [req.ssh109]
  - [x] Test reconnection [req.ssh110]
  - [x] Test auth failure handling [req.ssh111]
  - [x] Stop container on exit

### Testing Phase 6
- [x] Run integration test script
- [x] Verify all integration tests pass
- [x] Test against real SSH server if available

---

## Phase 7: Documentation

### Server Endpoints Documentation
- [x] Modify `doc/SERVER_ENDPOINTS.md`
  - [x] Remove old SSH Endpoints section
  - [x] Add SSH endpoint to Hosts section with WebSocket details [req.ssh022] [req.ssh023] [req.ssh024] [req.ssh025]
  - [x] Update hosts endpoints with SSH fields

### Architecture Documentation
- [x] Modify `doc/ARCHITECTURE.md`
  - [x] Add SSH Terminal Access section
  - [x] Document architecture diagram [req.ssh026]
  - [x] Document security model
  - [x] Document data flow

### Implementation Notes
- [x] Review README.md for project context [req.ssh120]
- [x] Review doc/ files for architecture [req.ssh121]
- [x] Reference hosts table from llm/0008_hosts [req.ssh122]
- [x] Document TinyGo consideration for smaller binary [req.ssh129]
- [x] Document Go WASM single-threaded nature [req.ssh130]
- [x] Document testing strategy (unit tests mock, integration uses Docker) [req.ssh126]
- [x] Note future FIDO2/WebAuthn enhancement [req.ssh089a] [req.189bgq]
- [x] Note future support for commands beyond tmux [req.ssh069]

### Testing Phase 7
- [x] Review all documentation for accuracy
- [x] Verify requirement tag coverage
- [x] Ensure documentation matches implementation
