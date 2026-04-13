# SSH Feature Code Review

**Date:** 2026-04-13
**Reviewer:** Claude
**Scope:** All uncommitted changes for SSH feature implementation

---

## Summary

Overall, the SSH implementation is well-structured and follows the architecture outlined in the requirements. The code successfully implements a TCP-over-WebSocket proxy with a Go WASM SSH client running in the browser. All integration tests pass.

**Verdict:** Ready for commit with minor improvements recommended.

---

## Files Reviewed

### New Files
- `internal/ssh/proxy.go` - TCP proxy implementation
- `internal/ssh/handler.go` - WebSocket handler
- `web/wasm/sshclient/transport.go` - WASM WebSocket transport
- `web/wasm/sshclient/client.go` - WASM SSH client
- `web/wasm/sshclient/main.go` - WASM entry point
- `web/src/components/SSHTerminal.tsx` - Terminal component
- `web/src/components/PasswordDialog.tsx` - Password dialog
- `web/src/lib/ssh-client.ts` - TypeScript SSH wrapper
- `build_wasm.sh` - WASM build script
- `integration_tests/tests/ssh-e2e.spec.ts` - E2E tests
- `integration_tests/ssh/Dockerfile` - Test container
- `integration_tests/ssh/entrypoint.sh` - Container entrypoint
- `sql/00009_add_ssh_columns_to_hosts.sql` - Database migration

### Modified Files
- `internal/db/queries.go` - Added SSH fields to Host
- `internal/hosts/handler.go` - Handle SSH fields in API
- `internal/server/server.go` - Register SSH routes
- `web/src/lib/api.ts` - Added SSH API functions
- `web/src/types/api.ts` - Added SSH types
- `web/src/pages/SessionDetailPage.tsx` - Added terminal UI
- `web/src/components/HostForm.tsx` - SSH fields in form
- `build.sh` - Include WASM build

### Deleted Files
- `internal/ssh/handler_test.go` - Old test file (replaced by integration tests)

---

## Critical Issues

None found.

---

## High Priority Issues

### 1. Security: InsecureIgnoreHostKey in WASM client
**File:** `web/wasm/sshclient/client.go:89`
```go
HostKeyCallback: ssh.InsecureIgnoreHostKey(),
```
**Issue:** This bypasses SSH host key verification, making the connection vulnerable to MITM attacks.

**Recommendation:** Implement TOFU (Trust On First Use) with user confirmation, as mentioned in req.ssh089. Store known host keys in localStorage and prompt user on first connection or key change.

**Severity:** High (security)
**Blocking:** No (documented as future enhancement)

### 2. WebSocket Origin Check Always Returns True
**File:** `internal/ssh/handler.go:22-24`
```go
CheckOrigin: func(r *http.Request) bool {
    return true
},
```
**Issue:** This accepts WebSocket connections from any origin, potentially allowing CSRF-like attacks.

**Recommendation:** Validate origin against allowed domains in production.

**Severity:** Medium (security)
**Blocking:** No (typical for development, should be addressed before production)

---

## Medium Priority Issues

### 3. Hardcoded Timeout Values in Proxy
**File:** `internal/ssh/proxy.go:56, 100`
```go
p.ws.SetReadDeadline(time.Now().Add(30 * time.Second))
p.tcp.SetReadDeadline(time.Now().Add(30 * time.Second))
```
**Issue:** Timeout is hardcoded to 30 seconds instead of using `cfg.SSHIdleTimeout`.

**Recommendation:** Pass the config to TCPProxy and use `cfg.SSHIdleTimeout`.

### 4. Unused sendError Function
**File:** `internal/ssh/handler.go:146-149`
```go
func sendError(w http.ResponseWriter, message string) {
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(ControlMessage{Type: "error", Message: message})
}
```
**Issue:** This function is defined but never used.

**Recommendation:** Remove unused function or use it for consistent error handling.

### 5. Missing Error Handling in JSON Marshal
**File:** `web/wasm/sshclient/transport.go:54`
```go
authJSON, _ := json.Marshal(authMsg)
```
**Issue:** Error is silently ignored.

**Recommendation:** Handle the error or add a comment explaining why it's safe to ignore.

### 6. Potential Memory Leak in Event Listeners
**File:** `web/src/lib/ssh-client.ts`
**Issue:** The `on()` method adds callbacks but there's no mechanism to clean up listeners when SSHClient is no longer needed.

