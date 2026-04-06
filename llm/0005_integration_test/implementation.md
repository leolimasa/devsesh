# Implementation Plan

This document describes the implementation for integration tests covering all devsesh functionality.

## Overview

The integration tests will use Playwright as the unified testing framework for both web UI and CLI tests. Tests will be organized by feature area and run against a fresh server instance with a temporary database per test.

## Files to Create

### integration_tests/ (new directory)

```
integration_tests/
├── package.json
├── playwright.config.ts
├── fixtures/
│   └── test-fixtures.ts
├── tests/
│   ├── auth/
│   │   ├── register.spec.ts
│   │   └── login.spec.ts
│   ├── sessions/
│   │   ├── session-lifecycle.spec.ts
│   │   └── session-metadata.spec.ts
│   ├── pairing/
│   │   └── device-pairing.spec.ts
│   ├── cli/
│   │   ├── cli-commands.spec.ts
│   │   └── cli-session.spec.ts
│   └── pages/
│       ├── dashboard.spec.ts
│       ├── session-detail.spec.ts
│       └── passkey-management.spec.ts
└── helpers/
    ├── server.ts
    ├── cli.ts
    └── webauthn.ts
```

### integration_tests.sh [req.gd4jig]

Entry point script that runs all integration tests.

**Implementation:**
- Change to the `integration_tests/` directory
- Run `npm install` if `node_modules` doesn't exist
- Install Playwright browsers if needed (`npx playwright install`)
- Execute `npx playwright test` with any passed arguments
- Support running individual tests via arguments (e.g., `./integration_tests.sh tests/auth/`) [req.o5gj47]
- Exit with the test runner's exit code

---

## Helpers (integration_tests/helpers/)

### server.ts [req.ysdxv4] [req.ukgow2]

Helper module for managing the devsesh server during tests.

**Functions to create:**

#### `startServer(options: ServerOptions): Promise<ServerInstance>`
Starts a fresh devsesh server instance for testing.
- Create a temporary directory for the database [req.aef5gm]
- Set environment variables: `DEVSESH_PORT` (random available port), `DEVSESH_HOST=localhost`, `DEVSESH_ALLOW_USER_CREATION=true`, database path
- Spawn the `devsesh server` process
- Wait for the server to be ready (poll `/api/v1/auth/status`)
- Return a `ServerInstance` object with `url`, `port`, `process`, and `cleanup` function

#### `stopServer(instance: ServerInstance): Promise<void>`
Stops the server and cleans up resources.
- Kill the server process
- Delete the temporary database file [req.aef5gm]
- Clean up session files from the temporary session directory [req.74e81k]

### cli.ts [req.yrg291] [req.cceh4b]

Helper module for executing CLI commands.

**Functions to create:**

#### `runCli(args: string[], options?: CliOptions): Promise<CliResult>`
Executes a devsesh CLI command and returns the result.
- Use Node.js `child_process.execSync` or `spawn`
- Set environment variables for config file and session directory to test-specific paths
- Capture stdout, stderr, and exit code
- Return `{ stdout, stderr, exitCode }`

#### `runCliAsync(args: string[], options?: CliOptions): ChildProcess`
Starts a CLI command that runs in the background (for `devsesh start`).
- Spawn the process without waiting
- Return the `ChildProcess` for later control

### webauthn.ts [req.ddmaai]

Helper module for WebAuthn emulation setup.

**Functions to create:**

#### `setupVirtualAuthenticator(context: BrowserContext): Promise<CDPSession>`
Configures Playwright's virtual authenticator for WebAuthn testing.
- Create a CDP session
- Call `WebAuthn.enable` and `WebAuthn.addVirtualAuthenticator`
- Configure authenticator with: `protocol: 'ctap2'`, `transport: 'internal'`, `hasUserVerification: true`, `isUserVerified: true`
- Return the CDP session for cleanup

#### `removeVirtualAuthenticator(cdp: CDPSession, authenticatorId: string): Promise<void>`
Removes the virtual authenticator after test completion.

---

## Test Fixtures (integration_tests/fixtures/)

### test-fixtures.ts [req.3ch3dq]

Playwright test fixtures for common setup/teardown.

**Fixtures to create:**

