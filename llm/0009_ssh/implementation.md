# SSH Implementation

This document describes how to implement SSH connectivity for devsesh, allowing users to connect to running tmux sessions from the web dashboard.

## Architecture Summary

```
xterm.js (JS) ↔ TypeScript (app logic) ↔ Go SSH Client (WASM) ↔ WebSocket ↔ Server (TCP Proxy) ↔ Host:22
```

The server acts as a dumb TCP-over-WebSocket proxy. The browser runs a Go SSH client compiled to WASM. Password authentication is used (FIDO2/WebAuthn can be added later).

---

## Data Structures

### SQL Migration: `sql/00009_add_ssh_columns_to_hosts.sql` (CREATE) [req.ssh008]

Add SSH configuration columns to the existing `hosts` table:

```sql
ALTER TABLE hosts ADD COLUMN ssh_user TEXT DEFAULT '';
ALTER TABLE hosts ADD COLUMN ssh_port INTEGER DEFAULT 22;
```

- `ssh_user`: Username to connect as (empty string means use system default) [req.ssh002]
- `ssh_port`: SSH port, defaults to 22 [req.ssh003]

### Go Struct Modification: `internal/db/queries.go` (MODIFY) [req.ssh001]

Extend the existing `Host` struct:

```go
type Host struct {
    ID        int64     `json:"id"`
    Label     string    `json:"label"`
    Hostname  string    `json:"hostname"`
    SSHUser   string    `json:"ssh_user"`   // NEW [req.ssh002]
    SSHPort   int       `json:"ssh_port"`   // NEW [req.ssh003]
    UserID    int64     `json:"user_id"`
    CreatedAt time.Time `json:"created_at"`
    UpdatedAt time.Time `json:"updated_at"`
}
```

### TypeScript Type Modification: `web/src/types/api.ts` (MODIFY) [req.ssh007]

Extend the existing `Host` interface:

```typescript
export interface Host {
  id: number;
  label: string;
  hostname: string;
  ssh_user: string;   // NEW [req.ssh002]
  ssh_port: number;   // NEW [req.ssh003]
  user_id: number;
  created_at: string;
  updated_at: string;
}
```

### Go Config Modification: `internal/config/config.go` (MODIFY) [req.ssh074] [req.ssh075] [req.ssh076]

Add SSH configuration fields:

```go
type Config struct {
    // ... existing fields ...
    SSHTimeout        time.Duration  // Connection timeout [req.ssh074]
    SSHIdleTimeout    time.Duration  // Idle timeout [req.ssh075]
    SSHMaxConnections int            // Max concurrent connections per user [req.ssh076]
}
```

### WebSocket Control Messages (NEW) [req.ssh020]

JSON message types for WebSocket control frames:

```typescript
type ControlMessage =
  | { type: "connected"; host: string; port: number }  // [req.ssh025]
  | { type: "error"; message: string }                 // [req.ssh024]
  | { type: "closed" }                                 // [req.ssh023]
```

Binary frames contain raw TCP data with no wrapper. [req.ssh021] [req.ssh016]

All SSH protocol framing is handled by the browser SSH client. [req.ssh026]

---

## Server-Side Implementation

### File: `internal/ssh/proxy.go` (CREATE) [req.ssh010]

TCP-over-WebSocket proxy implementation.

#### `type TCPProxy struct` (CREATE)

Manages a single WebSocket-to-TCP proxy connection.

Fields:
- `ws *websocket.Conn`: WebSocket connection to browser
- `tcp net.Conn`: TCP connection to SSH host
- `done chan struct{}`: Signal channel for cleanup

#### `func NewTCPProxy(ws, tcp) *TCPProxy` (CREATE)

Create a new proxy instance linking WebSocket to TCP connection.

#### `func (p *TCPProxy) Run() error` (CREATE) [req.ssh015]

Start bidirectional proxying. Launch two goroutines:
1. Read from WebSocket binary frames, write to TCP
2. Read from TCP, write to WebSocket binary frames

Use `io.Copy` or buffer-based copying. Return when either connection closes. Clean up both connections on exit. [req.ssh018]

