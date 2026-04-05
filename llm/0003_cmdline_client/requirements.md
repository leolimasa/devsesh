# Objective

This requirements document implements the command line client side of the `devsesh` project. Read the README.md for the full project scope.

## Command line client

* The command line client is written in Go  [req.ypd87q]
* It uses the same codebase as the server (same binary) [req.b586k9]

Commands are below

### `devsesh start [name]`

When a user runs `devsesh start`, the following happens:

* Read the config file (default `~/.devsesh/config.yml` or `$DEVSESH_CONFIG_FILE`) to get the server URL and JWT token.  [req.o5oh2n]
	* If the config file does not exist or is missing any of the required fields and the variables are not already set in the environment, prompt the user to login first. [req.l3x8pd]
* Set `$DEVSESH_SESSION_ID` to a new uuid [req.bklg10]
* Set `$DEVSESH_SESSION_FILE` to a temporary file path that is solely owned by the current user. Ex: `/tmp/devsesh/sessions/[uuid].yml`  [req.x6pxmb]
* Set `$DEVSESH_SESSION_NAME` to the provided name or default to "Unnamed Session" if no name is provided [req.pgs54g]
* Generate a new `$DEVSESH_SESSION_FILE` for the current session. The file should be a yaml file with the following structure: [req.xeab93]

```yaml
session_id: [uuid]
name: [name]
start_time: [timestamp]
hostname: [hostname]
cwd: [current working directory]
```

* Start a new tmux session where the session name is the same as the session id [req.ei4gec]
* Calls the session start server endpoint to notify the server that a new session has started [req.4h1wz6]
* Monitor the tmux session stdout/stderr and call the ping server endpoint everytime there is new output (with appropriate debounce) [req.xewisy]
* Monitor the tmux session for exit and call the server endpoint to end the session  [req.0tp96f]
	* Process ends if the tmux process ends  [req.rdunun]
* Continuously observe `$DEVSESH_SESSION_FILE` and post any changes to the server's session meta update endpoint by parsing the yaml file to json [req.r8c3e0]
* Tmux should be interactive. That means as long as `devsesh start` is running, the stdout/sterr from TMUX is forwarded to the current process' stdout/stderr [req.y2xd5o]
	* Tmux should also receive all inputs sent to the original process  [req.qjxwaf]

### `devsesh login [url]`

* URL is the server url [req.9flxog]
* Get a pairing code by calling the server pairing endpoint. The server will return a pairing code which the user needs to enter in the web client to complete the authentication process.  [req.l1pazq]
* Prompt the user to visit the web client and enter the pairing code to complete the authentication process and then paste the web client code back in the command line to retrieve the JWT token. [req.0723el]
* Poll the JWT endpoint with the generated code until it returns a valid JWT every 5 seconds. Timeout after 10 minutes. [req.w2h5nz]
* Save both the JWT token and the server URL to the config file.  [req.58mwy2]
	* The config file will be set 0600 permissions [req.aljkmr]
	* If DEVSESH_SERVER_URL is set, it will override the server URL in the config file. [req.aqtpcj]
	* If DEVSESH_JWT_TOKEN is set, it will override the JWT token in the config file. [req.ua6by6]

### `devsesh set [key] [value]`

* Set a key-value pair in the session file and post the updated session file to the server [req.3n1za3]
* Only works if the session is active (i.e. $DEVSESH_SESSION_ID is set and the session has not ended) [req.50fgkf]

### Additional relevant commands


| Command                 | Purpose                                                 |
|-------------------------|---------------------------------------------------------|
| `devsesh stop`          | Gracefully end the current session                      |
| `devsesh list`          | Show active local session(s)                            |
| `devsesh attach [name]` | Reattach to an existing tmux session tracked by devsesh |
| `devsesh logout`        | Clear stored credentials                                |
