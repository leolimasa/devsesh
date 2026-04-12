# SSH Implementation TODO

This checklist implements SSH connectivity for devsesh as described in requirements.md and implementation.md.

---

## Phase 1: Database & Configuration

### Database Migration
- [ ] Create `sql/00009_add_ssh_columns_to_hosts.sql` with SSH columns [req.ssh008]
  - [ ] Add `ssh_user TEXT DEFAULT ''` column [req.ssh002]
  - [ ] Add `ssh_port INTEGER DEFAULT 22` column [req.ssh003]

### Go Struct Updates
- [ ] Modify `internal/db/queries.go` Host struct to include SSH fields [req.ssh001]
  - [ ] Add `SSHUser string` field [req.ssh002]
  - [ ] Add `SSHPort int` field [req.ssh003]
- [ ] Update `CreateHost()` to include `ssh_user`, `ssh_port` [req.ssh007]
- [ ] Update `GetHostByID()` to include `ssh_user`, `ssh_port` [req.ssh007]
- [ ] Update `GetHostsByUserID()` to include `ssh_user`, `ssh_port` [req.ssh007]
- [ ] Update `UpdateHost()` to include `ssh_user`, `ssh_port` [req.ssh007]
- [ ] Update `GetHostByLabel()` to include `ssh_user`, `ssh_port` [req.ssh007]

### Configuration
- [ ] Modify `internal/config/config.go` to add SSH configuration fields [req.ssh074] [req.ssh075] [req.ssh076]
  - [ ] Add `SSHTimeout time.Duration` field [req.ssh074]
  - [ ] Add `SSHIdleTimeout time.Duration` field [req.ssh075]
  - [ ] Add `SSHMaxConnections int` field [req.ssh076]
- [ ] Modify `LoadFromEnv()` to parse SSH environment variables [req.ssh074] [req.ssh075] [req.ssh076]
  - [ ] Parse `DEVSESH_SSH_TIMEOUT` (default: 30s) [req.ssh074]
  - [ ] Parse `DEVSESH_SSH_IDLE_TIMEOUT` (default: 30m) [req.ssh075]
  - [ ] Parse `DEVSESH_SSH_MAX_CONNECTIONS` (default: 5) [req.ssh076]

### TypeScript Types
- [ ] Modify `web/src/types/api.ts` Host interface to include SSH fields [req.ssh007]
  - [ ] Add `ssh_user: string` field [req.ssh002]
  - [ ] Add `ssh_port: number` field [req.ssh003]

### Testing Phase 1
- [ ] Run existing Go unit tests to ensure no regressions
- [ ] Run database migration against test database
- [ ] Verify host API endpoints still work with new fields

---

## Phase 2: Server-Side TCP Proxy

### TCP Proxy Implementation
- [ ] Create `internal/ssh/proxy.go` [req.ssh010]
  - [ ] Define `TCPProxy struct` with `ws`, `tcp`, `done` fields
  - [ ] Implement `NewTCPProxy(ws, tcp) *TCPProxy`
  - [ ] Implement `Run()` for bidirectional proxying [req.ssh015]
    - [ ] Use binary WebSocket frames for raw TCP data [req.ssh016] [req.ssh021]
    - [ ] Clean up TCP connection when WebSocket closes [req.ssh018]
  - [ ] Implement `sendControlMessage()` for JSON control messages [req.ssh022]

### WebSocket Handler
- [ ] Create `internal/ssh/handler.go` with `ConnectHandler` [req.ssh011]
  - [ ] Extract user ID from JWT context [req.ssh012]
  - [ ] Get host ID from path parameter
  - [ ] Look up host and verify user ownership [req.ssh012] [req.ssh013]
  - [ ] Upgrade HTTP to WebSocket connection
  - [ ] Dial TCP to host:port with timeout [req.ssh014] [req.ssh019]
  - [ ] Send "connected" control message [req.ssh025]
  - [ ] Handle connection errors and report to client [req.ssh017] [req.ssh024]
  - [ ] Send "closed" control message on completion [req.ssh023]
  - [ ] Only allow connections to registered hosts [req.ssh084]

### Security Features
- [ ] Implement rate limiting per user [req.ssh081]
- [ ] Implement audit logging for connection attempts [req.ssh082]
- [ ] Implement idle timeout [req.ssh083]
- [ ] Validate session ownership [req.ssh080]

