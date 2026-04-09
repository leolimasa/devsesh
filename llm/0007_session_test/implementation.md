# Implementation Plan: Session Integration Tests

## Overview

This implementation adds integration tests for the session lifecycle: starting a session from the CLI and verifying it appears on the web dashboard, as well as testing metadata updates via YAML file changes and the `devsesh set` command. [req.ds5mfa]

## Data Structures

No new data structures need to be created. The tests will use existing interfaces:

- `ServerInstance` from `helpers/server.ts` - server process management
- `DevseshProcess` from `helpers/binary.ts` - CLI process management
- `Session` type from the web frontend - session data model

## Files to Create

### `integration_tests/helpers/session.ts` [req.0m7z0e]

Helper functions for session management in tests.

#### `spawnDevseshStart(sessionName: string, configPath: string, sessionDir: string): DevseshProcess`

Spawns `devsesh start [name]` command with the appropriate environment variables. [req.ti1lex]

- Uses `spawnDevsesh` from `binary.ts` with args `['start', sessionName]`
- Sets `DEVSESH_CONFIG_FILE` to the test config path
- Sets `DEVSESH_SESSION_DIR` to the test session directory
- Returns the process handle for monitoring

#### `waitForSessionInApi(serverUrl: string, token: string, sessionName: string, timeout?: number): Promise<Session>`

Polls the sessions API until a session with the given name appears. [req.imzvod]

- Calls `GET /api/v1/sessions` with JWT authorization header
- Filters results to find session matching the name
- Returns the session object when found
- Throws after timeout if not found

#### `getSessionFromApi(serverUrl: string, token: string, sessionId: string): Promise<Session>`

Fetches a specific session by ID from the API. [req.0mkke9] [req.s0i314]

- Calls `GET /api/v1/sessions/{session_id}` with JWT authorization
- Returns the session object including metadata

#### `updateSessionYamlFile(sessionDir: string, sessionId: string, key: string, value: string): void`

Directly modifies the session YAML file to test file-watching behavior. [req.0mkke9]

- Reads the session YAML file from `{sessionDir}/{sessionId}.yml`
- Parses YAML, updates the specified key in the `extra` section
- Writes the modified YAML back to the file

#### `sendTmuxCommand(sessionId: string, command: string): Promise<void>`

Sends a command to the tmux session. [req.4jgf79]

- Executes `tmux send-keys -t {sessionId} '{command}' Enter`
- Used to run `devsesh set` inside an active session

#### `killTmuxSession(sessionId: string): Promise<void>`

Terminates a tmux session for cleanup. [req.4jgf79]

- Executes `tmux kill-session -t {sessionId}`
- Used in test cleanup to ensure sessions are terminated

#### `findSessionFile(sessionDir: string): Promise<string | null>`

Finds the session YAML file in the session directory.

- Lists files in sessionDir matching `*.yml`
- Returns the first match or null if none found
- Used to get the session ID from the file system

### `integration_tests/tests/session.spec.ts` [req.ds5mfa]

Main test file for session integration tests.

#### Test: "Session appears on dashboard after CLI start" [req.ds5mfa] [req.s62387] [req.ti1lex] [req.imzvod]

End-to-end test for basic session creation flow.

1. Start server with `startServer()`
2. Register user and pair CLI using existing helpers (reuse pairing.spec.ts pattern)
3. Navigate to dashboard page
4. Spawn `devsesh start test-session` in background
5. Wait for session to appear in the sessions table via API polling
6. Assert session name matches "test-session"
7. Assert session shows "Active" status on dashboard
8. Clean up: kill tmux session, stop server

#### Test: "Editing session YAML updates metadata on web" [req.a9tvq7] [req.0mkke9]

Tests that file watcher syncs YAML changes to the server.

1. Start server, register user, pair CLI
2. Start a session with `devsesh start`
3. Wait for session to appear in API
4. Modify the session YAML file directly (add `extra.custom_key: custom_value`)
5. Wait briefly for file watcher to sync (poll API for updated metadata)
6. Assert the session metadata in API contains the new key-value pair
7. Clean up

#### Test: "devsesh set updates metadata on web" [req.a9tvq7] [req.s0i314]

Tests the `devsesh set` CLI command updates metadata.

1. Start server, register user, pair CLI
2. Start a session with `devsesh start`
3. Wait for session to appear in API
4. Send `devsesh set mykey myvalue` command to tmux session
5. Wait briefly for metadata sync
6. Assert the session metadata in API contains `mykey: myvalue`
7. Clean up

### `integration_tests/helpers/pairing.ts` (modify) [req.0m7z0e]

#### `setupPairedCli(page: Page, serverUrl: string, email: string, configPath: string): Promise<string>`

Convenience function that combines registration, login, and CLI pairing into one call. Returns the JWT token.

- Calls `setupVirtualAuthenticator(page)`
- Calls `registerUser(page, serverUrl, email)`
- Performs login flow to get JWT token
- Spawns `devsesh login`, enters pairing code in web UI
- Waits for CLI to complete
- Returns the JWT token for API calls

## Test Flow Diagram

```
[Start Server]
    │
    ▼
[Register User + Pair CLI] ─── uses existing helpers
    │
    ▼
[Spawn devsesh start] ─── creates tmux session + notifies server
    │
    ▼
[Poll API / Check Dashboard] ─── verify session appears
    │
    ▼
[Modify YAML / Run devsesh set] ─── trigger metadata updates
    │
    ▼
[Verify metadata in API] ─── confirm sync worked
    │
    ▼
[Cleanup: kill tmux, stop server]
```

## Implementation Notes

- All tests run within the nix development shell (`flake.nix`) to ensure tmux is available [req.lyk33x]
- Tests use isolated temp directories for session files to avoid conflicts
- The `devsesh start` command is blocking, so it must run in a spawned process
- File watcher has a 500ms debounce, so metadata sync tests should wait ~1s before checking
- Tmux session ID equals the session UUID, making it easy to send commands [req.4jgf79]
- Use existing patterns from `pairing.spec.ts` for server/user setup [req.9n4hfi]

## Bug Fixes [req.r1eun4]

No bugs anticipated for initial implementation. If tests reveal issues with:
- Session file watching not triggering updates
- Metadata not being serialized correctly
- WebSocket updates not reaching the dashboard

These will be addressed as discovered during test implementation.
