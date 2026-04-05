# Web Client Implementation Todo

## Phase 1: Documentation and Build Infrastructure

- [ ] Create `docs/SERVER_ENDPOINTS.md` documenting all existing API endpoints [req.8to10r]
- [ ] Update `flake.nix` to add nodejs and npm to buildInputs [req.s5z3zk]
- [ ] Create `build.sh` script in project root [req.w6ipyf]
- [ ] **Test:** Run `nix develop` to verify flake changes work

## Phase 2: Server Modifications - New Endpoints

- [ ] Add `GetSessionByID` handler in `internal/sessions/handler.go` for single session fetch [req.gb3lku]
- [ ] Add `DeleteStaleSessions` function in `internal/db/queries.go` [req.9s0lei]
- [ ] Add `DeleteStaleHandler` in `internal/sessions/handler.go` [req.9s0lei]
- [ ] Add `AuthStatusHandler` in `internal/auth/webauthn.go` to check if users exist [req.vgcps0]
- [ ] Add `DeleteCredential` function in `internal/db/queries.go` [req.67jse7]
- [ ] Add `ListPasskeysHandler` in `internal/auth/webauthn.go` [req.aqvd4y]
- [ ] Add `AddPasskeyBeginHandler` in `internal/auth/webauthn.go` [req.aqvd4y]
- [ ] Add `AddPasskeyFinishHandler` in `internal/auth/webauthn.go` [req.aqvd4y]
- [ ] Add `DeletePasskeyHandler` in `internal/auth/webauthn.go` [req.67jse7]
- [ ] Register all new routes in `internal/server/server.go`
- [ ] **Test:** Run `go test ./...` to verify server changes

## Phase 3: Web Client Project Setup

- [ ] Remove existing `web/index.html` stub [req.igf5xs]
- [ ] Initialize Vite + React + TypeScript project in `web/` [req.54k42f]
- [ ] Configure Tailwind CSS with dark mode default [req.9k224a]
- [ ] Install and configure shadcn/ui [req.damwg0]
- [ ] Install @simplewebauthn/browser package
- [ ] Install react-router-dom for routing
- [ ] Create `web/src/types/api.ts` with TypeScript interfaces
- [ ] Update `web/embed.go` to embed `dist/` folder [req.vdh4rk]
- [ ] Update `internal/server/server.go` to serve SPA with fallback routing [req.vdh4rk]
- [ ] **Test:** Run `cd web && npm run build` and verify build output

## Phase 4: Web Client Core Infrastructure

- [ ] Create `web/src/lib/api.ts` with fetchApi wrapper [req.ygs9k9]
- [ ] Add `checkUsersExist` API function [req.vgcps0]
- [ ] Add `loginBegin` API function [req.ybw3lj]
- [ ] Add `loginFinish` API function [req.5tsv4p]
- [ ] Add `registerBegin` API function [req.xmzin4]
- [ ] Add `registerFinish` API function [req.zgkk62]
- [ ] Add `pairExchange` API function [req.29evhg]
- [ ] Add `listSessions` API function [req.f8zgi8]
- [ ] Add `getSession` API function [req.gb3lku]
- [ ] Add `deleteStaleSessions` API function [req.9s0lei]
- [ ] Add passkey management API functions (`listPasskeys`, `addPasskeyBegin`, `addPasskeyFinish`, `deletePasskey`) [req.aqvd4y] [req.67jse7]
- [ ] Create `web/src/contexts/AuthContext.tsx` [req.8udwqf]
- [ ] Create `web/src/hooks/useSessionUpdates.ts` for WebSocket [req.4lceak]
- [ ] Create `web/src/App.tsx` with React Router setup [req.54k42f]
- [ ] **Test:** Run `cd web && npm run build` to verify no TypeScript errors

## Phase 5: Authentication Pages

- [ ] Install required shadcn/ui components (Button, Input, Card, Form)
- [ ] Create `web/src/pages/LoginPage.tsx` [req.8udwqf] [req.ybw3lj] [req.5tsv4p]
  - [ ] Email input field [req.ybw3lj]
  - [ ] Passkey authentication button [req.5tsv4p]
  - [ ] Link to registration when no users exist [req.vgcps0]
  - [ ] Error handling display
