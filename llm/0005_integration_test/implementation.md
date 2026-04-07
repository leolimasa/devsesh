# Implementation: Integration Tests for Devsesh

This document describes how to implement integration tests for the devsesh project, starting with the user registration flow using Playwright and WebAuthn emulation.

## Data Structures

No new data structures are needed. Integration tests will interact with existing database tables and API responses.

---

## Files and Functions

### 1. `integration_tests/integration_tests.sh` (create) [req.gd4jig] [req.pf3q47]

Main entry point script that runs all integration tests.

**Purpose:** Execute Playwright tests (assumes nix flake environment is already active).

**Precondition:** User must enter `nix develop` before running this script.

**Implementation:**
- Verify required tools are available (node, npx, go)
- Install npm dependencies in `integration_tests/` directory
- Build the Go binary (`go build`)
- Execute `npx playwright test` with appropriate configuration
- Exit with the test result code

---

### 2. `integration_tests/package.json` (create) [req.pmu63v]

Node.js package configuration for Playwright tests.

**Purpose:** Define test dependencies and scripts.

**Implementation:**
- Include `@playwright/test` as dev dependency
- Include TypeScript and related tooling
- Define test script

---

### 3. `integration_tests/tsconfig.json` (create)

TypeScript configuration for test files.

**Purpose:** Configure TypeScript for Playwright tests.

**Implementation:**
- Target ESNext modules
- Enable strict mode

---

### 4. `integration_tests/playwright.config.ts` (create) [req.pmu63v]

Playwright test configuration.

**Purpose:** Configure Playwright test runner with appropriate settings for devsesh testing.

**Implementation:**
- Set timeout values appropriate for server startup
- Configure browser settings (Chromium with WebAuthn support)
- Set up test output directories
- Disable parallel execution (each test needs its own server)

---

### 5. `integration_tests/helpers/server.ts` (create) [req.v4jfhx] [req.ysdxv4] [req.aef5gm] [req.ukgow2] [req.74e81k] [req.pgme3l]

Server management utility for tests.

**Purpose:** Start and stop the Go server for each test, with clean database state. This is a reusable utility for future tests.

**Functions:**

#### `startServer(options?: ServerOptions): Promise<ServerInstance>`
Start a fresh devsesh server instance with a temporary database.
- Create a unique temporary database file (blank database)
- Find an available port
- Set environment variables: `DEVSESH_DB_PATH`, `DEVSESH_PORT`, `DEVSESH_HOST`, `DEVSESH_RP_ID`, `DEVSESH_RP_ORIGIN`, `DEVSESH_ALLOW_USER_CREATION=true`
- Spawn `devsesh server` as a child process
- Wait for server to be ready by polling the health endpoint
- Return server instance with URL, port, process handle, and database path

#### `stopServer(instance: ServerInstance): Promise<void>`
Stop the server and clean up resources.
- Send SIGTERM to the server process
- Wait for graceful shutdown
- Delete the temporary database file
- Clean up session files from `~/.devsesh/sessions/`

#### `waitForServer(url: string, timeout?: number): Promise<void>`
Wait for server to be ready to accept requests.
- Poll `/api/v1/auth/status` endpoint
- Retry with exponential backoff
- Throw error if timeout exceeded

---

### 6. `integration_tests/helpers/webauthn.ts` (create) [req.ddmaai]

WebAuthn emulation helpers for Playwright.

**Purpose:** Configure Playwright's virtual authenticator for WebAuthn testing.

**Functions:**

#### `setupVirtualAuthenticator(page: Page): Promise<{ cdpSession: CDPSession, authenticatorId: string }>`
Set up a virtual WebAuthn authenticator for the browser context.
- Create CDP session to the page
- Enable WebAuthn emulation via CDP
- Add virtual authenticator with internal transport and resident key support
- Return CDP session and authenticator ID for later use

---

### 7. `integration_tests/tests/auth/register.spec.ts` (create) [req.u2rh0f] [req.bsqvjs] [req.og61px] [req.a38eez] [req.9zv9zk]

Tests for user registration flow.

**Test Cases:**

#### `test('user can register with webauthn passkey')`
Test the complete registration flow with descriptive name indicating the scenario.
- Start fresh server instance
- Set up virtual WebAuthn authenticator
- Navigate to registration page
- Enter email address
- Trigger WebAuthn registration ceremony (virtual authenticator handles it automatically)
- Verify successful registration and redirect to dashboard
- Stop server and clean up

---

### 8. `integration_tests/tests/auth/login.spec.ts` (create) [req.og61px] [req.a38eez] [req.9zv9zk]

Tests for user login flow.

**Test Cases:**

#### `test('registered user can login with webauthn passkey')`
Test login after registration with descriptive name indicating the scenario.
- Start fresh server instance
- Set up virtual WebAuthn authenticator
- Register a user first (via web UI)
- Log out (clear localStorage)
- Navigate to login page
- Enter email address
- Complete WebAuthn login ceremony (virtual authenticator handles it automatically)
- Verify successful login and redirect to dashboard
- Stop server and clean up

---

### 9. `flake.nix` (verify/modify if needed) [req.840wbb]

Verify dependencies for integration testing are present.

**Current state:** Already includes `nodejs_22`, `chromium`, `playwright`, `xvfb`, and `tmux`.

**Modifications:** None expected - dependencies are already present.

---

## Test Organization [req.9zv9zk] [req.og61px]

```
integration_tests/
├── integration_tests.sh          # Main entry point
├── package.json                  # Node dependencies
├── tsconfig.json                 # TypeScript config
├── playwright.config.ts          # Playwright config
├── helpers/
│   ├── server.ts                 # Server management (reusable)
│   └── webauthn.ts               # WebAuthn emulation
└── tests/
    └── auth/                     # Auth feature tests
        ├── register.spec.ts      # User registration test
        └── login.spec.ts         # User login test
```

---

## Environment Variables for Tests

| Variable | Purpose |
|----------|---------|
| `DEVSESH_DB_PATH` | Temporary SQLite database path |
| `DEVSESH_PORT` | Dynamic port for test server |
| `DEVSESH_HOST` | Localhost binding |
| `DEVSESH_RP_ID` | WebAuthn Relying Party ID (localhost) |
| `DEVSESH_RP_ORIGIN` | WebAuthn origin (http://localhost:PORT) |
| `DEVSESH_ALLOW_USER_CREATION` | Enable public registration for tests |

---

## Execution Flow [req.k1384u]

1. User enters nix shell via `nix develop` (prerequisite)
2. User runs `./integration_tests/integration_tests.sh`
3. Script verifies required tools are available
4. Script installs npm dependencies
5. Script builds the Go binary (`go build`)
6. Script runs `npx playwright test`
7. Playwright runs tests sequentially
8. Each test:
   - Starts fresh server instance with blank database [req.ukgow2] [req.aef5gm]
   - Sets up virtual WebAuthn authenticator
   - Runs test assertions (registration or login flow)
   - Cleans up server and database
9. Returns exit code based on test results
