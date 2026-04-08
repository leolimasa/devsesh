# TODO: Pairing Integration Test

## Project Status

- 🟢 Phase 1: Create CLI Helper Module
- 🟢 Phase 2: Create Auth Helper Module
- 🟢 Phase 3: Create Pairing Helper Module
- 🟢 Phase 4: Create Pairing Integration Test
- 🟢 Phase 5: Bug Fixes and Validation

## Phase 1: Create CLI Helper Module

- [x] Create `integration_tests/helpers/cli.ts` [req.8k6iv7]
  - [x] Define `CliProcess` interface with `process`, `stdout`, and `exitPromise` fields
  - [x] Implement `spawnDevseshLogin(serverUrl: string, configPath: string): CliProcess` to spawn the CLI login command
  - [x] Implement `extractPairingCode(output: string): string | null` to parse pairing code from output [req.zy2aio]
  - [x] Implement `waitForCliSuccess(cliProcess: CliProcess, timeout: number): Promise<void>` [req.itzuip]
- [x] Test Phase 1: Manually verify CLI helper compiles by running `npx tsc --noEmit` in `integration_tests/`

## Phase 2: Create Auth Helper Module

- [x] Create `integration_tests/helpers/auth.ts` [req.bd6pjg]
  - [x] Implement `registerUser(page: Page, serverUrl: string, email: string): Promise<string>` to register via WebAuthn and return JWT
  - [x] Implement `loginUser(page: Page, serverUrl: string, email: string): Promise<string>` to login and return JWT
- [x] Test Phase 2: Manually verify auth helper compiles by running `npx tsc --noEmit` in `integration_tests/`

## Phase 3: Create Pairing Helper Module

- [x] Create `integration_tests/helpers/pairing.ts` [req.zy2aio]
  - [x] Implement `enterPairingCode(page: Page, serverUrl: string, code: string): Promise<void>` to enter code in web UI
- [x] Modify `integration_tests/helpers/server.ts` [req.4afsee]
  - [x] Add `cleanupTestConfig(configPath: string): void` function [req.itzuip]
- [x] Test Phase 3: Manually verify helpers compile by running `npx tsc --noEmit` in `integration_tests/`

## Phase 4: Create Pairing Integration Test

- [x] Create `integration_tests/tests/pairing.spec.ts` [req.djbmrd]
  - [x] Import all required helpers (server, webauthn, auth, cli, pairing)
  - [x] Implement test `'CLI pairing flow works end-to-end'`:
    - [x] Start server using `startServer()` [req.bd6pjg]
    - [x] Setup virtual authenticator using `setupVirtualAuthenticator()`
    - [x] Register user via `registerUser()` [req.bd6pjg]
    - [x] Spawn `devsesh login` using `spawnDevseshLogin()` [req.8k6iv7]
    - [x] Wait for and extract pairing code using `extractPairingCode()` [req.zy2aio]
    - [x] Enter pairing code via `enterPairingCode()` [req.zy2aio]
    - [x] Wait for CLI success using `waitForCliSuccess()` [req.itzuip]
    - [x] Verify config file exists with valid JWT [req.itzuip]
    - [x] Clean up (stop server, remove test config)
- [x] Test Phase 4: Run `integration_tests/integration_tests.sh` and verify pairing test passes

## Phase 5: Bug Fixes and Validation

- [x] Run full integration test suite [req.s648jn]
- [x] Fix any bugs discovered in server or frontend [req.s648jn]
- [x] Verify all existing tests still pass
- [x] Test Phase 5: Run `integration_tests/integration_tests.sh` and confirm all tests pass

## Reference Documentation Used

- [req.nq61vy] README.md - project scope and CLI commands
- [req.3ymrap] doc/ARCHITECTURE.md - pairing flow details
- [req.5h39ar] integration_tests/tests/ - existing test patterns
- [req.4afsee] integration_tests/helpers/ - server and webauthn utilities
