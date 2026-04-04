# Goal

This requirements document implements the server side of the `devsesh` project. Read the README.md for the full project scope.

## Requirements

The requirements are the same as the README.md, for the server side. Namely:

The HTTP server is written in Go. It shares the same codebase as the command line client.

* Started with `devsesh server` command [req.voigef]
* Uses sqlite to store any necessary data (e.g. users, sessions, etc.) [req.vcnuq2]
	* Migrations are also embedded in the go binary using `embed.FS` and can be run with the command `devsesh migrate` [req.ix4ta6]
	* Migrations are sequential SQL files stored in the `sql/` folder. Ex: `00001_create_users_table.sql`, `00002_create_sessions_table.sql`, etc. [req.mij1ct]
	* There should be a `migrations` table in the database to keep track of which migrations have been run [req.zr26qx]
* `/` serves the web client.  [req.1wq405]
	* The web client is embedded in the go binary using `embed.FS`. [req.4g1p44]
	* Create an empty HTML file for the webclient that will be used as a placeholder. We will replace this with the actual web client in the future. [req.3i4lvw]
* `/api/v1/auth/login` [req.38glsd]
	* Authenticates a user and returns a JWT token [req.myorh8]
	* The token should be used in the `Authorization` header for all subsequent requests [req.dl579b]
	* Token expires in 24 hours or as configured per env var [req.ou3x03]
* `/api/v1/auth/create_user` [req.onj6fp]
	* Creates a new user [req.32nb8u]
	* By default, a user can only be created if there are no users in the database OR user creation setting is enabled. [req.m50le9]
* `/api/v1/auth/pair/start` [req.sq63yf]
	* Generates a pairing code for the provided username and returns it in the response. The user needs to enter this code in the web client to complete the authentication process. Once the code is entered in the web client, a JWT token is generated and returned in the response which should be stored in the config file for future requests.  [req.zjyw4e]
	* Paring codes are single use and expire in 5 minutes or as configured per env var [req.k5powd]
* `/api/v1/auth/pair/complete` [req.hq0gcy]
	* Completes the pairing process by validating the provided pairing code and returning a JWT token if the code is valid. The token should be used in the `Authorization` header for all subsequent requests. [req.ehjrlx]
	* JWT token expires in one month or as configured per env var [req.8fttif]
* `/api/v1/sessions/[session_id]/start` [req.8tey8x]
	* Creates a new session in the database with the provided session id and start time  [req.dkjy5l]
* `/api/v1/sessions/[session_id]/ping` [req.3vl4km]
	* Updates the last ping time for the session in the database  [req.dluknx]
* `/api/v1/sessions/[session_id]/end` [req.foiehx]
	* Updates the session status to inactive and sets the end time in the database  [req.ke019e]
* `/api/v1/sessions/[session_id]/meta` [req.wukj7o]
	* Updates the session metadata in the database with the provided session file data [req.o1ytg6]
* `/api/v1/sessions/updates` [req.zcfv5c]
	* A websocket endpoint that the web client can connect to for receiving real-time updates about the user's sessions. Whenever a session is started, pinged, ended, or updated, a message is sent to the connected clients with the updated session information. [req.2q1oku]
* `/api/v1/sessions` [req.vb9w44]
	* Returns a list of all sessions for the current user. This endpoint is used by the web client to display the list of sessions in the dashboard.  [req.i71v1y]
* Add extra endpoints as needed for ssheasy [req.s9db30]
	* Use webauthn + ssheasy to use the local FIDO2 token for SSH authentication  [req.uq2b35]
	* Ssheasy (https://github.com/hullarb/ssheasy) is a Go library, so it should be possible to integrate it directly into the server codebase and use it to establish SSH connections to the tmux sessions running on the user's machine when the user clicks on a session in the dashboard. [req.s8p122]

## Technical implementation

* Create a `flake.nix` on the root directory containing a devshell and build instructions for the whole project [req.patb61]
* Add any needed packages and/or binaries needed for development to the `flake.nix` [req.h6t9ye]
