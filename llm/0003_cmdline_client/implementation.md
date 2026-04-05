# Implementation Plan: Command Line Client

This document describes the implementation plan for the command line client portion of the `devsesh` project.

## Data Structures

### New Structs

#### `ClientConfig` (internal/client/config.go)
Configuration for the CLI client, loaded from config file and environment variables.
```go
type ClientConfig struct {
    ServerURL string
    JWTToken  string
}
```

#### `SessionFile` (internal/client/session.go)
Represents the YAML session file structure written to `$DEVSESH_SESSION_FILE`.
```go
type SessionFile struct {
    SessionID string            `yaml:"session_id"`
    Name      string            `yaml:"name"`
    StartTime time.Time         `yaml:"start_time"`
    Hostname  string            `yaml:"hostname"`
    Cwd       string            `yaml:"cwd"`
    Extra     map[string]string `yaml:",inline"`
}
```

## Files and Functions

---

### cmd/root.go (Modify)

#### `init()` (Modify)
Add new subcommands to the root command: `start`, `login`, `set`, `stop`, `list`, `attach`, `logout`.

---

### cmd/start.go (Create) [req.ypd87q] [req.b586k9]

#### `NewStartCmd() *cobra.Command`
Creates the `devsesh start [name]` command. Sets up flags and calls `runStart`.

#### `runStart(cmd *cobra.Command, args []string) error` [req.o5oh2n] [req.l3x8pd] [req.bklg10] [req.x6pxmb] [req.pgs54g] [req.xeab93] [req.ei4gec] [req.4h1wz6] [req.xewisy] [req.0tp96f] [req.rdunun] [req.r8c3e0] [req.y2xd5o] [req.qjxwaf]
Main entry point for the start command:
1. Load client config via `client.LoadConfig()`. If config is missing required fields and environment variables are not set, return error prompting user to login.
2. Generate a new UUID for `DEVSESH_SESSION_ID`.
3. Create the session file directory `/tmp/devsesh/sessions/` with 0700 permissions if it doesn't exist.
4. Set `DEVSESH_SESSION_FILE` to `/tmp/devsesh/sessions/[uuid].yml`.
5. Determine session name from args or default to "Unnamed Session".
6. Write the initial session file with session_id, name, start_time, hostname, and cwd.
7. Call `client.NotifySessionStart()` to notify the server.
8. Start tmux session via `tmux.StartSession()`.
9. Start goroutines for:
   - `tmux.MonitorOutput()` - monitors tmux output and calls ping endpoint with debounce.
   - `client.WatchSessionFile()` - watches session file for changes and posts updates to server.
10. Wait for tmux to exit, then call `client.NotifySessionEnd()`.
11. Clean up session file.

---

### cmd/login.go (Create)

#### `NewLoginCmd() *cobra.Command`
Creates the `devsesh login [url]` command.

#### `runLogin(cmd *cobra.Command, args []string) error` [req.9flxog] [req.l1pazq] [req.0723el] [req.w2h5nz] [req.58mwy2] [req.aljkmr] [req.aqtpcj] [req.ua6by6]
Main entry point for the login command:
1. Parse URL from args (required).
2. Call `client.RequestPairingCode(serverURL)` to get a pairing code from the server.
3. Print instructions for the user to visit the web client and enter the pairing code.
4. Poll `client.PollForJWT(serverURL, code)` every 5 seconds until a valid JWT is returned or 10 minutes timeout.
5. Call `client.SaveConfig()` to save server URL and JWT token to config file with 0600 permissions.

---

### cmd/set.go (Create)

#### `NewSetCmd() *cobra.Command`
Creates the `devsesh set [key] [value]` command.

#### `runSet(cmd *cobra.Command, args []string) error` [req.3n1za3] [req.50fgkf]
Main entry point for the set command:
1. Check if `DEVSESH_SESSION_ID` is set; if not, return error.
2. Read the current session file from `DEVSESH_SESSION_FILE`.
3. Update the key-value pair in the session file.
4. Write the updated session file back to disk. The file watcher will detect the change and post to the server.

---

### cmd/stop.go (Create)

#### `NewStopCmd() *cobra.Command`
Creates the `devsesh stop` command.

#### `runStop(cmd *cobra.Command, args []string) error`
Gracefully ends the current session:
1. Check if `DEVSESH_SESSION_ID` is set; if not, return error.
2. Send SIGTERM to the tmux session to gracefully terminate it.

---

### cmd/list.go (Create)

#### `NewListCmd() *cobra.Command`
Creates the `devsesh list` command.

#### `runList(cmd *cobra.Command, args []string) error`
Lists active local sessions:
1. Read all session files from `/tmp/devsesh/sessions/`.
2. For each file, check if the corresponding tmux session is still running.
3. Print a table of active sessions with session ID, name, and start time.

---

### cmd/attach.go (Create)

#### `NewAttachCmd() *cobra.Command`
Creates the `devsesh attach [name]` command.

#### `runAttach(cmd *cobra.Command, args []string) error`
Reattaches to an existing tmux session:
1. If name is provided, find the session by name in `/tmp/devsesh/sessions/`.
2. If no name, list available sessions and prompt user to select.
3. Call `tmux -2 attach-session -t [session_id]`.

---

### cmd/logout.go (Create)

#### `NewLogoutCmd() *cobra.Command`
Creates the `devsesh logout` command.

