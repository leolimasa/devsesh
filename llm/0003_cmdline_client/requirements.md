# Objective

This requirements document implements the command line client side of the `devsesh` project. Read the README.md for the full project scope.

## Command line client

The command line client is written in Go and provides the commands below.

### `devsesh start [name]`

When a user runs `devsesh start`, the following happens:

* Read the config file (default `~/.devsesh/config.yml` or `$DEVSESH_CONFIG_FILE`) to get the server URL and JWT token. 
	* If the config file does not exist or is missing any of the required fields and the variables are not already set in the environment, prompt the user to login first.
* Set `$DEVSESH_SESSION_ID` to a new uuid
* Set `$DEVSESH_SESSION_FILE` to a temporary file path that is solely owned by the current user. Ex: `/tmp/devsesh/sessions/[uuid].yml` 
* Set `$DEVSESH_SESSION_NAME` to the provided name or default to "Unnamed Session" if no name is provided
* Generate a new `$DEVSESH_SESSION_FILE` for the current session. The file should be a yaml file with the following structure:

```yaml
session_id: [uuid]
name: [name]
start_time: [timestamp]
hostname: [hostname]
cwd: [current working directory]
```

* Start a new tmux session where the session name is the same as the session id
* Calls `$DEVSESH_SERVER_URL/api/sessions/[session_id]/start` to notify the server that a new session has started
* Monitor the tmux session stdout/stderr and call `$DEVSESH_SERVER_URL/api/sessions/[session_id]/ping` everytime there is new output (with appropriate debounce)
* Monitor the tmux session for exit and call `$DEVSESH_SERVER_URL/api/sessions/[session_id]/end` when the session ends
* Continuously observe `$DEVSESH_SESSION_FILE` and post any changes to `$DEVSESH_SERVER_URL/api/sessions/[session_id]/meta` by parsing the yaml file to json

### `devsesh login [email] [url]`

* Get a pairing code by calling `$DEVSESH_SERVER_URL/api/auth/pair/start` with the provided username. The server will return a pairing code which the user needs to enter in the web client to complete the authentication process. 
* Prompt the user to visit the web client and enter the pairing code to complete the authentication process and then paste the web client code back in the command line to retrieve the JWT token.
* Call `$DEVSESH_SERVER_URL/api/auth/pair/complete` with the pairing code to complete the authentication process and retrieve a JWT token.
* Save both the JWT token and the server URL to the config file. 
	* The config file will be set 0600 permissions
	* If DEVSESH_SERVER_URL is set, it will override the server URL in the config file.
	* If DEVSESH_JWT_TOKEN is set, it will override the JWT token in the config file.

### `devsesh set [key] [value]`

* Set a key-value pair in the session file and post the updated session file to the server
* Only works if the session is active (i.e. $DEVSESH_SESSION_ID is set and the session has not ended)

### Additional commands


| Command                 | Purpose                                                 |
|-------------------------|---------------------------------------------------------|
| `devsesh stop`          | Gracefully end the current session                      |
| `devsesh list`          | Show active local session(s)                            |
| `devsesh attach [name]` | Reattach to an existing tmux session tracked by devsesh |
| `devsesh logout`        | Clear stored credentials                                |
| `devsesh server`        | See server section below                                |
