# Integration Tests - Implementation Checklist

## Project Status

- 🟢 Phase 1: Project Setup and Infrastructure - IMPLEMENTED
- 🟢 Phase 2: Helper Modules - IMPLEMENTED
- 🟢 Phase 3: Test Fixtures - IMPLEMENTED
- 🟢 Phase 4: Authentication Tests - IMPLEMENTED
- 🟢 Phase 5: Session Tests - IMPLEMENTED
- 🟢 Phase 6: Device Pairing Tests - IMPLEMENTED
- 🟢 Phase 7: CLI Command Tests - IMPLEMENTED
- 🟢 Phase 8: Page Tests - IMPLEMENTED
- 🟢 Phase 9: Final Verification - IMPLEMENTED

## Phase 1: Project Setup and Infrastructure

- [x] Create `integration_tests/` directory structure [req.3ch3dq] [req.9zv9zk] [req.og61px]
- [x] Create `integration_tests/package.json` with Playwright dependencies [req.3ch3dq]
- [x] Create `integration_tests/playwright.config.ts` with test configuration [req.3ch3dq] [req.9zv9zk]
- [x] Create `integration_tests/tsconfig.json` for TypeScript support
- [x] Create `integration_tests.sh` entry point script [req.gd4jig] [req.o5gj47] [req.nih7aj]
- [x] **Test Phase 1:** Run `./integration_tests.sh` and verify it installs dependencies and Playwright browsers successfully

## Phase 2: Helper Modules

- [x] Create `integration_tests/helpers/server.ts` with `startServer()` and `stopServer()` functions [req.ysdxv4] [req.ukgow2] [req.aef5gm] [req.74e81k]
- [x] Create `integration_tests/helpers/cli.ts` with `runCli()` and `runCliAsync()` functions [req.yrg291] [req.cceh4b]
- [x] Create `integration_tests/helpers/webauthn.ts` with `setupVirtualAuthenticator()` and `removeVirtualAuthenticator()` functions [req.ddmaai]
- [x] **Test Phase 2:** Create a simple test that starts/stops server and verify temp database is created and cleaned up

## Phase 3: Test Fixtures

- [x] Create `integration_tests/fixtures/test-fixtures.ts` [req.3ch3dq]
- [x] Implement `serverFixture` - provides fresh server per test [req.ukgow2]
- [x] Implement `authenticatedPage` - provides page with registered/logged-in user
- [x] Implement `cliConfigFixture` - provides CLI config pointing to test server
- [x] **Test Phase 3:** Run `./integration_tests.sh` with a minimal test using fixtures to verify setup/teardown works

## Phase 4: Authentication Tests

- [x] Create `integration_tests/tests/auth/register.spec.ts` [req.ra9irr] [req.ofvba1] [req.azeczb] [req.og61px] [req.a38eez]
  - [x] Test: should show registration form when no users exist
  - [x] Test: should register new user with passkey
  - [x] Test: should reject duplicate email registration
- [x] Create `integration_tests/tests/auth/login.spec.ts` [req.ra9irr] [req.ofvba1] [req.azeczb]
  - [x] Test: should login with existing passkey
  - [x] Test: should show error for non-existent user
  - [x] Test: should redirect to login when users exist
- [x] **Test Phase 4:** Run `./integration_tests.sh tests/auth/` and verify all auth tests pass [req.k1384u]

## Phase 5: Session Tests

- [x] Create `integration_tests/tests/sessions/session-lifecycle.spec.ts` [req.ra9irr] [req.azeczb]
  - [x] Test: should display new session on dashboard when CLI starts session
  - [x] Test: should update session status in real-time via WebSocket
  - [x] Test: should show session ping updates
- [x] Create `integration_tests/tests/sessions/session-metadata.spec.ts` [req.ra9irr]
  - [x] Test: should update metadata via CLI set command
  - [x] Test: should sync metadata changes from session file
- [x] **Test Phase 5:** Run `./integration_tests.sh tests/sessions/` and verify all session tests pass [req.k1384u]

## Phase 6: Device Pairing Tests

- [x] Create `integration_tests/tests/pairing/device-pairing.spec.ts` [req.ra9irr] [req.azeczb]
  - [x] Test: should complete pairing flow between CLI and web
  - [x] Test: should reject expired pairing code
  - [x] Test: should reject invalid pairing code
- [x] **Test Phase 6:** Run `./integration_tests.sh tests/pairing/` and verify all pairing tests pass [req.k1384u]

## Phase 7: CLI Command Tests

- [x] Create `integration_tests/tests/cli/cli-commands.spec.ts` [req.yrg291] [req.cceh4b]
  - [x] Test: devsesh server starts and serves web UI
  - [x] Test: devsesh migrate runs without error
  - [x] Test: devsesh list shows sessions for current machine
  - [x] Test: devsesh attach attaches to existing session
  - [x] Test: devsesh resume resumes inactive session
  - [x] Test: devsesh delete removes session
  - [x] Test: devsesh logout clears credentials
- [x] Create `integration_tests/tests/cli/cli-session.spec.ts` [req.yrg291]
  - [x] Test: devsesh start creates tmux session
  - [x] Test: devsesh start with custom name
  - [x] Test: devsesh stop ends current session
- [x] **Test Phase 7:** Run `./integration_tests.sh tests/cli/` and verify all CLI tests pass [req.k1384u]

## Phase 8: Page Tests

- [x] Create `integration_tests/tests/pages/dashboard.spec.ts` [req.ofvba1] [req.azeczb]
  - [x] Test: should display list of all sessions
  - [x] Test: should show session status badges correctly
  - [x] Test: should navigate to session detail on row click
  - [x] Test: should allow deleting stale sessions
- [x] Create `integration_tests/tests/pages/session-detail.spec.ts` [req.ofvba1]
  - [x] Test: should display session details
  - [x] Test: should show real-time updates
- [x] Create `integration_tests/tests/pages/passkey-management.spec.ts` [req.ofvba1]
  - [x] Test: should list existing passkeys
  - [x] Test: should add new passkey
  - [x] Test: should delete passkey (when multiple exist)
  - [x] Test: should prevent deleting last passkey
- [x] **Test Phase 8:** Run `./integration_tests.sh tests/pages/` and verify all page tests pass [req.k1384u]

## Phase 9: Final Verification

- [x] Run full test suite: `./integration_tests.sh` [req.k1384u]
- [x] Fix any failing tests [req.k1384u]
- [x] Verify individual test execution works: `./integration_tests.sh tests/auth/register.spec.ts` [req.o5gj47]
- [x] Verify flake.nix has all required dependencies (should already be present) [req.vofp0j]
- [x] **Test Phase 9:** Run `./integration_tests.sh` from a clean state and confirm all tests pass [req.k1384u] [req.nih7aj]