#### `runLogout(cmd *cobra.Command, args []string) error`
Clears stored credentials:
1. Delete the config file at `~/.devsesh/config.yml` (or `$DEVSESH_CONFIG_FILE`).
2. Print confirmation message.

---

### internal/client/config.go (Create)

#### `LoadConfig() (*ClientConfig, error)` [req.o5oh2n] [req.l3x8pd] [req.aqtpcj] [req.ua6by6]
Loads configuration from file and environment:
1. Determine config path from `$DEVSESH_CONFIG_FILE` or default to `~/.devsesh/config.yml`.
2. If file exists, parse YAML to get server_url and jwt_token.
3. Override with `DEVSESH_SERVER_URL` if set.
4. Override with `DEVSESH_JWT_TOKEN` if set.
5. Return `ClientConfig` struct.

#### `SaveConfig(cfg ClientConfig) error` [req.58mwy2] [req.aljkmr]
Saves configuration to file:
1. Determine config path from `$DEVSESH_CONFIG_FILE` or default to `~/.devsesh/config.yml`.
2. Create parent directory if it doesn't exist with 0700 permissions.
3. Marshal config to YAML.
4. Write file with 0600 permissions.

#### `DeleteConfig() error`
Deletes the config file for logout functionality.

#### `ConfigPath() string`
Returns the path to the config file, checking `$DEVSESH_CONFIG_FILE` first, then defaulting to `~/.devsesh/config.yml`.

---

### internal/client/api.go (Create)

#### `NewAPIClient(serverURL, jwtToken string) *APIClient`
Creates a new API client with the given server URL and JWT token.

#### `(c *APIClient) RequestPairingCode() (string, error)` [req.l1pazq]
Calls `POST /api/v1/auth/pair/start` to request a new pairing code. Returns the code string.

#### `(c *APIClient) PollForJWT(code string, timeout time.Duration) (string, error)` [req.w2h5nz]
Polls `POST /api/v1/auth/pair/complete` every 5 seconds with the pairing code until a JWT is returned or timeout (10 minutes) is reached.

#### `(c *APIClient) NotifySessionStart(sessionID string, sessionData SessionFile) error` [req.4h1wz6]
Calls `POST /api/v1/sessions/{session_id}/start` with session metadata to notify the server of a new session.

#### `(c *APIClient) PingSession(sessionID string) error` [req.xewisy]
Calls `POST /api/v1/sessions/{session_id}/ping` to update the last ping time.

#### `(c *APIClient) NotifySessionEnd(sessionID string) error` [req.0tp96f]
Calls `POST /api/v1/sessions/{session_id}/end` to notify the server that the session has ended.

#### `(c *APIClient) UpdateSessionMeta(sessionID string, meta map[string]any) error` [req.r8c3e0]
Calls `POST /api/v1/sessions/{session_id}/meta` with the updated session metadata.

---

### internal/client/session.go (Create)

#### `NewSessionFile(sessionID, name string) (*SessionFile, error)` [req.xeab93]
Creates a new SessionFile struct with:
- session_id: provided UUID
- name: provided name
- start_time: current timestamp
- hostname: from `os.Hostname()`
- cwd: from `os.Getwd()`

#### `WriteSessionFile(path string, sf *SessionFile) error` [req.xeab93]
Marshals SessionFile to YAML and writes to the specified path.

#### `ReadSessionFile(path string) (*SessionFile, error)`
Reads and parses a session file from the specified path.

#### `UpdateSessionFile(path, key, value string) error` [req.3n1za3]
Reads the session file, updates the specified key-value pair, and writes it back.

#### `WatchSessionFile(ctx context.Context, path string, onChange func(SessionFile)) error` [req.r8c3e0]
Uses fsnotify to watch the session file for changes. When changes are detected, reads the file and calls the onChange callback with the updated data.

---

### internal/client/tmux.go (Create)

#### `StartSession(sessionID string, env map[string]string) (*exec.Cmd, error)` [req.ei4gec] [req.y2xd5o] [req.qjxwaf]
Starts a new interactive tmux session:
1. Build command: `tmux -2 new-session -s [sessionID]`
2. Set environment variables (DEVSESH_SESSION_ID, DEVSESH_SESSION_FILE, DEVSESH_SESSION_NAME).
3. Connect stdin, stdout, stderr to the current process for interactivity.
4. Start the command and return it.

#### `MonitorOutput(ctx context.Context, sessionID string, onOutput func()) error` [req.xewisy]
Monitors tmux output by capturing the pane content periodically:
1. Use `tmux capture-pane -t [sessionID] -p` to get current pane content.
2. Compare with previous content to detect changes.
3. Call onOutput callback when changes detected (with debounce of ~1 second).

#### `KillSession(sessionID string) error`
Sends kill signal to the tmux session: `tmux kill-session -t [sessionID]`.

#### `ListSessions() ([]string, error)`
Lists all tmux sessions: `tmux list-sessions -F "#{session_name}"`.

#### `AttachSession(sessionID string) error`
Attaches to an existing tmux session interactively: `tmux -2 attach-session -t [sessionID]`.

#### `SessionExists(sessionID string) bool`
Checks if a tmux session with the given ID exists.

---

### internal/client/debounce.go (Create)

#### `NewDebouncer(delay time.Duration, fn func()) *Debouncer`
Creates a debouncer that delays calling fn until delay has passed since the last call.

#### `(d *Debouncer) Call()`
Triggers the debounced function. Resets the timer if called again before delay expires.

#### `(d *Debouncer) Stop()`
Stops the debouncer and cancels any pending calls.