#### `func (p *TCPProxy) sendControlMessage(msg ControlMessage) error` (CREATE) [req.ssh022]

Send a JSON control message as a WebSocket text frame.

### File: `internal/ssh/handler.go` (CREATE) [req.ssh011]

HTTP/WebSocket handlers for SSH proxy.

#### `func ConnectHandler(database *sql.DB, cfg config.Config) http.HandlerFunc` (CREATE)

WebSocket endpoint handler for `/api/v1/hosts/{host_id}/ssh`.

The endpoint connects to a **host**, not a session. The client is responsible for running application-specific commands (e.g., `tmux attach`) after connecting.

Implementation:
1. Extract user ID from JWT context [req.ssh012]
2. Get host ID from path parameter
3. Look up host, verify user owns it [req.ssh012] [req.ssh013]
4. Upgrade HTTP to WebSocket connection
5. Dial TCP to `host.Hostname:host.SSHPort` with timeout [req.ssh014] [req.ssh019]
6. Send `{"type": "connected", ...}` control message [req.ssh025]
7. On connection error, send `{"type": "error", ...}` and close [req.ssh017]
8. Create TCPProxy and call Run()
9. On completion, send `{"type": "closed"}` [req.ssh023]

#### `func RegisterRoutes()` (DELETE)

Remove the entire `internal/ssh/handler.go` RegisterRoutes function. The SSH endpoint will be registered directly in `server.go` as part of hosts routes.

### File: `internal/server/server.go` (MODIFY)

Add SSH WebSocket route alongside other hosts routes:

```go
mux.Handle("GET /api/v1/hosts/{host_id}/ssh", jwtMiddleware(http.HandlerFunc(ssh.ConnectHandler(database, cfg))))
```

Remove the old `ssh.RegisterRoutes()` call and its import if no longer needed.

### File: `internal/server/server.go` (MODIFY)

Update SSH route registration to pass config for timeouts.

### File: `internal/db/queries.go` (MODIFY) [req.ssh007]

#### `func CreateHost(db, host)` (MODIFY)

Update INSERT to include `ssh_user`, `ssh_port` columns.

#### `func GetHostByID(db, id)` (MODIFY)

Update SELECT to include `ssh_user`, `ssh_port` columns.

#### `func GetHostsByUserID(db, userID)` (MODIFY)

Update SELECT to include `ssh_user`, `ssh_port` columns.

#### `func UpdateHost(db, host)` (MODIFY)

Update UPDATE to include `ssh_user`, `ssh_port` columns.

#### `func GetHostByLabel(db, userID, label)` (MODIFY)

Update SELECT to include `ssh_user`, `ssh_port` columns.

### File: `internal/hosts/handler.go` (MODIFY) [req.ssh007]

#### `func CreateHandler(database)` (MODIFY)

Update request struct to accept `ssh_user` and `ssh_port` fields.

#### `func UpdateHandler(database)` (MODIFY)

Update request struct to accept `ssh_user` and `ssh_port` fields.

### File: `internal/config/config.go` (MODIFY)

#### `func LoadFromEnv()` (MODIFY) [req.ssh074] [req.ssh075] [req.ssh076]

Add parsing for new environment variables:
- `DEVSESH_SSH_TIMEOUT` (default: 30s)
- `DEVSESH_SSH_IDLE_TIMEOUT` (default: 30m)
- `DEVSESH_SSH_MAX_CONNECTIONS` (default: 5)

---

## Go WASM SSH Client

### File: `web/wasm/sshclient/main.go` (CREATE) [req.ssh030] [req.ssh031] [req.ssh032] [req.ssh033] [req.ssh034]

Main entry point for WASM SSH client. Uses `golang.org/x/crypto/ssh` [req.ssh033] and `syscall/js` [req.ssh034] for JavaScript interop.

#### `func main()` (CREATE)

Register JavaScript-callable functions and block forever (required for WASM). [req.ssh042]