### Route Registration
- [ ] Modify `internal/server/server.go` to add SSH WebSocket route
- [ ] Remove old `ssh.RegisterRoutes()` call if present [req.ssh123]

### Hosts Handler Updates
- [ ] Modify `internal/hosts/handler.go` CreateHandler to accept SSH fields [req.ssh007]
- [ ] Modify `internal/hosts/handler.go` UpdateHandler to accept SSH fields [req.ssh007]

### Testing Phase 2
- [ ] Create `internal/ssh/proxy_test.go` [req.ssh090]
  - [ ] Test bidirectional data flow [req.ssh094]
  - [ ] Test WebSocket close cleanup [req.ssh096]
  - [ ] Test TCP close cleanup
  - [ ] Test connection error handling [req.ssh095]
  - [ ] Test rate limiting logic [req.ssh097]
- [ ] Create `internal/ssh/handler_test.go` [req.ssh090]
  - [ ] Test WebSocket upgrade [req.ssh091]
  - [ ] Test host ownership validation [req.ssh092]
  - [ ] Test host lookup and TCP connection [req.ssh093]
- [ ] Run `go test ./internal/ssh/...` to verify all tests pass

---

## Phase 3: Go WASM SSH Client

### Project Structure
- [ ] Create `web/wasm/sshclient/` directory [req.ssh032]
- [ ] Add `golang.org/x/crypto/ssh` dependency [req.ssh033]

### WebSocket Transport
- [ ] Create `web/wasm/sshclient/transport.go` [req.ssh037]
  - [ ] Define `WSTransport struct` implementing `net.Conn` [req.ssh038]
  - [ ] Implement `NewWSTransport(wsURL)` using `syscall/js` [req.ssh039] [req.ssh034]
  - [ ] Implement `Read()` bridging WebSocket to `io.Reader` [req.ssh040]
  - [ ] Implement `Write()` bridging `io.Writer` to WebSocket [req.ssh040]
  - [ ] Implement `Close()` and other `net.Conn` methods
  - [ ] Handle WebSocket lifecycle (open, close, error) [req.ssh041]

### SSH Client Logic
- [ ] Create `web/wasm/sshclient/client.go` [req.ssh051]
  - [ ] Define global state for current client/session
  - [ ] Implement `Connect(wsURL, user)` [req.ssh043] [req.ssh052]
  - [ ] Implement `Disconnect()` [req.ssh044] [req.ssh058]
  - [ ] Implement `Exec(command)` with PTY request [req.ssh045] [req.ssh054] [req.ssh055]
  - [ ] Implement `SendInput(data)` [req.ssh046]
  - [ ] Implement `Resize(rows, cols)` [req.ssh047] [req.ssh057]
  - [ ] Implement `SetPasswordCallback()` [req.ssh048]
  - [ ] Implement `SetOutputCallback()` [req.ssh049]
  - [ ] Implement `SetStatusCallback()` [req.ssh050]
  - [ ] Implement `passwordAuthCallback()` for SSH auth [req.ssh053] [req.ssh064] [req.ssh065]
  - [ ] Forward terminal I/O via callbacks [req.ssh056]
  - [ ] Use `ssh.Password()` auth method [req.ssh064]

### WASM Entry Point
- [ ] Create `web/wasm/sshclient/main.go` [req.ssh030] [req.ssh031]
  - [ ] Register all exported functions via `syscall/js` [req.ssh042] [req.ssh034]
  - [ ] Block forever to keep WASM alive

### Build Script
- [ ] Create `build_wasm.sh` script [req.ssh035] [req.ssh036]
  - [ ] Compile with `GOOS=js GOARCH=wasm go build`
  - [ ] Copy `wasm_exec.js` from Go installation [req.ssh128]
- [ ] Modify `build.sh` to include WASM build step [req.ssh036]
- [ ] Verify `flake.nix` has necessary Go dependencies [req.ssh125]