- [ ] Create `web/src/pages/RegisterPage.tsx` [req.vqmg93] [req.xmzin4] [req.zgkk62]
  - [ ] Email input field [req.xmzin4]
  - [ ] Passkey registration button [req.zgkk62]
  - [ ] Redirect to login on success
- [ ] Ensure responsive layout for mobile [req.9dmqy9]
- [ ] **Test:** Build and manually test login/register flow with running server

## Phase 6: Pairing Page

- [ ] Create `web/src/pages/PairPage.tsx` [req.29evhg] [req.xm73nc]
  - [ ] Pairing code input field [req.29evhg]
  - [ ] Pair button with loading state
  - [ ] Success/error message display
  - [ ] Auto-grant access to CLI on success [req.xm73nc]
- [ ] Ensure responsive layout for mobile [req.9dmqy9]
- [ ] **Test:** Build and manually test pairing flow with CLI `devsesh login`

## Phase 7: Dashboard Page

- [ ] Install required shadcn/ui components (Table, Badge)
- [ ] Create `web/src/pages/DashboardPage.tsx` [req.f8zgi8] [req.xizyqy]
  - [ ] Session table with columns:
    - [ ] Session ID (truncated) [req.4eaaqa]
    - [ ] Name
    - [ ] Start time (formatted) [req.h2j29f]
    - [ ] Last ping time (relative) [req.mnocgd]
    - [ ] Status badge (active/inactive) [req.67f9op]
    - [ ] Metadata preview [req.85nmq5]
  - [ ] Implement 5-minute inactive threshold logic [req.kebcow]
  - [ ] Clickable rows to navigate to session details [req.ncy560]
  - [ ] "Remove Stale Sessions" button [req.9s0lei]
  - [ ] Real-time updates via WebSocket hook [req.4lceak]
- [ ] Protected route (requires authentication) [req.xizyqy]
- [ ] Responsive: table becomes card list on mobile [req.9dmqy9]
- [ ] **Test:** Build and manually test dashboard with multiple sessions

## Phase 8: Session Details Page

- [ ] Create `web/src/pages/SessionDetailPage.tsx` [req.gb3lku] [req.h1hqvu]
  - [ ] Display all session metadata [req.gb3lku]
  - [ ] Parse and format JSON metadata nicely
  - [ ] Real-time updates via WebSocket [req.gb3lku]
  - [ ] Placeholder div for future terminal [req.h1hqvu]
  - [ ] Back navigation to dashboard
- [ ] Ensure responsive layout for mobile [req.9dmqy9]
- [ ] **Test:** Build and manually test session detail view with metadata updates

## Phase 9: Passkey Management Page

- [ ] Install required shadcn/ui components (Dialog, Alert)
- [ ] Create `web/src/pages/PasskeyManagementPage.tsx` [req.aqvd4y] [req.67jse7] [req.jzlryq]
  - [ ] List current passkeys with creation date [req.aqvd4y]
  - [ ] "Add Passkey" button [req.aqvd4y]
  - [ ] Delete button per passkey (disabled if only one) [req.67jse7]
  - [ ] Confirmation dialog before deletion
- [ ] Protected route (requires authentication) [req.jzlryq]
- [ ] Ensure responsive layout for mobile [req.9dmqy9]
- [ ] **Test:** Build and manually test adding/removing passkeys

## Phase 10: Final Integration and Testing

- [ ] Run `./build.sh` to build complete binary [req.w6ipyf]
- [ ] Start server with `./devsesh server`
- [ ] **Test:** Complete end-to-end flow:
  - [ ] Register new user with passkey
  - [ ] Login with passkey
  - [ ] Start a session via CLI
  - [ ] View session in dashboard
  - [ ] View session details
  - [ ] Verify real-time updates
  - [ ] Pair a CLI device
  - [ ] Add additional passkey
  - [ ] Remove stale sessions
- [ ] Test responsive design on mobile viewport [req.9dmqy9]
- [ ] Verify dark mode styling [req.9k224a]