#### `serverFixture`
Provides a running server instance per test.
- Before each test: start server with `startServer()`
- After each test: stop server with `stopServer()`
- Expose `serverUrl` to tests

#### `authenticatedPage`
Provides a page with a registered and logged-in user.
- Start server
- Set up virtual authenticator
- Navigate to register page, complete registration
- Return page with authenticated session

#### `cliConfigFixture`
Provides CLI configuration pointing to test server.
- Create temporary config file with server URL and JWT token
- Set `DEVSESH_CONFIG_FILE` environment variable
- Clean up after test

---

## Test Files (integration_tests/tests/)

### auth/register.spec.ts [req.ra9irr] [req.ofvba1] [req.azeczb] [req.og61px] [req.a38eez]

Tests for user registration flow.

**Tests to create:**

#### `test('should show registration form when no users exist')`
- Start fresh server (no users)
- Navigate to `/`
- Verify redirect to `/register`
- Verify registration form is displayed

#### `test('should register new user with passkey')`
- Set up virtual authenticator
- Navigate to register page
- Enter email, click register
- Complete WebAuthn ceremony
- Verify redirect to dashboard
- Verify user is logged in

#### `test('should reject duplicate email registration')`
- Register first user
- Attempt to register with same email
- Verify error message displayed

### auth/login.spec.ts [req.ra9irr] [req.ofvba1] [req.azeczb]

Tests for user login flow.

**Tests to create:**

#### `test('should login with existing passkey')`
- Register a user first
- Log out (clear localStorage)
- Navigate to login page
- Enter email, complete WebAuthn
- Verify redirect to dashboard

#### `test('should show error for non-existent user')`
- Navigate to login page
- Enter non-existent email
- Verify error message

#### `test('should redirect to login when users exist')`
- Register a user
- Clear session
- Navigate to `/`
- Verify redirect to `/login` (not `/register`)

### sessions/session-lifecycle.spec.ts [req.ra9irr] [req.azeczb]

Tests for session creation, updates, and termination.

**Tests to create:**

#### `test('should display new session on dashboard when CLI starts session')`
- Set up authenticated user and CLI config
- Run `devsesh start test-session` via CLI helper
- Navigate to dashboard
- Verify session appears in list with correct name and hostname

#### `test('should update session status in real-time via WebSocket')`
- Start a session via CLI
- Open dashboard
- Verify initial session state
- Stop session via CLI (`devsesh stop`)
- Verify dashboard shows session as ended (without page refresh)

#### `test('should show session ping updates')`
- Start session via CLI
- Open dashboard
- Trigger activity in tmux session
- Verify `last_ping_at` updates on dashboard

### sessions/session-metadata.spec.ts [req.ra9irr]

Tests for session metadata functionality.

**Tests to create:**

#### `test('should update metadata via CLI set command')`
- Start session
- Run `devsesh set project my-project`
- Verify metadata appears on dashboard

#### `test('should sync metadata changes from session file')`
- Start session
- Directly edit the session YAML file
- Verify changes appear on dashboard via WebSocket

### pairing/device-pairing.spec.ts [req.ra9irr] [req.azeczb]

Tests for CLI-to-web pairing flow.

**Tests to create:**

#### `test('should complete pairing flow between CLI and web')`
- Register and login via web
- Run `devsesh login <server-url>` in background (captures pairing code from stdout)
- Navigate to pairing page in browser
- Enter the pairing code
- Verify CLI completes and config file contains token

#### `test('should reject expired pairing code')`
- Generate pairing code via CLI
- Wait for expiration (or mock time)
- Enter code in web
- Verify error message

#### `test('should reject invalid pairing code')`
- Login via web
- Navigate to pairing page
- Enter invalid code
- Verify error message

### cli/cli-commands.spec.ts [req.yrg291] [req.cceh4b]

Tests for all CLI commands.

**Tests to create:**

#### `test('devsesh server starts and serves web UI')`
- Start server via `startServer()`
- Fetch `/` via HTTP
- Verify HTML response (React app)

#### `test('devsesh migrate runs without error')`
- Run `devsesh migrate` with test database
- Verify exit code 0

#### `test('devsesh list shows sessions for current machine')`
- Start session
- Run `devsesh list`
- Verify output contains session name