### Testing Phase 3
- [ ] Create `web/wasm/sshclient/client_test.go` [req.ssh098]
  - [ ] Test SSH connection with mock transport [req.ssh099]
  - [ ] Test PTY request and terminal modes [req.ssh100a] [req.0xr2f6]
  - [ ] Test window resize handling [req.ssh100b] [req.pmgs7a]
  - [ ] Test password auth callback flow [req.ssh100c] [req.rhfxp5]
  - [ ] Test graceful disconnect and cleanup [req.ssh100d] [req.wrop99]
  - [ ] Test error handling and recovery [req.ssh100e] [req.7y35vq]
- [ ] Run `go test ./web/wasm/sshclient/...` to verify tests pass
- [ ] Build WASM and verify output file is created

---

## Phase 4: TypeScript/React Frontend

### Install Dependencies
- [ ] Install xterm.js packages [req.ssh080a] [req.yqy0e8]
  - [ ] `npm install xterm`
  - [ ] `npm install xterm-addon-fit`
  - [ ] `npm install xterm-addon-webgl`

### SSHClient Wrapper
- [ ] Create `web/src/lib/ssh-client.ts` [req.ssh059] [req.ssh060]
  - [ ] Create `SSHClient` class extending EventEmitter [req.ssh060]
  - [ ] Implement `init()` to load WASM module [req.ssh061]
  - [ ] Implement typed API methods matching Go exports [req.ssh062]
  - [ ] Emit events for output, status, password requests [req.ssh063]

### API Updates
- [ ] Modify `web/src/lib/api.ts` [req.ssh007]
  - [ ] Update `createHost()` to include SSH fields
  - [ ] Update `updateHost()` to include SSH fields
  - [ ] Create `getSSHWebSocketURL(hostId)` function

### Password Dialog Component
- [ ] Create `web/src/components/PasswordDialog.tsx` [req.ssh070]
  - [ ] Show dialog when SSH client requests password [req.ssh071]
  - [ ] Display username as read-only [req.ssh072]
  - [ ] Password input field
  - [ ] Handle cancel action (abort connection) [req.ssh073]
  - [ ] Clear password from memory after use [req.ssh074] [req.ssh087]

### SSH Terminal Component
- [ ] Create `web/src/components/SSHTerminal.tsx` [req.ssh080] [req.ssh080b] [req.aproft]
  - [ ] Initialize xterm.js Terminal instance [req.ssh080c] [req.udrcf4]
  - [ ] Connect to SSHClient wrapper [req.ssh080d] [req.l7nrow]
  - [ ] Register output callback: WASM → xterm.write() [req.ssh080e] [req.fmbpee]
  - [ ] Register input handler: xterm.onData() → WASM [req.ssh080f] [req.fzzuax]
  - [ ] Handle resize with FitAddon [req.ssh080g] [req.gdrj3r]
  - [ ] Style for dark mode [req.ssh080h] [req.wt0cme]
  - [ ] Show loading state during WASM init [req.ssh080i] [req.y9ydcb]

### Host Form Updates
- [ ] Modify `web/src/components/HostForm.tsx` [req.ssh006]
  - [ ] Add SSH User input field
  - [ ] Add SSH Port input field (default 22)
  - [ ] Validate port 1-65535

### Hosts Page Updates
- [ ] Modify `web/src/pages/HostsPage.tsx` [req.ssh006]
  - [ ] Update form to include SSH fields

### Testing Phase 4
- [ ] Create `web/src/lib/ssh-client.test.ts` [req.ssh100f]
  - [ ] Test SSHClient initialization [req.ssh100g] [req.j1pfc7]
  - [ ] Test callback registration [req.ssh100h] [req.tk9ees]
  - [ ] Test password dialog component [req.ssh100i] [req.pj2glt]
  - [ ] Test React component lifecycle [req.ssh100j] [req.tjhoi8]
  - [ ] Test xterm.js integration [req.ssh100k] [req.muq1nd]
  - [ ] Use WASM mock for isolated testing [req.ssh100l] [req.zjvnf8]
- [ ] Run frontend tests with `npm test`
- [ ] Manually test host form with new SSH fields

---

## Phase 5: Session Detail View

