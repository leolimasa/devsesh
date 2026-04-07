# Integration Tests Implementation Checklist

## Phase 1: Project Setup and Infrastructure [req.pmu63v] [req.840wbb]

- [ ] Verify `flake.nix` has all required dependencies (nodejs, chromium, playwright, xvfb) [req.840wbb]
- [ ] Create `integration_tests/` directory
- [ ] Create `integration_tests/package.json` with Playwright and TypeScript dependencies [req.pmu63v]
- [ ] Create `integration_tests/tsconfig.json` for TypeScript configuration
- [ ] Create `integration_tests/playwright.config.ts` with test runner settings [req.pmu63v]
- [ ] **Test Phase 1:** Run `cd integration_tests && npm install` to verify dependencies install correctly

## Phase 2: Server Helper Utility [req.v4jfhx] [req.ysdxv4] [req.aef5gm] [req.ukgow2] [req.74e81k] [req.pgme3l]

- [ ] Create `integration_tests/helpers/server.ts`
- [ ] Implement `startServer()` function [req.v4jfhx] [req.pgme3l]
  - [ ] Create temporary database file [req.aef5gm]
  - [ ] Find available port
  - [ ] Set environment variables (DEVSESH_DB_PATH, DEVSESH_PORT, etc.)
  - [ ] Spawn devsesh server process
  - [ ] Wait for server readiness
- [ ] Implement `stopServer()` function [req.74e81k]
  - [ ] Send SIGTERM to server process
  - [ ] Delete temporary database file [req.aef5gm]
  - [ ] Clean up session files from ~/.devsesh/sessions/ [req.74e81k]
- [ ] Implement `waitForServer()` function with polling and timeout
- [ ] **Test Phase 2:** Create a minimal test that starts and stops the server, verify it works

## Phase 3: WebAuthn Helper [req.ddmaai]

- [ ] Create `integration_tests/helpers/webauthn.ts`
- [ ] Implement `setupVirtualAuthenticator()` function [req.ddmaai]
  - [ ] Create CDP session
  - [ ] Enable WebAuthn emulation
  - [ ] Add virtual authenticator with resident key support
  - [ ] Return CDP session and authenticator ID
- [ ] **Test Phase 3:** Create a minimal test that sets up virtual authenticator, verify no errors

## Phase 4: Registration Test [req.u2rh0f] [req.bsqvjs] [req.og61px] [req.a38eez] [req.9zv9zk]

- [ ] Create `integration_tests/tests/auth/` directory [req.og61px]
- [ ] Create `integration_tests/tests/auth/register.spec.ts` [req.u2rh0f]
- [ ] Implement `test('user can register with webauthn passkey')` [req.bsqvjs] [req.a38eez]
  - [ ] Start fresh server instance [req.ukgow2]
  - [ ] Set up virtual WebAuthn authenticator
  - [ ] Navigate to registration page
  - [ ] Enter email address
  - [ ] Trigger WebAuthn registration ceremony
  - [ ] Verify successful registration and redirect to dashboard
  - [ ] Stop server and clean up
- [ ] **Test Phase 4:** Run `npx playwright test tests/auth/register.spec.ts` and verify it passes

## Phase 5: Login Test [req.og61px] [req.a38eez] [req.9zv9zk]

- [ ] Create `integration_tests/tests/auth/login.spec.ts`
- [ ] Implement `test('registered user can login with webauthn passkey')` [req.a38eez]
  - [ ] Start fresh server instance [req.ukgow2]
  - [ ] Set up virtual WebAuthn authenticator
  - [ ] Register a user first (via web UI)
  - [ ] Log out (clear localStorage)
  - [ ] Navigate to login page
  - [ ] Enter email address
  - [ ] Complete WebAuthn login ceremony
  - [ ] Verify successful login and redirect to dashboard
  - [ ] Stop server and clean up
- [ ] **Test Phase 5:** Run `npx playwright test tests/auth/login.spec.ts` and verify it passes

## Phase 6: Integration Script [req.gd4jig] [req.pf3q47]

- [ ] Create `integration_tests/integration_tests.sh` [req.gd4jig]
  - [ ] Add shebang and set -e for error handling
  - [ ] Verify required tools are available (node, npx, go) [req.pf3q47]
  - [ ] Install npm dependencies
  - [ ] Build Go binary
  - [ ] Run Playwright tests
  - [ ] Exit with test result code
- [ ] Make script executable (`chmod +x`)
- [ ] **Test Phase 6:** Run `nix develop` then `./integration_tests/integration_tests.sh` and verify all tests pass [req.k1384u]

## Phase 7: Final Verification [req.k1384u]

- [ ] Run all integration tests and fix any failures [req.k1384u]
- [ ] Verify fresh server instance per test [req.ukgow2]
- [ ] Verify temporary database cleanup [req.aef5gm]
- [ ] Verify session file cleanup [req.74e81k]
- [ ] **Test Phase 7:** Run full test suite multiple times to ensure reliability [req.k1384u]
