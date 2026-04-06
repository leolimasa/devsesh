# Command Line Client Implementation Checklist

## Project Status

- 🟡 Phase 1: Core Infrastructure (debouncer.go, config.go, tests)
- 🟡 Phase 2: Session File Management (session.go, tests)
- 🟡 Phase 3: API Client (api.go, tests)
- 🟡 Phase 4: Tmux Integration (tmux.go, tests)
- 🟡 Phase 5: Commands (all cmd files, tests)
- 🟡 Phase 6: Final Integration and testing

## Phase 1: Core Infrastructure

### Debouncer (internal/client/debounce.go)

- [ ] Create `internal/client/debounce.go`
- [ ] Implement `NewDebouncer(delay time.Duration, fn func()) *Debouncer`
- [ ] Implement `(d *Debouncer) Call()` - triggers debounced function, resets timer on subsequent calls
- [ ] Implement `(d *Debouncer) Stop()` - cancels pending calls

### Configuration (internal/client/config.go)

- [ ] Create `internal/client/config.go`
- [ ] Define `ClientConfig` struct with `ServerURL`, `JWTToken`, `SessionsDir` fields
- [ ] Implement `ConfigPath() string` - returns path from `$DEVSESH_CONFIG_FILE` or default `~/.devsesh/config.yml`
- [ ] Implement `LoadConfig() (*ClientConfig, error)` [req.o5oh2n] [req.l3x8pd] [req.aqtpcj] [req.ua6by6]
  - [ ] Check file permissions are 0600, return error if insecure
  - [ ] Parse YAML to get server_url, jwt_token, sessions_dir
  - [ ] Override with `DEVSESH_SERVER_URL` if set [req.aqtpcj]
  - [ ] Override with `DEVSESH_JWT_TOKEN` if set [req.ua6by6]
  - [ ] Override with `DEVSESH_SESSIONS_DIR` if set, otherwise default to `~/.devsesh/sessions/`
- [ ] Implement `SaveConfig(cfg ClientConfig) error` [req.58mwy2] [req.aljkmr]
  - [ ] Create parent directory with 0700 permissions if needed
  - [ ] Write config file with 0600 permissions [req.aljkmr]
- [ ] Implement `DeleteConfig() error`

### Phase 1 Tests

- [ ] Create `internal/client/debounce_test.go`
  - [ ] `TestDebouncer_CallsFunction`
  - [ ] `TestDebouncer_ResetsTimer`
  - [ ] `TestDebouncer_Stop`
  - [ ] `TestDebouncer_MultipleCalls`
- [ ] Create `internal/client/config_test.go`
  - [ ] `TestLoadConfig_DefaultPath`
  - [ ] `TestLoadConfig_EnvOverride`
  - [ ] `TestLoadConfig_InsecurePermissions`
  - [ ] `TestLoadConfig_MissingFile`
  - [ ] `TestSaveConfig_CreatesDirectory`
  - [ ] `TestSaveConfig_Permissions`
  - [ ] `TestDeleteConfig`
- [ ] Update `test.sh` to include `internal/client/...`
- [ ] Run `./test.sh` and verify all Phase 1 tests pass

---

## Phase 2: Session File Management

### Session File (internal/client/session.go)

- [ ] Create `internal/client/session.go`
- [ ] Define `SessionFile` struct with fields: `SessionID`, `Name`, `StartTime`, `Hostname`, `Cwd`, `Extra` [req.xeab93]
- [ ] Implement `NewSessionFile(sessionID, name string) (*SessionFile, error)` [req.xeab93]
  - [ ] Set session_id, name, start_time (current timestamp), hostname, cwd
- [ ] Implement `WriteSessionFile(path string, sf *SessionFile) error` [req.xeab93]
- [ ] Implement `ReadSessionFile(path string) (*SessionFile, error)`
- [ ] Implement `UpdateSessionFile(path, key, value string) error` [req.3n1za3]
- [ ] Implement `WatchSessionFile(ctx, wg, path, debounceDelay, onChange)` [req.r8c3e0]
  - [ ] Use fsnotify to watch for changes
  - [ ] Debounce rapid changes
  - [ ] Exit when context is cancelled
  - [ ] Register with WaitGroup

### Phase 2 Tests

