# Implementation Review: Command Line Client

Review of `implementation.md` against `requirements.md` and `README.md`.

## Resolved Issues

The following issues have been addressed by updating `README.md`:

### ~~1. Login Flow Inconsistency~~ ✓ RESOLVED

README updated to use polling approach (poll every 5 seconds, timeout after 10 minutes), matching implementation.md.

### ~~2. Login Command Signature Mismatch~~ ✓ RESOLVED

README updated from `devsesh login [email] [url]` to `devsesh login [url]`, matching requirements.md.

### ~~3. API Endpoint Path Inconsistency~~ ✓ RESOLVED

README updated to use versioned paths (`/api/v1/...`) throughout, matching implementation.md and the server section.

### ~~5. Session Directory Race Condition~~ ✓ RESOLVED

Session files moved from `/tmp/devsesh/sessions/` to `~/.devsesh/sessions/`. Home directory is owned by the user, eliminating the TOCTOU symlink attack vector present with shared `/tmp`.

---

## Open Issues

### 4. Missing Signal Handling

**Location:** `cmd/start.go` - `runStart()`

No mention of handling SIGINT/SIGTERM. If the devsesh process is killed, the session should still be properly ended on the server.

**Recommendation:** Add step to handle signals:
- Catch SIGINT, SIGTERM
- Call `NotifySessionEnd()` before exit
- Kill tmux session or leave it running (document which behavior)

---

### 6. Missing tmux Dependency Check

**Location:** `cmd/start.go` - `runStart()` or `internal/client/tmux.go`

No check for tmux being installed before attempting to start a session.

**Recommendation:** Add early check in `runStart()`:
```go
if _, err := exec.LookPath("tmux"); err != nil {
    return fmt.Errorf("tmux is required but not installed")
}
```

---

### 7. MonitorOutput Polling Efficiency

**Location:** `internal/client/tmux.go` - `MonitorOutput()`

Using `tmux capture-pane` in a loop is inefficient.

**Alternative:** Consider `tmux pipe-pane -t [sessionID] 'cat >> /tmp/output'` with file watching, or hooks via `set-hook` for certain tmux versions.

**Note:** Current approach is simpler and more portable. Document this trade-off.

---

### 8. Missing Debounce for Session File Watcher

**Location:** `internal/client/session.go` - `WatchSessionFile()`

The `MonitorOutput` function specifies ~1 second debounce, but `WatchSessionFile` doesn't specify debounce timing. Rapid file modifications could cause excessive API calls.

**Recommendation:** Specify debounce behavior (e.g., 500ms - 1s delay after last change).

---

### 9. Crash Recovery / Orphaned Sessions

**Location:** `cmd/start.go` - `runStart()` step 11

"Clean up session file" is mentioned but:
- What happens if devsesh crashes before cleanup?
- Session file remains but server thinks session is active

**Recommendation:** Add startup check for orphaned session files:
- On `devsesh start`, check for existing session files
- Verify if corresponding tmux session exists
- Clean up orphaned files and optionally notify server

---

### 10. Missing Concurrent Session Handling

**Location:** `cmd/start.go`

No specification for what happens if user runs `devsesh start` while already inside a devsesh session (nested sessions).

**Recommendation:** Add check:
```go
if os.Getenv("DEVSESH_SESSION_ID") != "" {
    return fmt.Errorf("already inside a devsesh session")
}
```

---

### 11. Config File Permission Verification

**Location:** `internal/client/config.go` - `LoadConfig()`

`SaveConfig()` sets 0600 permissions, but `LoadConfig()` doesn't verify permissions when reading. Malicious actor could:
1. Create world-readable config file before first use
2. User runs login, JWT is written to insecure file

**Recommendation:** Verify file permissions in `LoadConfig()` and warn/fail if insecure.

---

### 12. SessionFile Struct Missing Extra Field Handling

**Location:** `internal/client/session.go` - `UpdateSessionFile()`

The `SessionFile` struct uses `Extra map[string]string` with `yaml:",inline"` for additional fields. However:
- `UpdateSessionFile(path, key, value)` takes string value only
- How are nested/complex values handled via `devsesh set`?

**Recommendation:** Document that only string values are supported for extra fields, or extend signature.

---

## Minor Suggestions

1. **Logging**: No mention of logging for debugging. Consider adding structured logging with configurable verbosity.

2. **List command filtering**: `devsesh list` shows all sessions. Consider adding flags like `--all` to include ended sessions.

3. **Attach fuzzy matching**: For `devsesh attach [name]`, consider fuzzy matching or prefix matching, not just exact name match.

4. **Stop command scope**: `devsesh stop` currently sends SIGTERM to tmux. Should there be a `--force` flag for SIGKILL?

---

## Summary

The implementation plan covers all functional requirements with appropriate requirement traceability tags.

**Resolved (4 issues):**
- ~~Login flow UX ambiguity~~ - README updated to use polling approach
- ~~Login command signature mismatch~~ - README updated to match requirements
- ~~API endpoint path inconsistency~~ - README updated to use `/api/v1/...` paths
- ~~Session directory race condition~~ - Changed from `/tmp` to `~/.devsesh/sessions/`

**Remaining (8 issues):**
- Missing resilience features (signal handling, crash recovery, nested session detection)
- Security hardening (config permissions verification)
- Implementation details (tmux dependency check, debounce for file watcher, extra field handling)

These remaining issues should be addressed in implementation.md before coding begins.
