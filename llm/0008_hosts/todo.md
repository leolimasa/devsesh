# Todo: Host Tracking Implementation

## Phase 1: Database Schema & Migrations

- [ ] Create `sql/00007_create_hosts_table.sql` with hosts table [req.vvpo40] [req.eo1lrm] [req.ftt1fg] [req.c17jn1] [req.bi1i36] [req.633g0p]
  - id INTEGER PRIMARY KEY
  - label TEXT NOT NULL
  - hostname TEXT NOT NULL
  - user_id INTEGER NOT NULL (FK to users)
  - created_at DATETIME
  - updated_at DATETIME
  - UNIQUE constraint on (user_id, label)
- [ ] Create `sql/00008_modify_sessions_for_hosts.sql` [req.t9rqem] [req.6uz0es] [req.y8mm4w]
  - DELETE all existing sessions
  - Add host_id column to pairing_codes table
  - Create new sessions table with host_id instead of hostname
  - Drop old sessions table and rename new one
- [ ] Add Host struct to `internal/db/queries.go` [req.vvpo40] [req.eo1lrm] [req.ftt1fg] [req.c17jn1] [req.bi1i36] [req.633g0p]
- [ ] Modify Session struct in `internal/db/queries.go` - replace Hostname with HostID [req.t9rqem] [req.6uz0es]
- [ ] Modify PairingCode struct in `internal/db/queries.go` - add HostID field
- [ ] **Test:** Run `./build.sh && ./devsesh migrate` to verify migrations apply cleanly

## Phase 2: Host CRUD Database Functions

- [ ] Implement `CreateHost(db, host Host) (int64, error)` [req.nf90gj]
- [ ] Implement `GetHostByID(db, id int64) (*Host, error)` [req.nf90gj] [req.amxefx]
- [ ] Implement `GetHostsByUserID(db, userID int64) ([]Host, error)` [req.nf90gj]
- [ ] Implement `UpdateHost(db, host Host) error` [req.1mxp3p] [req.nf90gj]
- [ ] Implement `DeleteHost(db, id int64) error` [req.3pb2je] [req.nf90gj]
- [ ] Implement `GetHostByLabel(db, userID int64, label string) (*Host, error)` [req.nf90gj]
- [ ] Modify `CreateSession` to use host_id instead of hostname [req.6uz0es]
- [ ] Modify `GetSession` to return host_id instead of hostname [req.6uz0es]
- [ ] Modify `GetSessionsByUserID` to return host_id instead of hostname [req.6uz0es]
- [ ] Implement `GetSessionsWithHostByUserID(db, userID int64) ([]Session, error)` with JOIN [req.16szve]
- [ ] Modify `ApprovePairingCode` to accept and store hostID [req.z0gkx3]
- [ ] Modify `GetPairingCode` to return hostID
- [ ] **Test:** Write and run unit tests in `internal/db/queries_test.go` [req.zvmenj]
  - TestCreateHost
  - TestGetHostByID
  - TestGetHostsByUserID
  - TestUpdateHost
  - TestDeleteHost
  - TestDeleteHostCascadesSessions
  - TestGetHostByLabel

## Phase 3: JWT & Middleware Updates

- [ ] Modify Claims struct in `internal/auth/jwt.go` to add HostID field [req.z0gkx3]
- [ ] Modify `GenerateToken` to accept hostID parameter [req.z0gkx3]
- [ ] Modify `RequireJWT` middleware to extract hostID from claims and add to context [req.kltodt]
- [ ] Add `ContextKeyHostID` constant to `internal/sessions/handler.go`
- [ ] Add `HostIDFromContext` helper function
- [ ] Implement `RequireValidHost` middleware in `internal/server/middleware.go` [req.amxefx]
- [ ] **Test:** Write and run unit tests in `internal/auth/jwt_test.go` [req.zvmenj]
  - TestGenerateTokenWithHostID
  - TestValidateTokenWithHostID

## Phase 4: Host API Endpoints

- [ ] Create `internal/hosts/handler.go` with:
  - [ ] `ListHandler` - GET /api/v1/hosts [req.nf90gj]
  - [ ] `CreateHandler` - POST /api/v1/hosts [req.nf90gj]
  - [ ] `GetHandler` - GET /api/v1/hosts/{id} [req.nf90gj]
  - [ ] `UpdateHandler` - PUT /api/v1/hosts/{id} [req.1mxp3p] [req.nf90gj]
  - [ ] `DeleteHandler` - DELETE /api/v1/hosts/{id} [req.3pb2je] [req.nf90gj]
- [ ] Register host routes in `internal/server/server.go` [req.nf90gj]
- [ ] **Test:** Write and run unit tests in `internal/hosts/handler_test.go` [req.zvmenj]
  - TestListHostsHandler
  - TestCreateHostHandler
  - TestCreateHostDuplicateLabel
  - TestUpdateHostHandler
  - TestDeleteHostHandler
- [ ] **Test:** Manual API testing with curl

## Phase 5: Pairing Flow Updates