- [ ] Create `internal/client/session_test.go`
  - [ ] `TestNewSessionFile`
  - [ ] `TestWriteSessionFile`
  - [ ] `TestReadSessionFile`
  - [ ] `TestReadSessionFile_ExtraFields`
  - [ ] `TestUpdateSessionFile`
  - [ ] `TestWatchSessionFile_DetectsChanges`
  - [ ] `TestWatchSessionFile_Debounce`
  - [ ] `TestWatchSessionFile_ContextCancel`
- [ ] Run `./test.sh` and verify all Phase 2 tests pass

---

## Phase 3: API Client

### API Client (internal/client/api.go)

- [ ] Create `internal/client/api.go`
- [ ] Implement `NewAPIClient(serverURL, jwtToken string) *APIClient`
- [ ] Implement `RequestPairingCode() (string, error)` [req.l1pazq]
  - [ ] POST to `/api/v1/auth/pair/start`
- [ ] Implement `PollForJWT(code string, timeout time.Duration) (string, error)` [req.w2h5nz]
  - [ ] Poll `/api/v1/auth/pair/complete` every 5 seconds
  - [ ] Timeout after 10 minutes
- [ ] Implement `NotifySessionStart(sessionID string, sessionData SessionFile) error` [req.4h1wz6]
  - [ ] POST to `/api/v1/sessions/{session_id}/start`
- [ ] Implement `PingSession(sessionID string) error` [req.xewisy]
  - [ ] POST to `/api/v1/sessions/{session_id}/ping`
- [ ] Implement `NotifySessionEnd(sessionID string) error` [req.0tp96f]
  - [ ] POST to `/api/v1/sessions/{session_id}/end`
- [ ] Implement `UpdateSessionMeta(sessionID string, meta map[string]any) error` [req.r8c3e0]
  - [ ] POST to `/api/v1/sessions/{session_id}/meta`

### Phase 3 Tests

- [ ] Create `internal/client/api_test.go`
  - [ ] `TestRequestPairingCode_Success`
  - [ ] `TestRequestPairingCode_ServerError`
  - [ ] `TestPollForJWT_Success`
  - [ ] `TestPollForJWT_Timeout`
  - [ ] `TestNotifySessionStart_Success`
  - [ ] `TestPingSession_Success`
  - [ ] `TestNotifySessionEnd_Success`
  - [ ] `TestUpdateSessionMeta_Success`
- [ ] Run `./test.sh` and verify all Phase 3 tests pass

---

## Phase 4: Tmux Integration

### Tmux (internal/client/tmux.go)

- [ ] Create `internal/client/tmux.go`
- [ ] Implement `NewOutputMonitor(ctx, wg, onOutput, debounceDelay) io.Writer` [req.xewisy]
  - [ ] `Write()` must be non-blocking (use channel or atomic flag)
  - [ ] Spawn goroutine for debounced callback
  - [ ] Exit goroutine on context cancel
- [ ] Implement `StartSession(ctx, wg, sessionID, env, onOutput) (*exec.Cmd, error)` [req.ei4gec] [req.y2xd5o] [req.qjxwaf] [req.xewisy]
  - [ ] Build `tmux -2 new-session -s [sessionID]` command
  - [ ] Set DEVSESH_SESSION_ID, DEVSESH_SESSION_FILE, DEVSESH_SESSION_NAME env vars
  - [ ] Connect stdin to current process [req.qjxwaf]
  - [ ] Use `io.MultiWriter` for stdout with output monitor [req.y2xd5o]
  - [ ] Use `io.MultiWriter` for stderr [req.y2xd5o]
- [ ] Implement `KillSession(sessionID string) error`
- [ ] Implement `ListSessions() ([]string, error)`
- [ ] Implement `AttachSession(sessionID string) error`
- [ ] Implement `SessionExists(sessionID string) bool`

### Phase 4 Tests

- [ ] Create `internal/client/tmux_test.go`
  - [ ] `TestNewOutputMonitor_NonBlocking`
  - [ ] `TestNewOutputMonitor_TriggersCallback`
  - [ ] `TestNewOutputMonitor_Debounce`
  - [ ] `TestNewOutputMonitor_ContextCancel`
  - [ ] `TestStartSession_SetsEnvVars`
  - [ ] `TestStartSession_ConnectsStdio`
  - [ ] `TestKillSession`
  - [ ] `TestListSessions`
  - [ ] `TestSessionExists_True`
  - [ ] `TestSessionExists_False`
