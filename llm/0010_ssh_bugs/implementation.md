# Implementation: SSH Bugs Fix

## Overview

This document describes fixes for two SSH-related issues:
1. The "Connect" button not showing when the session is inactive
2. SSH connection failing to attach to tmux because it uses the wrong session identifier

---

## Data Structures

No new data structures are created or modified.

---

## File: `web/src/pages/SessionDetailPage.tsx`

### Modifications

#### Connect Button Visibility Logic [req.o6b7de]

**Current behavior:** The "Connect" button only shows when `isActive && session.host`.

**Issue:** Users should be able to connect to sessions even when inactive (the session host machine may still be reachable).

**Fix:** Change the condition to show the Connect button whenever `session.host` exists, regardless of active state. The active state affects whether the tmux session exists on the remote host, but the SSH connection itself can still be established.

Modify the conditional rendering of the Connect button:
- Remove `isActive` from the condition for showing the Connect button
- Keep `session.host` check since SSH requires host configuration
- Update the placeholder text to reflect connection availability more accurately

#### Session ID for tmux attach [req.rb7cft]

**Current behavior:** Passes `session.name` to SSHTerminal as `sessionName`, which is then used to attach to tmux.

**Issue:** The tmux session is created with the session UUID (`sessionID`), not the friendly name (`session.name`). When the SSHTerminal tries to run `tmux attach -t ${sessionName}`, it fails because no tmux session exists with that friendly name.

**Fix:** Pass `session.id` instead of `session.name` to the SSHTerminal component as the identifier for tmux attachment.

---

## File: `web/src/components/SSHTerminal.tsx`

### Modifications

#### Component Interface Update [req.rb7cft]

**Current behavior:** Accepts `sessionName` prop and uses it for `tmux attach -t ${sessionName}`.

**Change:** Rename the prop from `sessionName` to `sessionId` to clarify its purpose. The prop represents the tmux session identifier, which is the UUID, not the human-readable name.

Update:
1. Rename prop `sessionName` to `sessionId` in the `SSHTerminalProps` interface
2. Update the `tmux attach` command to use `sessionId`
3. Update references throughout the component

---

## Testing Considerations

### Integration Tests

The existing integration tests in `integration_tests/tests/session.spec.ts` should be extended with a test case that verifies SSH connection and tmux attachment work correctly. This test should:
1. Start a session with a friendly name
2. Connect via SSH
3. Verify the terminal connects to the correct tmux session (using the session UUID)

### Manual Testing

1. Start a devsesh session on a remote host
2. Open the session detail page in the web UI
3. Verify the Connect button is visible (regardless of session active state)
4. Click Connect and verify the terminal attaches to the correct tmux session
