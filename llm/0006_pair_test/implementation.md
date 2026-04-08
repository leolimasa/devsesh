# Implementation Plan: Pairing Integration Test

## Overview

Create a Playwright integration test that verifies the end-to-end CLI pairing flow. The test will start a server, register a user via WebAuthn, run the `devsesh login` command, capture the pairing code, enter it in the web interface, and verify successful authentication with a saved JWT file.

## Data Structures

No new data structures need to be created. The test will use existing interfaces:

- `ServerInstance` from `integration_tests/helpers/server.ts` - manages server lifecycle
- `VirtualAuthenticatorResult` from `integration_tests/helpers/webauthn.ts` - WebAuthn setup

## Files to Create/Modify

### `integration_tests/tests/pairing.spec.ts` (CREATE)

New test file containing the pairing integration test. [req.djbmrd]

#### `test('CLI pairing flow works end-to-end')`

Test function that orchestrates the full pairing flow. [req.djbmrd]

**Implementation:**

1. Start the server using `startServer()` helper [req.bd6pjg]
2. Create a virtual authenticator using `setupVirtualAuthenticator()`
3. Navigate to the web UI and register a new user with email and passkey [req.bd6pjg]
4. Store the JWT token from localStorage for later use
5. Spawn `devsesh login http://localhost:<port>` as a child process [req.8k6iv7]
6. Capture stdout and parse the pairing code from output (format: "Pairing code: XXXXXX") [req.zy2aio]
7. Navigate to the pairing page (`/pair`) in the browser
8. Enter the pairing code in the pairing form and submit [req.zy2aio]
9. Wait for the CLI process to complete successfully [req.itzuip]
10. Verify the config file was created with a valid JWT token [req.itzuip]
11. Clean up: stop server, remove test config file

### `integration_tests/helpers/auth.ts` (CREATE)

New helper module for authentication-related test utilities.

#### `registerUser(page: Page, email: string): Promise<string>`

Register a new user via the web interface and return the JWT token. [req.bd6pjg]

**Implementation:**

1. Navigate to the registration page (or root if no users exist)
2. Fill in the email field
3. Click register button to trigger WebAuthn flow
4. The virtual authenticator will auto-respond to the WebAuthn challenge
5. Wait for successful registration redirect
6. Extract and return JWT token from localStorage

#### `loginUser(page: Page, email: string): Promise<string>`

Login an existing user and return the JWT token.

**Implementation:**

1. Navigate to the login page
2. Fill in the email field
3. Click login button to trigger WebAuthn flow
4. Wait for successful login
5. Extract and return JWT token from localStorage

### `integration_tests/helpers/cli.ts` (CREATE)

New helper module for CLI interaction in tests.

#### `interface CliProcess`

```typescript
interface CliProcess {
  process: ChildProcess;
  stdout: string;
  exitPromise: Promise<number>;
}
```

#### `spawnDevseshLogin(serverUrl: string, configPath: string): CliProcess`

Spawn the devsesh login command and capture output. [req.8k6iv7]

**Implementation:**

1. Spawn `devsesh login <serverUrl>` with `DEVSESH_CONFIG_FILE` env var set to a temp path
2. Collect stdout into a buffer string
3. Return process handle, stdout buffer, and exit promise

#### `extractPairingCode(output: string): string | null`

Parse the pairing code from CLI output. [req.zy2aio]

**Implementation:**

1. Match regex pattern `/Pairing code:\s*([A-Z0-9]+)/i` against output
2. Return matched code or null if not found

#### `waitForCliSuccess(cliProcess: CliProcess, timeout: number): Promise<void>`

Wait for CLI to exit successfully. [req.itzuip]

**Implementation:**

1. Race the exit promise against a timeout
2. Assert exit code is 0
3. Throw error if timeout exceeded or non-zero exit

### `integration_tests/helpers/pairing.ts` (CREATE)

New helper module for pairing page interactions.

#### `enterPairingCode(page: Page, code: string): Promise<void>`

Enter a pairing code in the web interface. [req.zy2aio]

**Implementation:**

1. Navigate to `/pair` if not already there
2. Wait for the pairing code input field to be visible
3. Fill in the code
4. Click the submit/pair button
5. Wait for success confirmation (e.g., "Pairing successful" message or redirect)

### `integration_tests/helpers/server.ts` (MODIFY)

Add helper for cleanup of config files.

#### `cleanupTestConfig(configPath: string): void`

Remove test config file if it exists. [req.itzuip]

**Implementation:**

1. Check if file exists at configPath
2. Delete if exists

## Test Flow Diagram

```
1. startServer() → ServerInstance
2. setupVirtualAuthenticator() → authenticatorId
3. registerUser(page, "test@example.com") → jwtToken
4. spawnDevseshLogin(serverUrl, tempConfigPath) → CliProcess
5. Wait for stdout to contain pairing code
6. extractPairingCode(stdout) → code
7. enterPairingCode(page, code)
8. waitForCliSuccess(cliProcess)
9. Verify config file exists with JWT
10. Cleanup
```

## Environment Variables Used

The test will use:
- `DEVSESH_CONFIG_FILE` - Override config path to isolate test
- `CHROMIUM_PATH` - Existing env var for Playwright chromium

## Bug Fixes

Any bugs discovered during implementation will be documented and fixed. [req.s648jn] Potential areas:
- Timing issues in pairing flow
- UI element selectors if web interface differs from expectations
- CLI output format variations

## Reference Documentation

- [req.nq61vy] README.md documents overall project scope and CLI commands
- [req.3ymrap] doc/ARCHITECTURE.md describes pairing flow in detail (POST /api/v1/auth/pair/start, /pair/exchange, /pair/complete)
- [req.5h39ar] Existing tests in `integration_tests/tests/` demonstrate patterns
- [req.4afsee] Helpers in `integration_tests/helpers/` provide server, webauthn utilities
