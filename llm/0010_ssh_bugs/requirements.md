
Objective: the Session Detail Page has an xterm terminal that uses the server side SSH to connect to a remote SSH session. The connection is established, but the terminal does not display the remote tmux output, nor it sends any inputs back to tmux.

## Fixes

Please address the following:

* Create an integration test that validates that the Session Detail Page terminal (xterm):
	* Is able to connect via SSH to an existing tmux session with the same ID as the session ID
	* Is able to type commands
	* Is able to receive output from the remote host
* Fix the Session Detail Page terminal so that it is able to read the remote tmux screen
* Fix the Session Detail Page terminal so that it is able to send keystrokes / input to the remote tmux screen

## Context and extra instructions

- Read README.md and the documents in the `doc/` folder to understand the architecture
- Update doc/ if necessary with new architecture implementations
- Update integration tests with any new use cases
- Ensure all tests, both unit tests and integration tests pass after implementation