#### `test('devsesh attach attaches to existing session')`
- Start session `test-session`
- Run `devsesh attach test-session` (in background)
- Verify tmux attachment (check process)

#### `test('devsesh resume resumes inactive session')`
- Start and stop a session
- Run `devsesh resume <session-name>`
- Verify session becomes active again

#### `test('devsesh delete removes session')`
- Start and stop a session
- Run `devsesh delete <session-name>`
- Verify session no longer in list

#### `test('devsesh logout clears credentials')`
- Login via pairing
- Run `devsesh logout`
- Verify config file no longer contains token

### cli/cli-session.spec.ts [req.yrg291]

Tests for CLI session management.

**Tests to create:**

#### `test('devsesh start creates tmux session')`
- Run `devsesh start my-session`
- Verify tmux session exists (`tmux has-session -t my-session`)

#### `test('devsesh start with custom name')`
- Run `devsesh start custom-name`
- Verify session created with that name

#### `test('devsesh stop ends current session')`
- Start session
- Run `devsesh stop`
- Verify session file marked as ended
- Verify server shows session as ended

### pages/dashboard.spec.ts [req.ofvba1] [req.azeczb]

Tests for the dashboard page.

**Tests to create:**

#### `test('should display list of all sessions')`
- Create multiple sessions via CLI
- Navigate to dashboard
- Verify all sessions displayed in table

#### `test('should show session status badges correctly')`
- Create active and ended sessions
- Verify status badges display correctly

#### `test('should navigate to session detail on row click')`
- Create a session
- Click on session row
- Verify navigation to `/sessions/<id>`

#### `test('should allow deleting stale sessions')`
- Create stale sessions (mock old ping times)
- Click delete stale button
- Verify sessions removed

### pages/session-detail.spec.ts [req.ofvba1]

Tests for the session detail page.

**Tests to create:**

#### `test('should display session details')`
- Create session with metadata
- Navigate to session detail page
- Verify name, hostname, metadata displayed

#### `test('should show real-time updates')`
- Open session detail page
- Update metadata via CLI
- Verify changes appear without refresh

### pages/passkey-management.spec.ts [req.ofvba1]

Tests for passkey management page.

**Tests to create:**

#### `test('should list existing passkeys')`
- Register user (creates first passkey)
- Navigate to passkey management
- Verify passkey listed

#### `test('should add new passkey')`
- Login
- Navigate to passkey management
- Click add passkey
- Complete WebAuthn ceremony
- Verify new passkey in list

#### `test('should delete passkey (when multiple exist)')`
- Add second passkey
- Delete first passkey
- Verify only one remains

#### `test('should prevent deleting last passkey')`
- With only one passkey
- Attempt delete
- Verify error or disabled button

---

## Configuration Files

### integration_tests/package.json [req.3ch3dq]

```json
{
  "name": "devsesh-integration-tests",
  "private": true,
  "scripts": {
    "test": "playwright test",
    "test:headed": "playwright test --headed"
  },
  "devDependencies": {
    "@playwright/test": "^1.40.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

### integration_tests/playwright.config.ts [req.3ch3dq] [req.9zv9zk]

Configure Playwright test runner.

**Configuration:**
- Set `testDir` to `./tests`
- Configure test timeout (60 seconds for tests involving server startup)
- Set `fullyParallel: false` (tests may share server resources)
- Configure reporter for CI output
- Set browser to Chromium (required for WebAuthn emulation)
- Configure `use.baseURL` dynamically from server fixture

---

## Modifications to Existing Files

### flake.nix [req.vofp0j]

No modifications needed - Playwright and Node.js are already included in the dev shell.

---

## Test Execution [req.nih7aj] [req.k1384u]

Tests are run inside the Nix flake environment:

```bash
# Enter flake environment
nix develop

# Run all tests
./integration_tests.sh

# Run specific test file
./integration_tests.sh tests/auth/register.spec.ts

# Run tests in headed mode (visible browser)
./integration_tests.sh --headed
```

The script will:
1. Build the devsesh binary if needed
2. Install npm dependencies
3. Install Playwright browsers
4. Run the test suite
5. Report results and exit with appropriate code
