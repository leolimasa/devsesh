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

### ~~4. Missing Signal Handling~~ ✓ RESOLVED

Added step 8 to `runStart()`: Set up signal handler to catch SIGINT/SIGTERM. On signal: call `NotifySessionEnd()`, kill tmux session, clean up session file, then exit.

### ~~7. MonitorOutput Polling Efficiency~~ ✓ RESOLVED

Replaced `tmux capture-pane` polling with `io.MultiWriter` approach. `StartSession()` now takes an `onOutput` callback and monitors tmux stdout/stderr directly. Any rendering output triggers a debounced ping - no polling or subprocess spawning needed.

### ~~6. Missing tmux Dependency Check~~ ✓ RESOLVED

Added step 1 to `runStart()`: Check if tmux is installed via `exec.LookPath("tmux")`. Returns error if not found.

### ~~8. Missing Debounce for Session File Watcher~~ ✓ RESOLVED

Added `debounceDelay` parameter to `WatchSessionFile()`. Debounces file change events before calling `onChange` callback.

### ~~10. Missing Concurrent Session Handling~~ ✓ RESOLVED

Added step 1 to `runStart()`: Check if `DEVSESH_SESSION_ID` env var is set. If so, return error: "already inside a devsesh session".

### ~~11. Config File Permission Verification~~ ✓ RESOLVED

Added permission check to `LoadConfig()` step 2a: If config file exists but permissions are not 0600, return error.

---

## Open Issues

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

### 12. SessionFile Struct Missing Extra Field Handling

**Location:** `internal/client/session.go` - `UpdateSessionFile()`

The `SessionFile` struct uses `Extra map[string]string` with `yaml:",inline"` for additional fields. However:
- `UpdateSessionFile(path, key, value)` takes string value only
- How are nested/complex values handled via `devsesh set`?

**Recommendation:** Document that only string values are supported for extra fields, or extend signature.

---

## Minor Suggestions

1. ~~**Logging**~~: Added note to use `slog` for structured logging, consistent with the rest of the project.

2. **List command filtering**: `devsesh list` shows all sessions. Consider adding flags like `--all` to include ended sessions.

3. **Attach fuzzy matching**: For `devsesh attach [name]`, consider fuzzy matching or prefix matching, not just exact name match.

4. **Stop command scope**: `devsesh stop` currently sends SIGTERM to tmux. Should there be a `--force` flag for SIGKILL?

---

## Summary

The implementation plan covers all functional requirements with appropriate requirement traceability tags.

**Resolved (10 issues):**
- ~~Login flow UX ambiguity~~ - README updated to use polling approach
- ~~Login command signature mismatch~~ - README updated to match requirements
- ~~API endpoint path inconsistency~~ - README updated to use `/api/v1/...` paths
- ~~Session directory race condition~~ - Changed from `/tmp` to `~/.devsesh/sessions/`
- ~~Missing signal handling~~ - Added SIGINT/SIGTERM handler to `runStart()`
- ~~MonitorOutput polling efficiency~~ - Replaced with `io.MultiWriter` on tmux stdout/stderr
- ~~Missing tmux dependency check~~ - Added `exec.LookPath("tmux")` check to `runStart()`
- ~~Missing debounce for file watcher~~ - Added `debounceDelay` parameter to `WatchSessionFile()`
- ~~Missing concurrent session handling~~ - Added nested session check to `runStart()`
- ~~Config file permission verification~~ - Added 0600 permission check to `LoadConfig()`

**Remaining (2 issues):**
- Missing resilience features (crash recovery)
- Implementation details (extra field handling)

These remaining issues should be addressed in implementation.md before coding begins.