- [ ] Modify `PairExchangeHandler` to accept host_id or new_host in request [req.wnkwb9] [req.8f1jl1] [req.w8plh3] [req.u3eo8i]
  - Validate host_id belongs to user if provided
  - Create new host if new_host object provided
  - Require one of host_id or new_host
  - Pass hostID to ApprovePairingCode
- [ ] Modify `PairCompleteHandler` to: [req.z0gkx3] [req.amxefx]
  - Retrieve host_id from pairing code
  - Validate host still exists (return error if deleted)
  - Include host_id in generated JWT
- [ ] **Test:** Write and run unit tests in `internal/auth/pairing_test.go` [req.zvmenj]
  - TestPairExchangeWithExistingHost
  - TestPairExchangeWithNewHost
  - TestPairExchangeRequiresHost
  - TestPairCompleteWithDeletedHost

## Phase 6: Session Handler Updates

- [ ] Modify `StartHandler` to read host_id from context instead of request body [req.kltodt]
- [ ] Modify `ListHandler` to use `GetSessionsWithHostByUserID` and include host data [req.16szve]
- [ ] Modify `GetSessionHandler` to include host data in response
- [ ] Apply `RequireValidHost` middleware to session endpoints in server.go [req.amxefx]
- [ ] **Test:** Run existing session tests and verify they still pass
- [ ] **Test:** Manual testing of session start with host_id from JWT

## Phase 7: Frontend Types & API Functions

- [ ] Add Host interface to `web/src/types/api.ts`
- [ ] Modify Session interface - replace hostname with host_id and optional host [req.16szve]
- [ ] Add host API functions to `web/src/lib/api.ts`: [req.nf90gj]
  - [ ] `listHosts()`
  - [ ] `createHost()`
  - [ ] `getHost()`
  - [ ] `updateHost()`
  - [ ] `deleteHost()`
- [ ] Modify `pairExchange()` to accept hostId and newHost parameters [req.wnkwb9]
- [ ] **Test:** `cd web && npm run build` to verify TypeScript compiles

## Phase 8: HostForm Component

- [ ] Create `web/src/components/HostForm.tsx` [req.lb8h97]
  - Props: host?, onSubmit, onCancel?, submitLabel?
  - Input fields for label and hostname
  - Form validation (required fields)
  - Loading state during submission
- [ ] **Test:** `cd web && npm run build` to verify component compiles

## Phase 9: Hosts Management Page

- [ ] Create `web/src/pages/HostsPage.tsx` [req.c5coyy] [req.1mxp3p]
  - List all hosts in a table (desktop) and cards (mobile)
  - "Add Host" button that shows HostForm
  - Edit button for each host
  - Delete button with confirmation dialog
  - Loading and error states
  - Link back to dashboard
- [ ] Add route `/hosts` -> HostsPage in `web/src/App.tsx`
- [ ] **Test:** `cd web && npm run build` and manual browser testing

## Phase 10: Pairing Page Updates

- [ ] Modify `web/src/pages/PairPage.tsx` [req.wnkwb9] [req.8f1jl1] [req.w8plh3] [req.u3eo8i]
  - Add host selection dropdown (fetches existing hosts)
  - Add "Create new host" option that shows HostForm inline
  - Require host selection before "Pair Device" button is enabled
  - Pass host_id or new_host to pairExchange call
  - Handle errors from host creation or pairing
- [ ] **Test:** `cd web && npm run build` and manual browser testing of pairing flow

## Phase 11: Dashboard Updates

- [ ] Add "Hosts" button to dashboard header in `web/src/pages/DashboardPage.tsx` [req.ocvhii]
- [ ] Update session table to show host label instead of hostname [req.16szve]
- [ ] Update mobile session cards to show host label [req.16szve]
- [ ] Handle sessions where host data might be missing (defensive coding)
- [ ] **Test:** `cd web && npm run build` and manual browser testing

## Phase 12: Integration Testing

- [ ] Write integration tests for host management [req.egvlji]
  - Create host, verify in list
  - Update host, verify changes
  - Delete host, verify sessions deleted
- [ ] Write integration tests for pairing with hosts [req.egvlji]
  - Full pairing flow with existing host selection
  - Full pairing flow with new host creation
- [ ] Write integration tests for session/host integration [req.egvlji]
  - Session start uses host_id from JWT
  - Dashboard displays host info correctly
  - Deleted host returns error on API calls
- [ ] **Test:** Run `./integration_tests/integration_tests.sh`

## Phase 13: Final Verification

- [ ] Run full test suite: `./test.sh`
- [ ] Run integration tests: `./integration_tests/integration_tests.sh`
- [ ] Manual end-to-end testing:
  - [ ] Fresh install with migrations
  - [ ] Register user
  - [ ] Create hosts via hosts page
  - [ ] Pair CLI with existing host
  - [ ] Pair CLI with new host creation
  - [ ] Start session, verify host association
  - [ ] View sessions on dashboard with host labels
  - [ ] Edit host, verify changes reflect
  - [ ] Delete host, verify sessions deleted and JWT invalidated
- [ ] Update documentation if needed (SERVER_ENDPOINTS.md)