```go
func main() {
    js.Global().Set("sshConnect", js.FuncOf(Connect))
    js.Global().Set("sshDisconnect", js.FuncOf(Disconnect))
    js.Global().Set("sshExec", js.FuncOf(Exec))
    js.Global().Set("sshSendInput", js.FuncOf(SendInput))
    js.Global().Set("sshResize", js.FuncOf(Resize))
    js.Global().Set("sshSetPasswordCallback", js.FuncOf(SetPasswordCallback))
    js.Global().Set("sshSetOutputCallback", js.FuncOf(SetOutputCallback))
    js.Global().Set("sshSetStatusCallback", js.FuncOf(SetStatusCallback))
    <-make(chan struct{}) // Block forever
}
```

### File: `web/wasm/sshclient/transport.go` (CREATE) [req.ssh037]

WebSocket transport layer for SSH client.

#### `type WSTransport struct` (CREATE) [req.ssh038]

Implements `net.Conn` interface over browser WebSocket.

Fields:
- `ws js.Value`: JavaScript WebSocket object
- `readBuf *bytes.Buffer`: Buffer for incoming data
- `readCh chan []byte`: Channel for received binary messages
- `closed bool`
- `mu sync.Mutex`

#### `func NewWSTransport(wsURL string) (*WSTransport, error)` (CREATE) [req.ssh039]

Create WebSocket connection using `syscall/js`. Set up `onmessage`, `onerror`, `onclose` handlers. Wait for `onopen` before returning. [req.ssh041]

#### `func (t *WSTransport) Read(b []byte) (int, error)` (CREATE) [req.ssh040]

Read from internal buffer. If empty, block on readCh for more data. Return `io.EOF` if connection closed.

#### `func (t *WSTransport) Write(b []byte) (int, error)` (CREATE) [req.ssh040]

Convert Go `[]byte` to JavaScript `Uint8Array`, call `ws.send()`.

#### `func (t *WSTransport) Close() error` (CREATE)

Call `ws.close()`, mark as closed.

#### Other `net.Conn` methods (CREATE)

Implement `LocalAddr`, `RemoteAddr`, `SetDeadline`, `SetReadDeadline`, `SetWriteDeadline` as no-ops or reasonable defaults.

### File: `web/wasm/sshclient/client.go` (CREATE) [req.ssh051]

SSH client logic.

#### Global state (justified: WASM is single-instance per page)

```go
var (
    currentClient     *ssh.Client
    currentSession    *ssh.Session
    currentStdin      io.WriteCloser
    passwordCallback  js.Func
    outputCallback    js.Func
    statusCallback    js.Func
    mu                sync.Mutex
)
```

#### `func Connect(this js.Value, args []js.Value) interface{}` (CREATE) [req.ssh043] [req.ssh052]

Arguments: `wsURL string`, `user string`

Implementation:
1. Create WSTransport to connect to WebSocket proxy
2. Wait for "connected" control message
3. Create SSH client config with password auth callback [req.ssh053]
4. Call `ssh.NewClientConn()` over transport
5. Store client in global state
6. Call statusCallback with "connected"

#### `func Disconnect(this js.Value, args []js.Value) interface{}` (CREATE) [req.ssh044] [req.ssh058]

Close current session and client. Clear global state. Call statusCallback with "disconnected".

#### `func Exec(this js.Value, args []js.Value) interface{}` (CREATE) [req.ssh045] [req.ssh054] [req.ssh055]

Arguments: `command string`

Implementation:
1. Create new session from SSH client
2. Request PTY with xterm-256color, 80x24 default [req.ssh054]
3. Get stdin pipe, store in global
4. Set stdout/stderr to call outputCallback [req.ssh056]
5. Start command via `session.Start(command)` [req.ssh055]
6. Return immediately (async operation)

#### `func SendInput(this js.Value, args []js.Value) interface{}` (CREATE) [req.ssh046]

Arguments: `data []byte` (as Uint8Array)

Write data to currentStdin pipe.

#### `func Resize(this js.Value, args []js.Value) interface{}` (CREATE) [req.ssh047] [req.ssh057]

Arguments: `rows int`, `cols int`