- [ ] Run `./test.sh` and verify all Phase 4 tests pass

---

## Phase 5: Commands

### Root Command (cmd/root.go)

- [ ] Modify `cmd/root.go` to add subcommands: `start`, `login`, `set`, `stop`, `list`, `attach`, `resume`, `delete`, `logout` [req.ypd87q] [req.b586k9]

### Login Command (cmd/login.go)

- [ ] Create `cmd/login.go`
- [ ] Implement `NewLoginCmd() *cobra.Command`
- [ ] Implement `runLogin()` [req.9flxog] [req.l1pazq] [req.0723el] [req.w2h5nz] [req.58mwy2] [req.aljkmr] [req.aqtpcj] [req.ua6by6]
  - [ ] Parse URL from args [req.9flxog]
  - [ ] Call `RequestPairingCode()` [req.l1pazq]
  - [ ] Print instructions to visit web client [req.0723el]
  - [ ] Poll for JWT [req.w2h5nz]
  - [ ] Save config with 0600 permissions [req.58mwy2] [req.aljkmr]

### Start Command (cmd/start.go)

- [ ] Create `cmd/start.go`
- [ ] Implement `NewStartCmd() *cobra.Command`
- [ ] Implement `runStart()` [req.o5oh2n] [req.l3x8pd] [req.bklg10] [req.x6pxmb] [req.pgs54g] [req.xeab93] [req.ei4gec] [req.4h1wz6] [req.xewisy] [req.0tp96f] [req.rdunun] [req.r8c3e0] [req.y2xd5o] [req.qjxwaf]
  - [ ] Check for nested session (DEVSESH_SESSION_ID set)
  - [ ] Check tmux is installed
  - [ ] Create context and WaitGroup
  - [ ] Load config [req.o5oh2n] [req.l3x8pd]
  - [ ] Generate UUID for session [req.bklg10]
  - [ ] Create sessions directory with 0700 permissions
  - [ ] Set DEVSESH_SESSION_FILE [req.x6pxmb]
  - [ ] Determine session name [req.pgs54g]
  - [ ] Write initial session file [req.xeab93]
  - [ ] Notify server of session start [req.4h1wz6]
  - [ ] Set up signal handler (SIGINT/SIGTERM)
  - [ ] Start tmux session [req.ei4gec] [req.y2xd5o] [req.qjxwaf]
  - [ ] Start WatchSessionFile goroutine [req.r8c3e0]
  - [ ] Wait for tmux exit [req.rdunun]
  - [ ] Wait for goroutines to finish
  - [ ] Notify server of session end [req.0tp96f]
  - [ ] Clean up session file

### Set Command (cmd/set.go)

- [ ] Create `cmd/set.go`
- [ ] Implement `NewSetCmd() *cobra.Command`
- [ ] Implement `runSet()` [req.3n1za3] [req.50fgkf]
  - [ ] Check DEVSESH_SESSION_ID is set [req.50fgkf]
  - [ ] Update session file with key-value [req.3n1za3]

### Stop Command (cmd/stop.go)

- [ ] Create `cmd/stop.go`
- [ ] Implement `NewStopCmd() *cobra.Command`
- [ ] Implement `runStop()`
  - [ ] Check DEVSESH_SESSION_ID is set
  - [ ] Send SIGTERM to tmux session

### List Command (cmd/list.go)

- [ ] Create `cmd/list.go`
- [ ] Implement `NewListCmd() *cobra.Command`
- [ ] Implement `runList()`
  - [ ] Load config and read session files
  - [ ] Check tmux to determine active/inactive status
  - [ ] Print table of sessions

### Attach Command (cmd/attach.go)

- [ ] Create `cmd/attach.go`
- [ ] Implement `NewAttachCmd() *cobra.Command`
- [ ] Implement `runAttach()`
  - [ ] Find session by name or prompt user
  - [ ] Attach to tmux session

### Resume Command (cmd/resume.go)

- [ ] Create `cmd/resume.go`
- [ ] Implement `NewResumeCmd() *cobra.Command`
- [ ] Implement `runResume()`
  - [ ] Filter to inactive sessions
  - [ ] Find session by name or prompt user
  - [ ] Update session file with new start_time
  - [ ] Notify server and start tmux (reuse runStart flow)

### Delete Command (cmd/delete.go)

