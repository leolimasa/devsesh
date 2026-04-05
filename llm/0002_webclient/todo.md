# Web Client Implementation Todo

## Project Status

- 🟢 Phase 1: Documentation and Build Infrastructure - COMMITTED
- 🟢 Phase 2: Server Modifications - New Endpoints - COMMITTED
- 🟢 Phase 3: Web Client Project Setup - COMMITTED
- 🟢 Phase 4: Web Client Core Infrastructure - COMMITTED
- 🟢 Phase 5: Authentication Pages - COMMITTED
- 🟢 Phase 6: Pairing Page - COMMITTED
- 🟢 Phase 7: Dashboard Page - COMMITTED
- 🟢 Phase 8: Session Details Page - COMMITTED
- 🟢 Phase 9: Passkey Management Page - COMMITTED
- 🟢 Phase 10: Final Integration and Testing - COMMITTED

## Phase 1: Documentation and Build Infrastructure

- [x] Create `docs/SERVER_ENDPOINTS.md` documenting all existing API endpoints [req.8to10r]
- [x] Update `flake.nix` to add nodejs and npm to buildInputs [req.s5z3zk]
- [x] Create `build.sh` script in project root [req.w6ipyf]
- [x] **Test:** Run `nix develop` to verify flake changes work

## Phase 2: Server Modifications - New Endpoints

- [x] Add `GetSessionByID` handler in `internal/sessions/handler.go` for single session fetch [req.gb3lku]
- [x] Add `DeleteStaleSessions` function in `internal/db/queries.go` [req.9s0lei]
- [x] Add `DeleteStaleHandler` in `internal/sessions/handler.go` [req.9s0lei]
- [x] Add `AuthStatusHandler` in `internal/auth/webauthn.go` to check if users exist [req.vgcps0]
- [x] Add `DeleteCredential` function in `internal/db/queries.go` [req.67jse7]
- [x] Add `ListPasskeysHandler` in `internal/auth/webauthn.go` [req.aqvd4y]
- [x] Add `AddPasskeyBeginHandler` in `internal/auth/webauthn.go` [req.aqvd4y]
- [x] Add `AddPasskeyFinishHandler` in `internal/auth/webauthn.go` [req.aqvd4y]
- [x] Add `DeletePasskeyHandler` in `internal/auth/webauthn.go` [req.67jse7]
- [x] Register all new routes in `internal/server/server.go`
- [x] **Test:** Run `go test ./...` to verify server changes

## Phase 3: Web Client Project Setup

- [x] Remove existing `web/index.html` stub [req.igf5xs]
- [x] Initialize Vite + React + TypeScript project in `web/` [req.54k42f]
- [x] Configure Tailwind CSS with dark mode default [req.9k224a]
- [x] Install and configure shadcn/ui [req.damwg0]
- [x] Install @simplewebauthn/browser package
- [x] Install react-router-dom for routing
- [x] Create `web/src/types/api.ts` with TypeScript interfaces
- [x] Update `web/embed.go` to embed `dist/` folder [req.vdh4rk]
- [x] Update `internal/server/server.go` to serve SPA with fallback routing [req.vdh4rk]
- [x] **Test:** Run `cd web && npm run build` and verify build output

## Phase 4: Web Client Core Infrastructure

- [x] Create `web/src/lib/api.ts` with fetchApi wrapper [req.ygs9k9]
- [x] Add `checkUsersExist` API function [req.vgcps0]
- [x] Add `loginBegin` API function [req.ybw3lj]
- [x] Add `loginFinish` API function [req.5tsv4p]
- [x] Add `registerBegin` API function [req.xmzin4]
- [x] Add `registerFinish` API function [req.zgkk62]
- [x] Add `pairExchange` API function [req.29evhg]
- [x] Add `listSessions` API function [req.f8zgi8]
- [x] Add `getSession` API function [req.gb3lku]
- [x] Add `deleteStaleSessions` API function [req.9s0lei]
- [x] Add passkey management API functions (`listPasskeys`, `addPasskeyBegin`, `addPasskeyFinish`, `deletePasskey`) [req.aqvd4y] [req.67jse7]
- [x] Create `web/src/contexts/AuthContext.tsx` [req.8udwqf]
- [x] Create `web/src/hooks/useSessionUpdates.ts` for WebSocket [req.4lceak]
- [x] Create `web/src/App.tsx` with React Router setup [req.54k42f]
- [x] **Test:** Run `cd web && npm run build` to verify no TypeScript errors