Call `currentSession.WindowChange(rows, cols)`.

#### `func SetPasswordCallback(this js.Value, args []js.Value) interface{}` (CREATE) [req.ssh048]

Store the JavaScript callback function for password prompts.

#### `func SetOutputCallback(this js.Value, args []js.Value) interface{}` (CREATE) [req.ssh049]

Store the JavaScript callback function for terminal output.

#### `func SetStatusCallback(this js.Value, args []js.Value) interface{}` (CREATE) [req.ssh050]

Store the JavaScript callback function for connection status changes.

#### `func passwordAuthCallback(user string) (string, error)` (CREATE) [req.ssh053] [req.ssh064] [req.ssh065]

Called by SSH library when password is needed. Uses Promise-like pattern:
1. Create a channel to wait for response
2. Call passwordCallback with a resolve function
3. Block until password received or cancelled
4. Return password to SSH library

### Build Script: `build_wasm.sh` (CREATE) [req.ssh035] [req.ssh036]

```bash
#!/bin/bash
cd web/wasm/sshclient
GOOS=js GOARCH=wasm go build -o ../../../web/public/sshclient.wasm .
cp "$(go env GOROOT)/misc/wasm/wasm_exec.js" ../../../web/public/
```

---

## TypeScript/React Implementation

### File: `web/src/lib/ssh-client.ts` (CREATE) [req.ssh059] [req.ssh060]

TypeScript wrapper for Go WASM module.

#### `class SSHClient` (CREATE) [req.ssh060]

```typescript
class SSHClient extends EventEmitter {
  private wasmReady: boolean = false;
  private go: Go;

  async init(): Promise<void>;  // [req.ssh061]
  connect(wsURL: string, user: string): void;  // [req.ssh062]
  disconnect(): void;
  exec(command: string): void;
  sendInput(data: Uint8Array): void;
  resize(rows: number, cols: number): void;
}
```

#### `async init()` (CREATE) [req.ssh061]

Load `wasm_exec.js`, instantiate `sshclient.wasm`, run Go. Register callbacks that emit events. [req.ssh063]

#### Event emissions [req.ssh063]

- `"output"`: Terminal data received
- `"status"`: Connection status changed (connecting, connected, disconnected, error)
- `"password-request"`: Password needed, includes resolve callback

### File: `web/src/components/SSHTerminal.tsx` (CREATE) [req.ssh080] [req.ssh080b] [req.aproft]

React component wrapping xterm.js connected to SSHClient.

#### Props

```typescript
interface SSHTerminalProps {
  host: Host;              // Host to connect to
  sessionName: string;     // tmux session name to attach to
  onDisconnect?: () => void;
}
```

#### Implementation [req.ssh080c] [req.ssh080d] [req.udrcf4] [req.l7nrow]

1. Initialize xterm.js Terminal instance on mount [req.ssh080c] [req.udrcf4]
2. Initialize SSHClient and connect to host via `getSSHWebSocketURL(host.id)` [req.ssh080d] [req.l7nrow]
3. After SSH connection established, call `exec("tmux attach -t {sessionName}")` [req.ssh066]
4. Register output handler: write to xterm [req.ssh080e] [req.fmbpee]
5. Register input handler: send to SSHClient [req.ssh080f] [req.fzzuax]
6. Use FitAddon for auto-resize, call SSHClient.resize on change [req.ssh080g] [req.gdrj3r]
7. Apply dark theme styling [req.ssh080h] [req.wt0cme]
8. Show loading spinner while WASM initializes [req.ssh080i] [req.y9ydcb]
9. Clean up on unmount

### File: `web/src/components/PasswordDialog.tsx` (CREATE) [req.ssh070]

Modal dialog for SSH password entry.

#### Props

```typescript
interface PasswordDialogProps {
  isOpen: boolean;
  username: string;      // [req.ssh072]
  onSubmit: (password: string) => void;  // [req.ssh068]
  onCancel: () => void;  // [req.ssh073]
}
```

#### Implementation [req.ssh071] [req.ssh072]