- [ ] Create `cmd/delete.go`
- [ ] Implement `NewDeleteCmd() *cobra.Command`
- [ ] Implement `runDelete()`
  - [ ] Find session by name or prompt user
  - [ ] Check session is not active
  - [ ] Notify server of session end
  - [ ] Delete session file

### Logout Command (cmd/logout.go)

- [ ] Create `cmd/logout.go`
- [ ] Implement `NewLogoutCmd() *cobra.Command`
- [ ] Implement `runLogout()`
  - [ ] Delete config file
  - [ ] Print confirmation

### Phase 5 Tests

- [ ] Create `cmd/login_test.go`
  - [ ] `TestLoginCmd_Success`
  - [ ] `TestLoginCmd_Timeout`
- [ ] Create `cmd/start_test.go`
  - [ ] `TestStartCmd_NestedSessionError`
  - [ ] `TestStartCmd_TmuxNotInstalled`
  - [ ] `TestStartCmd_NotLoggedIn`
- [ ] Create `cmd/set_test.go`
  - [ ] `TestSetCmd_NotInSession`
  - [ ] `TestSetCmd_UpdatesFile`
- [ ] Create `cmd/stop_test.go`
  - [ ] `TestStopCmd_KillsSession`
- [ ] Create `cmd/list_test.go`
  - [ ] `TestListCmd_ShowsSessions`
  - [ ] `TestListCmd_ShowsStatus`
- [ ] Create `cmd/attach_test.go`
  - [ ] `TestAttachCmd_AttachesSession`
- [ ] Create `cmd/resume_test.go`
  - [ ] `TestResumeCmd_ResumesInactive`
  - [ ] `TestResumeCmd_RejectsActive`
- [ ] Create `cmd/delete_test.go`
  - [ ] `TestDeleteCmd_DeletesInactive`
  - [ ] `TestDeleteCmd_RejectsActive`
- [ ] Create `cmd/logout_test.go`
  - [ ] `TestLogoutCmd_DeletesConfig`
- [ ] Update `test.sh` to include `cmd/...`
- [ ] Run `./test.sh` and verify all Phase 5 tests pass

---

## Phase 6: Final Integration

- [ ] Verify all requirement tags are implemented:
  - [ ] [req.ypd87q] - CLI written in Go
  - [ ] [req.b586k9] - Same codebase as server
  - [ ] [req.o5oh2n] - Read config file
  - [ ] [req.l3x8pd] - Prompt to login if config missing
  - [ ] [req.bklg10] - Set DEVSESH_SESSION_ID to new uuid
  - [ ] [req.x6pxmb] - Set DEVSESH_SESSION_FILE
  - [ ] [req.pgs54g] - Set DEVSESH_SESSION_NAME
  - [ ] [req.xeab93] - Generate session file YAML
  - [ ] [req.ei4gec] - Start tmux session
  - [ ] [req.4h1wz6] - Call session start endpoint
  - [ ] [req.xewisy] - Monitor tmux output and ping
  - [ ] [req.0tp96f] - Monitor for exit and end session
  - [ ] [req.rdunun] - Process ends if tmux ends
  - [ ] [req.r8c3e0] - Observe session file and post changes
  - [ ] [req.y2xd5o] - Tmux interactive stdout/stderr
  - [ ] [req.qjxwaf] - Tmux receives input
  - [ ] [req.9flxog] - URL is server URL
  - [ ] [req.l1pazq] - Get pairing code
  - [ ] [req.0723el] - Prompt user to visit web client
  - [ ] [req.w2h5nz] - Poll JWT endpoint
  - [ ] [req.58mwy2] - Save JWT and URL to config
  - [ ] [req.aljkmr] - Config file 0600 permissions
  - [ ] [req.aqtpcj] - DEVSESH_SERVER_URL override
  - [ ] [req.ua6by6] - DEVSESH_JWT_TOKEN override
  - [ ] [req.3n1za3] - Set key-value in session file
  - [ ] [req.50fgkf] - Only works if session active
- [ ] Run `./test.sh` and verify ALL tests pass
- [ ] Manual testing: complete login flow with real server
- [ ] Manual testing: start session, verify tmux interactivity
- [ ] Manual testing: set key-value, verify server receives update
- [ ] Manual testing: list, attach, resume, delete, stop commands
- [ ] Manual testing: logout clears credentials
