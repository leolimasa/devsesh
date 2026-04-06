# Requirements Review

## Summary

The requirements document provides a clear high-level goal but lacks specificity in several areas that will be needed for implementation.

## Suggestions

### 1. Test Environment Setup

The requirements should specify:

- **Server lifecycle management**: How should tests start/stop the server? Should there be a fresh server instance per test suite or per test?
- **Database isolation**: Should tests use a fresh SQLite database? How should test data be cleaned up between runs?
- **Port configuration**: Should tests use a dedicated port (e.g., 9999) to avoid conflicts with running instances?
- **Environment variables**: Document which env vars need to be set (e.g., `DEVSESH_ALLOW_USER_CREATION=true` for registration tests)

**Suggested addition:**
```
* Test environment setup:
  * Start server on a dedicated test port (e.g., 9999)
  * Use a temporary database file that is deleted after tests
  * Set DEVSESH_ALLOW_USER_CREATION=true for registration tests
  * Clean up session files from ~/.devsesh/sessions/ between test runs
```

### 2. Test Organization Structure

Consider specifying how tests should be organized:

- By component (auth, sessions, pairing, CLI)
- By workflow (registration flow, login flow, session lifecycle)
- Naming conventions for test files

**Suggested addition:**
```
* Test organization:
  * Group tests by feature area (auth, sessions, pairing, CLI)
  * Use descriptive test names that indicate the scenario being tested
```

### 3. Specific Feature Coverage

Based on README.md and docs, explicitly list the features to test:

**Authentication (WebAuthn):**
- User registration with passkey
- User login with passkey
- Adding additional passkeys
- Deleting passkeys (ensuring at least one remains)
- Auth status endpoint (checking if users exist)

**Session Management:**
- `devsesh start [name]` - create new session
- `devsesh stop` - end current session
- `devsesh list` - list sessions for current machine
- `devsesh attach [name]` - attach to existing session
- `devsesh resume [name]` - resume inactive session
- `devsesh delete [name]` - delete session
- `devsesh set [key] [value]` - update session metadata
- Session ping/heartbeat mechanism
- Stale session cleanup

**Device Pairing:**
- `devsesh login [url]` - initiate pairing
- Code generation and display
- Code entry in web UI
- Token exchange and storage
- `devsesh logout` - clear credentials

**Real-time Updates:**
- WebSocket connection establishment
- Session start events
- Session ping events
- Session end events
- Metadata update events

**Web UI Pages:**
- LoginPage - passkey authentication
- RegisterPage - new user registration
- DashboardPage - session list with real-time updates
- SessionDetailPage - single session view
- PairPage - device pairing code entry
- PasskeyManagementPage - add/remove passkeys

### 4. WebAuthn Testing Details

Playwright's WebAuthn emulation has specific capabilities. Consider specifying:

- Virtual authenticator configuration (internal vs cross-platform)
- Testing with resident keys vs server-side credentials
- Error scenarios (cancelled authentication, timeout)

**Suggested addition:**
```
* WebAuthn testing scenarios:
  * Successful registration with new passkey
  * Successful login with existing passkey
  * Registration with duplicate email (should fail)
  * Login with non-existent user (should fail)
  * Add second passkey to existing account
  * Delete passkey (prevent deletion of last passkey)
```

### 5. CLI Testing Details

Specify how CLI output should be validated:

- Expected exit codes (0 for success, non-zero for errors)
- Output parsing strategy (JSON output? grep for keywords?)
- Error message validation

**Suggested addition:**
```
* CLI testing approach:
  * Verify exit codes for success (0) and error cases (non-zero)
  * Capture and validate stdout/stderr output
  * Test with missing/invalid configuration
  * Test with expired/invalid JWT tokens
```

### 6. Error and Edge Cases

Consider requiring tests for error scenarios:

- Server unavailable during CLI operations
- Invalid/expired JWT tokens
- Concurrent session operations
- Invalid pairing codes
- Expired pairing codes
- Network disconnection during WebSocket updates

### 7. Dependencies and Prerequisites

Document required dependencies:

```
* Prerequisites:
  * Node.js (specify version, e.g., 18+)
  * Playwright (specify version)
  * tmux (required for session management)
  * Built devsesh binary
```

### 8. Test Execution and Reporting

Consider specifying:

- How to run individual test suites vs full suite
- Expected output format
- CI/CD integration requirements
- Whether tests can run in parallel

**Suggested addition:**
```
* Test execution:
  * Support running individual test files or full suite
  * Exit with non-zero code on any test failure
  * Output results in a CI-friendly format (e.g., JUnit XML)
```

### 9. Test Data and Fixtures

Specify how test data should be managed:

- Pre-defined test user email
- Session names for tests
- Cleanup strategy

### 10. Missing Server Command

The requirements mention `devsesh server` but don't explicitly require testing:

- `devsesh migrate` - database migration command

**Suggested addition:**
```
* Server commands to test:
  * devsesh server - starts server correctly
  * devsesh migrate - runs database migrations
```

## Questions to Clarify

1. Should tests be idempotent (can run multiple times without cleanup)?
2. Is there a preference for test framework (Playwright Test, Jest, etc.)?
3. Should tests cover mobile responsive behavior?
4. Are there performance requirements (e.g., session list should load in under 2s)?
5. Should SSH functionality be tested, or is that out of scope?
