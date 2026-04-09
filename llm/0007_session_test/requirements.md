# Goal

To implement integration tests for starting a new session on the command line and have it be displayed on the web interface

## Requirements

* Create a new session integration test that [req.ds5mfa]
	* starts a server and registers a user and pairs the cli [req.s62387]
	* calls `devsesh start [name]` to spawn a new session (will be blocking) [req.ti1lex]
	* checks the web dashboard to make sure that the session is now displayed [req.imzvod]
* Create extra tests to test that: [req.a9tvq7]
	* Changing the session yaml file updates the metadata on the web interface [req.0mkke9]
	* Calling `devsesh set [key] [value]` in an active session updates the metadata on the web interface [req.s0i314]
* correct any bugs (with either the server, cli, or the frontend) if necessary [req.r1eun4]

## Implementation notes

* Read the `README.md` file to understand the overall project scope [req.otndwu]
* Read the markdown files in `doc/` file to understand the project architecture [req.srqtga]
* Check the `integration_tests` folder for examples on how to write integration tests [req.9n4hfi]
* Use existing functionality in `integration_tests` to start up the server, register, and authenticate [req.0m7z0e]
* Creating a new session will start a new `tmux` session. Sending a command to that tmux session may be the easiest way to interact with an active session. [req.4jgf79]
* USE THE `flake.nix` FILE FOR ALL DEPENDENCIES [req.lyk33x]
