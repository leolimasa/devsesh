# TODO: SSH Bugs Fix

## Project Status

- 🟢 Phase 1: Fix Connect Button Visibility [req.o6b7de]
- 🟢 Phase 2: Fix tmux Session Attachment [req.rb7cft]
- 🟢 Phase 3: Integration Testing

## Phase 1: Fix Connect Button Visibility [req.o6b7de]

- [x] Modify `web/src/pages/SessionDetailPage.tsx`:
  - [x] Update Connect button condition to show when `session.host` exists (remove `isActive` requirement)
  - [x] Update Close Terminal button condition to show when `session.host && showTerminal` (remove `isActive` requirement)
  - [x] Update placeholder text to reflect connection availability when no host is configured
- [x] Test Phase 1:
  - [x] Build web client: `cd web && npm run build`
  - [x] Manually verify Connect button appears for inactive sessions with host configured
  - [x] Verify Connect button does not appear for sessions without host configured

## Phase 2: Fix tmux Session Attachment [req.rb7cft]

- [x] Modify `web/src/components/SSHTerminal.tsx`:
  - [x] Rename `sessionName` prop to `sessionId` in `SSHTerminalProps` interface
  - [x] Update `tmux attach -t` command to use `sessionId`
  - [x] Update useEffect dependency array to use `sessionId`
- [x] Modify `web/src/pages/SessionDetailPage.tsx`:
  - [x] Pass `session.id` instead of `session.name` to SSHTerminal component
- [x] Test Phase 2:
  - [x] Build web client: `cd web && npm run build`
  - [x] Run unit tests: `./test.sh`

## Phase 3: Integration Testing

- [x] Run all integration tests: `./integration_tests/integration_tests.sh`
- [ ] Manual end-to-end test:
  - [ ] Start devsesh server
  - [ ] Start a session on a paired host
  - [ ] Navigate to session detail page
  - [ ] Verify Connect button is visible
  - [ ] Click Connect and verify tmux session attaches correctly