### Session Detail Page
- [ ] Modify `web/src/pages/SessionDetailPage.tsx` [req.ssh052]
  - [ ] Add "Connect" button for active sessions [req.ssh053] [req.ssh054]
  - [ ] Implement connection state (idle/connecting/authenticating/connected/disconnected/error) [req.ssh057]
  - [ ] Display session metadata (name, host, status, start time) [req.ssh055]
  - [ ] Embed SSHTerminal component for active sessions [req.ssh056]
  - [ ] Show PasswordDialog when auth requested [req.ssh058] [req.ssh066] [req.ssh067]
  - [ ] Add "Disconnect" button [req.ssh059]
  - [ ] Show connection status indicator [req.ssh057]
  - [ ] Handle reconnection on disconnect [req.ssh060a] [req.zwhix2]
  - [ ] Display host key fingerprint on first connect [req.ssh060b] [req.fm1rex]
  - [ ] Handle auth failure (wrong password) [req.ssh069]

### Application Logic
- [ ] After SSH connection, call `Exec("tmux attach -t {session_name}")` [req.ssh066] [req.ssh065]
- [ ] Get session name from metadata API [req.ssh067]
- [ ] Handle tmux-specific errors (session not found) [req.ssh068]

### Client Security
- [ ] Ensure password is cleared from memory after auth [req.ssh087]
- [ ] Implement host key validation [req.ssh088]
- [ ] Consider TOFU for host key verification [req.ssh089]
- [ ] SSH session contents are end-to-end encrypted [req.ssh085]
- [ ] Password sent directly to host over SSH [req.ssh086]

### Testing Phase 5
- [ ] Manually test Connect button on session card
- [ ] Test password dialog flow
- [ ] Test terminal display and interaction
- [ ] Test disconnect and reconnect functionality
- [ ] Test with wrong password to verify error handling

---

## Phase 6: Integration Tests

### Docker Setup
- [ ] Verify Docker is available in devshell [req.ssh112] [req.ssh125]
- [ ] Create `integration_tests/ssh/Dockerfile` [req.ssh101] [req.ssh102]
  - [ ] Install openssh-server and tmux
  - [ ] Configure password authentication [req.ssh103]
  - [ ] Create test user with known password [req.ssh104]
- [ ] Create `integration_tests/ssh/entrypoint.sh` [req.ssh105]
  - [ ] Start sshd
  - [ ] Create tmux session on startup

### Integration Test Script
- [ ] Create `integration_tests/ssh/ssh_test.sh` [req.ssh101] [req.ssh113]
  - [ ] Start Docker container automatically
  - [ ] Test full flow: start session, connect, verify output [req.ssh106]
  - [ ] Test terminal input [req.ssh107]
  - [ ] Test terminal resize [req.ssh108]
  - [ ] Test disconnection cleanup [req.ssh109]
  - [ ] Test reconnection [req.ssh110]
  - [ ] Test auth failure handling [req.ssh111]
  - [ ] Stop container on exit

### Testing Phase 6
- [ ] Run integration test script
- [ ] Verify all integration tests pass
- [ ] Test against real SSH server if available

---

## Phase 7: Documentation

### Server Endpoints Documentation
- [ ] Modify `doc/SERVER_ENDPOINTS.md`
  - [ ] Remove old SSH Endpoints section
  - [ ] Add SSH endpoint to Hosts section with WebSocket details [req.ssh022] [req.ssh023] [req.ssh024] [req.ssh025]
  - [ ] Update hosts endpoints with SSH fields

### Architecture Documentation
- [ ] Modify `doc/ARCHITECTURE.md`
  - [ ] Add SSH Terminal Access section
  - [ ] Document architecture diagram [req.ssh026]
  - [ ] Document security model
  - [ ] Document data flow

### Implementation Notes
- [ ] Review README.md for project context [req.ssh120]
- [ ] Review doc/ files for architecture [req.ssh121]
- [ ] Reference hosts table from llm/0008_hosts [req.ssh122]
- [ ] Document TinyGo consideration for smaller binary [req.ssh129]
- [ ] Document Go WASM single-threaded nature [req.ssh130]
- [ ] Document testing strategy (unit tests mock, integration uses Docker) [req.ssh126]
- [ ] Note future FIDO2/WebAuthn enhancement [req.ssh089a] [req.189bgq]
- [ ] Note future support for commands beyond tmux [req.ssh069]

### Testing Phase 7
- [ ] Review all documentation for accuracy
- [ ] Verify requirement tag coverage
- [ ] Ensure documentation matches implementation
