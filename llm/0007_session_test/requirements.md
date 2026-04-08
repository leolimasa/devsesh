# Goal

To implement integration tests for starting a new session on the command line and have it be displayed on the web interface

## Requirements

* Create a new session integration test that
	* starts a server and registers a user and pairs the cli
	* calls `devsesh start [name]` to spawn a new session (will be blocking)
	* checks the web dashboard to make sure that the session is now displayed
* Create extra tests to test that:
	* Changing the session yaml file updates the metadata on the web interface
	* Calling `devsesh set [key] [value]` in an active session updates the metadata on the web interface
* correct any bugs (with either the server, cli, or the frontend) if necessary

## Implementation notes

* Read the `README.md` file to understand the overall project scope
* Read the markdown files in `doc/` file to understand the project architecture
* Check the `integration_tests` folder for examples on how to write integration tests
* Use existing functionality in `integration_tests` to start up the server, register, and authenticate
* Creating a new session will start a new `tmux` session. Sending a command to that tmux session may be the easiest way to interact with an active session.
* USE THE `flake.nix` FILE FOR ALL DEPENDENCIES