1. Show username as read-only field
2. Password input field (type="password")
3. Submit and Cancel buttons
4. Clear password from state after submit [req.ssh074]
5. Focus password field on open

### File: `web/src/pages/SessionDetailPage.tsx` (MODIFY) [req.ssh052]

Add terminal and SSH connection UI.

#### Modifications

1. Import SSHTerminal and PasswordDialog components
2. Add connection state: `idle | connecting | authenticating | connected | disconnected | error` [req.ssh057]
3. Add "Connect" button when session is active and not connected [req.ssh053]
4. Show PasswordDialog when SSHClient requests password [req.ssh058]
5. Embed SSHTerminal when connected [req.ssh056]
6. Add "Disconnect" button when connected [req.ssh059]
7. Show connection status indicator [req.ssh057]
8. Handle reconnection on disconnect [req.ssh060a] [req.zwhix2]
9. Display host key fingerprint on first connect [req.ssh060b] [req.fm1rex]

### File: `web/src/pages/HostsPage.tsx` (MODIFY) [req.ssh006]

Add SSH configuration fields to host form.

#### Modifications

1. Add SSH User input field
2. Add SSH Port input field (number, default 22)
3. Update form submission to include new fields

### File: `web/src/components/HostForm.tsx` (MODIFY) [req.ssh006]

Update reusable host form component.

#### Modifications

1. Add `ssh_user` field (text input, optional)
2. Add `ssh_port` field (number input, default 22)
3. Validate port is valid number 1-65535

### File: `web/src/lib/api.ts` (MODIFY) [req.ssh007]

#### `createHost()` (MODIFY)

Update to include `ssh_user` and `ssh_port` in request body.

#### `updateHost()` (MODIFY)

Update to include `ssh_user` and `ssh_port` in request body.

#### `getSSHWebSocketURL(hostId: number): string` (CREATE)

Return WebSocket URL for SSH proxy endpoint. Connects to a host, not a session.

