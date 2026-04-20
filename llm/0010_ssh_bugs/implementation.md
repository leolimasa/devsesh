# Implementation Plan: SSH Terminal Bug Fixes

This document describes the implementation plan for fixing the Session Detail Page terminal issues where the xterm terminal connects via SSH but does not display remote tmux output or send input.

## Overview

The terminal connection architecture involves:
1. **Frontend**: React `SSHTerminal` component using xterm.js + Go WASM SSH client
2. **Backend**: Go WebSocket-TCP proxy that bridges browser WebSocket to remote SSH server
3. **Remote**: SSH server running tmux sessions

The connection is established, but terminal I/O is not working properly. This plan addresses both debugging/testing and fixing the data flow issues.

---

## Data Structures

No new data structures will be created. The existing structures are sufficient:

- `WSTransport` (web/wasm/sshclient/transport.go) - WebSocket-based net.Conn implementation
- `TCPProxy` (internal/ssh/proxy.go) - Bidirectional WebSocket-TCP proxy
- `SSHClient` class (web/src/lib/ssh-client.ts) - TypeScript wrapper for WASM SSH client

---

## Files to Modify

### 1. integration_tests/tests/ssh-e2e.spec.ts

**Purpose**: Add new integration tests to validate terminal I/O functionality [req.sry715]

#### Modifications

**Add test: SSH terminal connects to existing tmux session** [req.gy4af9]

Add a new test case that validates the terminal can connect to a pre-existing tmux session with a specific session ID. The test should:
- Start the SSH Docker container with a tmux session
- Create a devsesh session that matches the tmux session name
- Connect via SSHTerminal and verify the connection succeeds
- Verify the `tmux attach -t {sessionId}` command is executed

**Add test: Terminal receives output from remote host** [req.ow4f94]

Add a test case that validates terminal output is displayed:
- Connect to the SSH terminal
- Execute a command that produces deterministic output (e.g., `echo "DEVSESH_TEST_OUTPUT"`)
- Wait for the output to appear in the terminal canvas
- Use Playwright's screenshot or text extraction to verify the output is visible

**Add test: Terminal sends keystrokes to remote tmux** [req.vqjj4e]

Add a test case that validates input is sent to the remote session:
- Connect to the SSH terminal
- Type a command via `page.keyboard.type()`
- Verify the command appears in the terminal (echo back from PTY)
- Press Enter and verify command execution output

---

### 2. web/wasm/sshclient/client.go

**Purpose**: Fix terminal output and input handling [req.gpbadi] [req.68mx5a]

#### Modifications

**Modify `Exec` function to handle output properly** [req.gpbadi]

The current `outputWriter.Write` callback may not be invoked correctly or data may be lost. Modifications:
- Add logging to verify when output data is received from the SSH session
- Ensure the output callback is invoked on the main JavaScript thread using proper syscall/js synchronization
- Verify that stdout and stderr are both correctly piped to the output callback
- Consider buffering to handle rapid output bursts

**Modify `SendInput` function to ensure input reaches stdin** [req.68mx5a]

The current implementation writes to a channel that is read by a goroutine. Potential issues:
- Verify the channel is not blocked or closed prematurely
- Add logging to confirm data is being written to the SSH session's stdin pipe
- Ensure the stdin writer goroutine is started before `session.Start()` is called

---

### 3. web/wasm/sshclient/transport.go

**Purpose**: Ensure WebSocket transport correctly handles binary SSH data [req.gpbadi] [req.68mx5a]

#### Modifications

**Verify `Read` method returns data correctly**

The `Read` method uses a condition variable to wait for data. Potential issues:
- Ensure `readBuf` is populated correctly from `onmessage` handler
- Verify the condition signal/wait mechanism works correctly in WASM environment
- Add debug logging to trace data flow through the transport layer

**Verify `Write` method sends binary data correctly**

The `Write` method converts bytes to Uint8Array and sends via WebSocket. Verify:
- The ArrayBuffer is correctly created and sent
- The server receives the binary message (not interpreted as text)

---

### 4. internal/ssh/proxy.go

**Purpose**: Ensure bidirectional proxy correctly relays SSH data [req.gpbadi] [req.68mx5a]

#### Modifications

**Review `proxyWebSocketToTCP` function**

This function reads WebSocket messages and writes to TCP. Verify:
- Binary messages are correctly identified and forwarded (not skipped as text messages)
- Read deadline does not cause premature disconnection during idle periods
- All data from the WebSocket reader is consumed before moving to next message

**Review `proxyTCPToWebSocket` function**

This function reads from TCP and sends to WebSocket. Verify:
- Data is sent as binary messages (not text)
- Read deadline handling does not drop data
- Buffer size (4096) is sufficient for SSH protocol messages

---

### 5. web/src/components/SSHTerminal.tsx

**Purpose**: Ensure terminal component correctly handles output and input callbacks [req.gpbadi] [req.68mx5a]

#### Modifications

**Verify output callback writes to terminal**

The `client.on("output")` callback should write data to xterm. Verify:
- The callback is registered before `client.connect()` is called
- `term.write(data)` is called with the correct data format (string)
- Terminal is properly initialized before data arrives

**Verify input handler sends data correctly**

The `term.onData()` handler should send input to the SSH client. Verify:
- Handler is registered after terminal is opened
- `client.sendInput(data)` correctly converts input to bytes
- Input is sent only when connected (not during connecting/authenticating states)

---

### 6. web/src/lib/ssh-client.ts

**Purpose**: Ensure TypeScript wrapper correctly interfaces with WASM [req.gpbadi] [req.68mx5a]

#### Modifications

**Verify callback registration happens before connect**

The `setupCallbacks()` method should be called before `connect()`. Verify:
- `window.sshSetOutputCallback` is called with a valid function
- The callback correctly emits the "output" event
- Multiple SSHClient instances don't interfere with each other

**Verify sendInput handles both string and Uint8Array**

The `sendInput` method should pass data to `window.sshSendInput`. Verify:
- String data is correctly passed to the WASM function
- The WASM function converts it to bytes correctly

---

## Testing Strategy

### Unit Tests

No new unit tests required; existing tests should pass.

### Integration Tests

The new integration tests in `ssh-e2e.spec.ts` will validate:

1. **Connection test** [req.gy4af9]: Verify SSH connects to tmux session with matching ID
2. **Input test** [req.vqjj4e]: Verify keystrokes are sent to remote tmux
3. **Output test** [req.ow4f94]: Verify remote output is displayed in terminal

### Manual Testing

Use the SSH test container:
```bash
cd integration_tests/ssh
./ssh_test.sh
```

Then connect via the web UI and verify:
- Terminal displays tmux session content
- Typing produces visible characters
- Commands execute and show output

---

## Debugging Approach

Since the connection is established but I/O fails, the debugging should focus on:

1. **Add logging in WASM client**: Log when `outputWriter.Write` is called and what data is received
2. **Add logging in transport**: Log when binary data is received from WebSocket and written to buffer
3. **Add logging in proxy**: Log when data flows in both directions
4. **Browser console**: Check for JavaScript errors or callback issues
5. **Network inspector**: Verify WebSocket frames are binary (not text) for SSH data

The fix will likely involve one of:
- Ensuring the output callback is correctly invoked from the WASM goroutine
- Fixing a race condition in the transport's read buffer
- Correcting message type handling in the proxy