**Recommendation:** Consider adding a `destroy()` method that clears all event listeners.

---

## Low Priority Issues

### 7. Magic Numbers in Terminal Configuration
**File:** `web/src/components/SSHTerminal.tsx:39-40`
```tsx
rows: 24,
cols: 80,
```
**Issue:** Standard terminal dimensions are hardcoded.

**Recommendation:** Consider making these configurable or deriving from container size.

### 8. Duplicate AuthMessage Type Definition
**Files:**
- `internal/ssh/handler.go:27-30`
- `web/wasm/sshclient/transport.go:24-27`

**Issue:** Same struct defined in two places.

**Recommendation:** This is acceptable since they're in different codebases (server Go vs WASM Go), but consider adding a comment noting the duplication.

### 9. Missing Input Validation on SSH Port
**File:** `internal/hosts/handler.go`
**Issue:** SSH port is accepted without validation for valid port range (1-65535).

**Recommendation:** Add server-side validation for SSH port.

### 10. Console Logging in Production Code
**File:** `web/src/components/SSHTerminal.tsx:110, 115`
```tsx
console.error("Error disconnecting SSH client:", e)
console.error("Error disposing terminal:", e)
```
**Issue:** Console errors in production.

**Recommendation:** Consider using a proper logging utility that can be configured per environment.

---

## Code Quality Observations

### Positive Aspects

1. **Clean Architecture:** The TCP-over-WebSocket proxy design is clean and follows the separation of concerns principle.

2. **Proper Mutex Usage:** The Go code correctly uses mutexes for thread-safe access to shared state (`proxy.go`, `client.go`).

3. **Graceful Cleanup:** The cleanup functions properly handle the `done` channel to prevent double-close panics.

4. **Type Safety:** TypeScript types are well-defined with proper interfaces for the WASM bridge.

5. **Error Handling:** Most error paths are handled with appropriate status updates to the UI.

6. **Integration Tests:** Comprehensive E2E tests cover the main scenarios (connection, input, disconnect, auth failure, resize).

### Areas for Improvement

1. **Unit Tests:** The server-side SSH code lacks unit tests (handler_test.go was deleted). Consider adding unit tests for the proxy logic.

2. **Documentation:** The code could benefit from more inline comments explaining the WebSocket-to-TCP bridge flow.

3. **Logging Consistency:** Some errors are logged with `slog.Error`, others are silently ignored.

---

## Test Coverage

### Integration Tests (6 scenarios)
| Test | Status |
|------|--------|
| SSH terminal connects with correct password | Pass |
| Terminal accepts keyboard input | Pass |
| Disconnect button is present and functional | Pass |
| Wrong password shows error status | Pass |
| Terminal resize maintains connection | Pass |
| Close Terminal shows Connect again | Pass |

### Missing Test Coverage
- Unit tests for `proxy.go` bidirectional data flow
- Unit tests for rate limiting logic
- Unit tests for connection manager
- Frontend unit tests for SSHTerminal component

---

## Database Migration

**File:** `sql/00009_add_ssh_columns_to_hosts.sql`

```sql
ALTER TABLE hosts ADD COLUMN ssh_user TEXT DEFAULT '';
ALTER TABLE hosts ADD COLUMN ssh_port INTEGER DEFAULT 22;
```

**Review:** Migration is correct and safe:
- Uses `DEFAULT` values for backwards compatibility
- Port defaults to 22 (standard SSH port)
- User defaults to empty string (handled in code)

---

## Build System

**File:** `build_wasm.sh`

The WASM build script is clean and portable:
- Uses `SCRIPT_DIR` for relative paths
- Sets correct `GOOS=js GOARCH=wasm` environment

**File:** `build.sh`

Build order is correct:
1. Build WASM
2. Build web client (which copies WASM to dist)
3. Build Go binary

---

## Recommendations Summary

### Before Merge
1. None (all critical issues are documented as known limitations)

### Post-Merge (Technical Debt)
1. Add TOFU host key verification
2. Add unit tests for proxy and connection manager
3. Use configurable timeouts from config
4. Validate WebSocket origin in production
5. Add SSH port validation (1-65535)

---

## Conclusion

The SSH implementation is solid and well-architected. The code follows Go and TypeScript best practices, properly handles concurrency, and includes comprehensive integration tests. The security considerations around host key verification and origin checking are acceptable for an initial implementation but should be addressed before production deployment.

**Recommendation:** Approve for merge.