```typescript
export function getSSHWebSocketURL(hostId: number): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const token = getToken();
  return `${protocol}//${window.location.host}/api/v1/hosts/${hostId}/ssh?token=${token}`;
}
```

---

## Testing

### File: `internal/ssh/proxy_test.go` (CREATE) [req.ssh090]

Unit tests for TCP proxy.

#### Tests [req.ssh091] [req.ssh092] [req.ssh093] [req.ssh094] [req.ssh095] [req.ssh096]

- `TestProxyBidirectionalData`: Verify data flows both directions [req.ssh094]
- `TestProxyWebSocketClose`: Verify cleanup on WS close [req.ssh096]
- `TestProxyTCPClose`: Verify cleanup on TCP close
- `TestProxyConnectionError`: Verify error handling [req.ssh095]
- `TestProxyRateLimiting`: Verify rate limiting logic [req.ssh097]

### File: `internal/ssh/handler_test.go` (CREATE) [req.ssh090]

Unit tests for HTTP handlers.

#### Tests [req.ssh091] [req.ssh092] [req.ssh093]

- `TestConnectHandlerUpgrade`: Test WebSocket upgrade [req.ssh091]
- `TestConnectHandlerUnauthorized`: Test host ownership check (user must own host) [req.ssh092]
- `TestConnectHandlerHostLookup`: Test host lookup and TCP connection [req.ssh093]

### File: `web/wasm/sshclient/client_test.go` (CREATE) [req.ssh098]

Unit tests for Go SSH client (run as native Go, not WASM).

#### Tests [req.ssh099] [req.ssh100a] [req.ssh100b] [req.ssh100c] [req.ssh100d] [req.ssh100e] [req.0xr2f6] [req.pmgs7a] [req.rhfxp5] [req.wrop99] [req.7y35vq]

- `TestSSHConnectionWithMockTransport`: Test connection flow [req.ssh099]
- `TestPTYRequest`: Test PTY allocation [req.ssh100a] [req.0xr2f6]
- `TestWindowResize`: Test resize handling [req.ssh100b] [req.pmgs7a]
- `TestPasswordCallback`: Test auth flow [req.ssh100c] [req.rhfxp5]
- `TestGracefulDisconnect`: Test cleanup [req.ssh100d] [req.wrop99]
- `TestErrorRecovery`: Test error handling [req.ssh100e] [req.7y35vq]

### File: `web/src/lib/ssh-client.test.ts` (CREATE) [req.ssh100f]

TypeScript unit tests for SSHClient wrapper.

#### Tests [req.ssh100g] [req.ssh100h] [req.ssh100i] [req.ssh100j] [req.ssh100k] [req.ssh100l] [req.j1pfc7] [req.tk9ees] [req.pj2glt] [req.tjhoi8] [req.muq1nd] [req.zjvnf8]

- `test("SSHClient initialization")`: Test WASM loading [req.ssh100g] [req.j1pfc7]
- `test("callback registration")`: Test event handling [req.ssh100h] [req.tk9ees]
- `test("password dialog")`: Test password flow [req.ssh100i] [req.pj2glt]
- `test("component lifecycle")`: Test mount/unmount [req.ssh100j] [req.tjhoi8]
- `test("xterm integration")`: Test terminal I/O [req.ssh100k] [req.muq1nd]
- Use WASM mock for isolated testing [req.ssh100l] [req.zjvnf8]

### File: `integration_tests/ssh/Dockerfile` (CREATE) [req.ssh101] [req.ssh102]

Docker image for SSH integration tests.

```dockerfile
FROM alpine:latest
RUN apk add --no-cache openssh-server tmux
RUN adduser -D testuser && echo "testuser:testpass" | chpasswd
RUN ssh-keygen -A
RUN echo "PasswordAuthentication yes" >> /etc/ssh/sshd_config
COPY entrypoint.sh /entrypoint.sh
CMD ["/entrypoint.sh"]
```

[req.ssh103] [req.ssh104] [req.ssh105]

### File: `integration_tests/ssh/entrypoint.sh` (CREATE) [req.ssh105]

Start sshd and create tmux session:

```bash
#!/bin/sh
/usr/sbin/sshd
su - testuser -c "tmux new-session -d -s testsession"
tail -f /dev/null
```

### File: `integration_tests/ssh/ssh_test.sh` (CREATE) [req.ssh101]

Integration test script.

#### Tests [req.ssh106] [req.ssh107] [req.ssh108] [req.ssh109] [req.ssh110] [req.ssh111]

- Full flow test: start session, connect via browser, verify output [req.ssh106]
- Terminal input test [req.ssh107]
- Resize test [req.ssh108]
- Disconnection cleanup test [req.ssh109]
- Reconnection test [req.ssh110]
- Auth failure test [req.ssh111]

Script should:
- Start Docker container [req.ssh112] [req.ssh113]
- Run tests
- Stop container on exit

---

## Security Implementation

### Session Ownership Validation [req.ssh080] [req.ssh012]

In `ConnectHandler`, verify JWT user ID matches session's user_id before allowing connection.

### Rate Limiting [req.ssh081]

Track active connections per user. Reject new connections if count exceeds `SSHMaxConnections`. Decrement on disconnect.

### Audit Logging [req.ssh082]

Log all proxy connection attempts with user ID, host ID, timestamp, and result (success/failure).

### Host Restriction [req.ssh084]

Only allow connections to hosts in the hosts table. The handler looks up host from session's host_id, never accepts arbitrary host:port from client.

### Idle Timeout [req.ssh083]

Implement idle detection in TCPProxy. If no data flows for `SSHIdleTimeout`, close both connections.

---

## Documentation Updates

### File: `doc/SERVER_ENDPOINTS.md` (MODIFY)

#### SSH Endpoints Section (DELETE)

Remove the entire SSH Endpoints section. SSH is now a sub-resource of hosts.

#### Hosts Endpoints Section (UPDATE)

Add the SSH endpoint to the hosts section:

```markdown
### SSH Connect (WebSocket)
- **Endpoint:** `GET /api/v1/hosts/{host_id}/ssh`
- **Authentication:** Requires JWT token (query param `token`)
- **Description:** WebSocket endpoint for TCP-over-WebSocket proxy to SSH.
- **Upgrade:** HTTP → WebSocket
- **Messages:**
  - Binary frames: Raw TCP data (bidirectional)
  - Text frames: JSON control messages
    - `{"type": "connected", "host": "hostname", "port": 22}` - Connection established
    - `{"type": "error", "message": "..."}` - Connection error
    - `{"type": "closed"}` - Connection closed
