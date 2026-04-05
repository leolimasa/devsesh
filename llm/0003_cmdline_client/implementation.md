# Implementation Plan: Command Line Client

This document describes the implementation plan for the command line client portion of the `devsesh` project.

## Notes

- Use `slog` (Go standard library) for structured logging, consistent with the rest of the project. Example: `slog.Error("failed to connect", "error", err, "url", serverURL)`

## Data Structures

### New Structs

#### `ClientConfig` (internal/client/config.go)
Configuration for the CLI client, loaded from config file and environment variables.
```go
type ClientConfig struct {
    ServerURL   string
    JWTToken    string
    SessionsDir string
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
Add new subcommands to the root command: `start`, `login`, `set`, `stop`, `list`, `attach`, `resume`, `delete`, `logout`.

---

### cmd/start.go (Create) [req.ypd87q] [req.b586k9]

#### `NewStartCmd() *cobra.Command`
Creates the `devsesh start [name]` command. Sets up flags and calls `runStart`.

#### `runStart(cmd *cobra.Command, args []string) error` [req.o5oh2n] [req.l3x8pd] [req.bklg10] [req.x6pxmb] [req.pgs54g] [req.xeab93] [req.ei4gec] [req.4h1wz6] [req.xewisy] [req.0tp96f] [req.rdunun] [req.r8c3e0] [req.y2xd5o] [req.qjxwaf]
Main entry point for the start command:
1. Check if already inside a devsesh session via `os.Getenv("DEVSESH_SESSION_ID")`. If set, return error: "already inside a devsesh session".
2. Check if tmux is installed via `exec.LookPath("tmux")`. If not found, return error: "tmux is required but not installed".
3. Create a cancellable context and `sync.WaitGroup` to manage goroutine lifecycle.
4. Load client config via `client.LoadConfig()`. If config is missing required fields and environment variables are not set, return error prompting user to login.
5. Generate a new UUID for `DEVSESH_SESSION_ID`.
6. Create the session file directory (`config.SessionsDir`) with 0700 permissions if it doesn't exist.
7. Set `DEVSESH_SESSION_FILE` to `[config.SessionsDir]/[uuid].yml`.
8. Determine session name from args or default to "Unnamed Session".
9. Write the initial session file with session_id, name, start_time, hostname, and cwd.
10. Call `client.NotifySessionStart()` to notify the server.
11. Set up signal handler to catch SIGINT/SIGTERM. On signal: cancel the context, then proceed to cleanup (step 15).
12. Start tmux session via `tmux.StartSession()`. Pass context for the output monitor goroutine. The tmux session runs interactively with stdin/stdout/stderr connected to the current process, so the user sees and interacts with tmux directly.
13. Start goroutine (with WaitGroup) for `client.WatchSessionFile()` - watches session file for changes and posts updates to server. Must exit when context is cancelled.
14. Wait for tmux to exit, then cancel the context.
15. Wait for all goroutines to finish via `WaitGroup.Wait()`.
16. Call `client.NotifySessionEnd()` to notify the server.
17. Clean up session file.

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
Lists local sessions:
1. Load config and read all session files from `config.SessionsDir`.
2. Parse each file and extract session metadata (session ID, name, start time, hostname).
3. For each session, check if the corresponding tmux session exists to determine if it's active.
4. Print a table of sessions with session ID, name, start time, hostname, and status (active/inactive).

---

### cmd/attach.go (Create)

#### `NewAttachCmd() *cobra.Command`
Creates the `devsesh attach [name]` command.

#### `runAttach(cmd *cobra.Command, args []string) error`
Reattaches to an existing tmux session:
1. Load config. If name is provided, find the session by name in `config.SessionsDir`.
2. If no name, list available sessions and prompt user to select.
3. Call `tmux -2 attach-session -t [session_id]`.

---

### cmd/resume.go (Create)

#### `NewResumeCmd() *cobra.Command`
Creates the `devsesh resume [name]` command.

#### `runResume(cmd *cobra.Command, args []string) error`
Resumes an inactive session by starting a new tmux process with the existing session metadata:
1. Load config and read all session files from `config.SessionsDir`.
2. Filter to inactive sessions (where corresponding tmux session does not exist).
3. If name is provided, find the matching inactive session by name.
4. If no name, list inactive sessions and prompt user to select one.
5. If no inactive sessions found, return error.
6. Update the session file with new start_time.
7. Call `client.NotifySessionStart()` to notify the server.
8. Proceed with steps 9-16 from `runStart()` (signal handler, start tmux, watch file, wait for exit, cleanup).

---

### cmd/delete.go (Create)

#### `NewDeleteCmd() *cobra.Command`
Creates the `devsesh delete [name]` command.

#### `runDelete(cmd *cobra.Command, args []string) error`
Deletes a session:
1. Load config and read all session files from `config.SessionsDir`.
2. If name is provided, find the matching session by name.
3. If no name, list all sessions and prompt user to select one.
4. Check if session is active (tmux process exists). If active, return error: "cannot delete active session, use 'devsesh stop' first".
5. Call `client.NotifySessionEnd()` to notify the server (if not already ended).
6. Delete the session file from disk.
7. Print confirmation message.

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
2. If file exists:
   a. Check file permissions. If not 0600, return error: "config file has insecure permissions, expected 0600".
   b. Parse YAML to get server_url, jwt_token, and sessions_dir.
3. Override with `DEVSESH_SERVER_URL` if set.
4. Override with `DEVSESH_JWT_TOKEN` if set.
5. Override with `DEVSESH_SESSIONS_DIR` if set, otherwise default to `~/.devsesh/sessions/`.
6. Return `ClientConfig` struct.

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

#### `WatchSessionFile(ctx context.Context, wg *sync.WaitGroup, path string, debounceDelay time.Duration, onChange func(SessionFile)) error` [req.r8c3e0]
Uses fsnotify to watch the session file for changes. When changes are detected, debounces for `debounceDelay` (e.g., 500ms) before reading the file and calling the onChange callback. This prevents excessive API calls during rapid file modifications. Exits when context is cancelled. Registers with WaitGroup on start, signals done on exit.

---

### internal/client/tmux.go (Create)

#### `StartSession(ctx context.Context, wg *sync.WaitGroup, sessionID string, env map[string]string, onOutput func()) (*exec.Cmd, error)` [req.ei4gec] [req.y2xd5o] [req.qjxwaf] [req.xewisy]
Starts a new interactive tmux session with output monitoring:
1. Build command: `tmux -2 new-session -s [sessionID]`
2. Set environment variables (DEVSESH_SESSION_ID, DEVSESH_SESSION_FILE, DEVSESH_SESSION_NAME).
3. Connect stdin to the current process.
4. Create a monitoring writer via `NewOutputMonitor(ctx, wg, onOutput, debounceDelay)`.
5. Use `io.MultiWriter` to send tmux stdout to both `os.Stdout` and the monitoring writer.
6. Connect stderr similarly using `io.MultiWriter` with `os.Stderr`.
7. Start the command and return it.

#### `NewOutputMonitor(ctx context.Context, wg *sync.WaitGroup, onOutput func(), debounceDelay time.Duration) io.Writer` [req.xewisy]
Creates a writer that triggers a callback when bytes are written:
1. Returns an `io.Writer` implementation.
2. `Write()` must be non-blocking - use a non-blocking channel send or atomic flag to signal activity.
3. Spawns a goroutine (registered with WaitGroup) that watches for activity signals and runs the debounced `onOutput` callback.
4. Goroutine exits when context is cancelled.
5. This ensures `io.MultiWriter` never stalls waiting on the monitor.

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

---

## Unit Tests

All functionality must have unit tests. Tests must pass before the project is considered complete.

### internal/client/config_test.go

- `TestLoadConfig_DefaultPath` - loads config from default `~/.devsesh/config.yml`
- `TestLoadConfig_EnvOverride` - env vars override config file values
- `TestLoadConfig_InsecurePermissions` - returns error if config file is not 0600
- `TestLoadConfig_MissingFile` - returns empty config with defaults when file doesn't exist
- `TestSaveConfig_CreatesDirectory` - creates `~/.devsesh/` if it doesn't exist
- `TestSaveConfig_Permissions` - saves config with 0600 permissions
- `TestDeleteConfig` - deletes config file

### internal/client/api_test.go

- `TestRequestPairingCode_Success` - returns pairing code from server
- `TestRequestPairingCode_ServerError` - handles server errors gracefully
- `TestPollForJWT_Success` - returns JWT when server approves pairing
- `TestPollForJWT_Timeout` - returns error after 10 minute timeout
- `TestNotifySessionStart_Success` - sends session start notification
- `TestPingSession_Success` - sends ping to server
- `TestNotifySessionEnd_Success` - sends session end notification
- `TestUpdateSessionMeta_Success` - sends metadata update to server

### internal/client/session_test.go

- `TestNewSessionFile` - creates session file with correct fields
- `TestWriteSessionFile` - writes valid YAML to disk
- `TestReadSessionFile` - parses session file correctly
- `TestReadSessionFile_ExtraFields` - handles extra fields via inline map
- `TestUpdateSessionFile` - updates key-value pair in session file
- `TestWatchSessionFile_DetectsChanges` - calls onChange when file changes
- `TestWatchSessionFile_Debounce` - debounces rapid file changes
- `TestWatchSessionFile_ContextCancel` - exits when context is cancelled
- `TestSessionsDir_Default` - returns default path
- `TestSessionsDir_EnvOverride` - respects `DEVSESH_SESSIONS_DIR`

### internal/client/tmux_test.go

- `TestStartSession_SetsEnvVars` - sets DEVSESH_* env vars
- `TestStartSession_ConnectsStdio` - connects stdin/stdout/stderr
- `TestNewOutputMonitor_NonBlocking` - Write() returns immediately
- `TestNewOutputMonitor_TriggersCallback` - calls onOutput when bytes written
- `TestNewOutputMonitor_Debounce` - debounces rapid writes
- `TestNewOutputMonitor_ContextCancel` - stops goroutine on context cancel
- `TestKillSession` - kills tmux session
- `TestListSessions` - lists tmux sessions
- `TestSessionExists_True` - returns true for existing session
- `TestSessionExists_False` - returns false for non-existent session

### internal/client/debounce_test.go

- `TestDebouncer_CallsFunction` - calls function after delay
- `TestDebouncer_ResetsTimer` - resets timer on subsequent calls
- `TestDebouncer_Stop` - cancels pending call when stopped
- `TestDebouncer_MultipleCalls` - only calls function once for rapid calls

### cmd/*_test.go

Integration tests for commands (may require mocking):

- `TestStartCmd_NestedSessionError` - returns error if already in session
- `TestStartCmd_TmuxNotInstalled` - returns error if tmux not found
- `TestStartCmd_NotLoggedIn` - prompts user to login if config missing
- `TestLoginCmd_Success` - completes login flow
- `TestLoginCmd_Timeout` - handles polling timeout
- `TestSetCmd_NotInSession` - returns error if not in session
- `TestSetCmd_UpdatesFile` - updates session file
- `TestListCmd_ShowsSessions` - displays sessions from disk
- `TestListCmd_ShowsStatus` - shows active/inactive status
- `TestAttachCmd_AttachesSession` - attaches to tmux session
- `TestResumeCmd_ResumesInactive` - resumes inactive session
- `TestResumeCmd_RejectsActive` - returns error for active session
- `TestDeleteCmd_DeletesInactive` - deletes inactive session file
- `TestDeleteCmd_RejectsActive` - returns error for active session
- `TestStopCmd_KillsSession` - sends SIGTERM to tmux
- `TestLogoutCmd_DeletesConfig` - deletes config file

### Running Tests

Update `test.sh` to include the new test packages if not already present:
- `internal/client/...`
- `cmd/...`

```bash
./test.sh
```

All tests must pass before the implementation is considered complete.