## Phase 5: Authentication Pages

- [x] Install required shadcn/ui components (Button, Input, Card, Form)
- [x] Create `web/src/pages/LoginPage.tsx` [req.8udwqf] [req.ybw3lj] [req.5tsv4p]
  - [x] Email input field [req.ybw3lj]
  - [x] Passkey authentication button [req.5tsv4p]
  - [x] Link to registration when no users exist [req.vgcps0]
  - [x] Error handling display
- [x] Create `web/src/pages/RegisterPage.tsx` [req.vqmg93] [req.xmzin4] [req.zgkk62]
  - [x] Email input field [req.xmzin4]
  - [x] Passkey registration button [req.zgkk62]
  - [x] Redirect to login on success
- [x] Ensure responsive layout for mobile [req.9dmqy9]
- [x] **Test:** Build and manually test login/register flow with running server

## Phase 6: Pairing Page

- [x] Create `web/src/pages/PairPage.tsx` [req.29evhg] [req.xm73nc]
  - [x] Pairing code input field [req.29evhg]
  - [x] Pair button with loading state
  - [x] Success/error message display
  - [x] Auto-grant access to CLI on success [req.xm73nc]
- [x] Ensure responsive layout for mobile [req.9dmqy9]
- [x] **Test:** Build and manually test pairing flow with CLI `devsesh login`

## Phase 7: Dashboard Page

- [x] Install required shadcn/ui components (Table, Badge)
- [x] Create `web/src/pages/DashboardPage.tsx` [req.f8zgi8] [req.xizyqy]
  - [x] Session table with columns:
    - [x] Session ID (truncated) [req.4eaaqa]
    - [x] Name
    - [x] Start time (formatted) [req.h2j29f]
    - [x] Last ping time (relative) [req.mnocgd]
    - [x] Status badge (active/inactive) [req.67f9op]
    - [x] Metadata preview [req.85nmq5]
  - [x] Implement 5-minute inactive threshold logic [req.kebcow]
  - [x] Clickable rows to navigate to session details [req.ncy560]
  - [x] "Remove Stale Sessions" button [req.9s0lei]
  - [x] Real-time updates via WebSocket hook [req.4lceak]
- [x] Protected route (requires authentication) [req.xizyqy]
- [x] Responsive: table becomes card list on mobile [req.9dmqy9]
- [x] **Test:** Build and manually test dashboard with multiple sessions

## Phase 8: Session Details Page

- [x] Create `web/src/pages/SessionDetailPage.tsx` [req.gb3lku] [req.h1hqvu]
  - [x] Display all session metadata [req.gb3lku]
  - [x] Parse and format JSON metadata nicely
  - [x] Real-time updates via WebSocket [req.gb3lku]
  - [x] Placeholder div for future terminal [req.h1hqvu]
  - [x] Back navigation to dashboard
- [x] Ensure responsive layout for mobile [req.9dmqy9]
- [x] **Test:** Build and manually test session detail view with metadata updates

## Phase 9: Passkey Management Page

- [x] Install required shadcn/ui components (Dialog, Alert)
- [x] Create `web/src/pages/PasskeyManagementPage.tsx` [req.aqvd4y] [req.67jse7] [req.jzlryq]
  - [x] List current passkeys with creation date [req.aqvd4y]
  - [x] "Add Passkey" button [req.aqvd4y]
  - [x] Delete button per passkey (disabled if only one) [req.67jse7]
  - [x] Confirmation dialog before deletion
- [x] Protected route (requires authentication) [req.jzlryq]
- [x] Ensure responsive layout for mobile [req.9dmqy9]
- [x] **Test:** Build and manually test adding/removing passkeys

## Phase 10: Final Integration and Testing

- [x] Run `./build.sh` to build complete binary [req.w6ipyf]
- [x] Start server with `./devsesh server`
- [x] **Test:** Complete end-to-end flow:
  - [x] Register new user with passkey
  - [x] Login with passkey
  - [x] Start a session via CLI
  - [x] View session in dashboard
  - [x] View session details
  - [x] Verify real-time updates
  - [x] Pair a CLI device
  - [x] Add additional passkey
  - [x] Remove stale sessions
- [x] Test responsive design on mobile viewport [req.9dmqy9]
- [x] Verify dark mode styling [req.9k224a]
- [x] Add frontend unit tests with vitest + testing-library
- [x] All frontend tests pass (62 tests)