- **Notes:** The WebSocket proxies raw TCP to the host's SSH port. The browser runs an SSH client (Go WASM) that handles the SSH protocol.
```

#### Hosts Endpoints Section (UPDATE)

Update the hosts endpoint documentation to include new SSH fields:

```markdown
### Create Host
- **Request Body:**
  ```json
  {
    "label": "my-server",
    "hostname": "192.168.1.100",
    "ssh_user": "ubuntu",
    "ssh_port": 22
  }
  ```

### Update Host
- **Request Body:**
  ```json
  {
    "label": "my-server",
    "hostname": "192.168.1.100",
    "ssh_user": "ubuntu",
    "ssh_port": 22
  }
  ```
```

### File: `doc/ARCHITECTURE.md` (MODIFY)

Add a new section describing the SSH architecture:

```markdown
## SSH Terminal Access

Users can connect to active tmux sessions directly from the web dashboard.

### Architecture

```
Browser ←→ WebSocket ←→ Server (TCP Proxy) ←→ Host SSH Server ←→ tmux
```

- **Browser**: Runs Go SSH client compiled to WebAssembly
- **Server**: Acts as a dumb TCP-over-WebSocket proxy (does not interpret SSH protocol)
- **Host**: Standard SSH server with tmux running

### Security Model

- End-to-end encryption: Server cannot see SSH session contents
- Password authentication (entered in browser, sent directly to host over SSH)
- Server validates user owns the host before allowing proxy connection

### Data Flow

1. User clicks "Connect" on a session in the dashboard
2. Browser loads Go WASM SSH client
3. Browser opens WebSocket to `/api/v1/hosts/{host_id}/ssh`
4. Server validates ownership, opens TCP to host:ssh_port
5. Server proxies raw TCP bytes between WebSocket and TCP
6. Browser SSH client negotiates SSH connection through proxy
7. After SSH auth, browser executes `tmux attach -t {session_name}`
8. Terminal I/O flows through the proxy to xterm.js in browser
```

---

## Build Integration

### File: `build.sh` (MODIFY) [req.ssh036]

Add WASM build step:

```bash
# Build WASM SSH client
./build_wasm.sh
```

### File: `flake.nix` (MODIFY) [req.ssh125] [req.ssh112]

Ensure Docker is available in devshell for integration tests.

---

## Implementation Notes

- Go WASM requires `wasm_exec.js` from Go installation [req.ssh128]
- Consider TinyGo for smaller binary if needed [req.ssh129]
- Go WASM is single-threaded; goroutines share JS event loop [req.ssh130]
- Reference existing code patterns in the codebase [req.ssh120] [req.ssh121] [req.ssh122] [req.ssh123]
- Testing strategy: unit tests mock connections; integration tests use Docker [req.ssh126]
- Install xterm.js packages: `xterm`, `xterm-addon-fit`, `xterm-addon-webgl` [req.ssh080a] [req.yqy0e8]
- Get session name from metadata for tmux attach command [req.ssh067]
- Handle tmux-specific errors like "session not found" [req.ssh068]
- Future: support other commands beyond tmux attach [req.ssh069]
- End-to-end encryption: server cannot see SSH contents [req.ssh085]
- Password sent directly to host over SSH [req.ssh086]
- Clear password from memory after use [req.ssh087]
- Browser SSH client should validate host keys [req.ssh088]
- Consider TOFU for host key verification [req.ssh089]
- Future: replace password with FIDO2/WebAuthn [req.ssh089a] [req.189bgq]
- Use the project's flake.nix to run all build and test commands, otherwise dependencies will not work
