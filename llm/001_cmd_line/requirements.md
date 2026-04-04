# Goal

This requirements document implements the server side of the `devsesh` project. Read the README.md for the full project scope.

## Requirements

The requirements are the same as the README.md, for the server side. Namely:

The HTTP server is written in Go. It shares the same codebase as the command line client.

* Started with `devsesh server` command
* Uses either postgres or sqlite database (as configured per env var) to store any necessary data (e.g. users, sessions, etc.)
	* Defaults to sqlite for easy setup and testing, but can be configured to use postgres for production use 
	* Migrations are also embedded in the go binary using `embed.FS` and can be run with the command `devsesh migrate`
	* Migrations are sequential SQL files stored in the `sql/` folder. Ex: `00001_create_users_table.sql`, `00002_create_sessions_table.sql`, etc.
	* There should be a `migrations` table in the database to keep track of which migrations have been run
* `/` serves the web client. 
	* The web client is embedded in the go binary using `embed.FS`.
	* A `settings` table in the database can be used to store any necessary settings for the web client and server
* `/api/v1/auth/login`
	* Authenticates a user and returns a JWT token
	* The token should be used in the `Authorization` header for all subsequent requests
	* Token expires in 24 hours or as configured per settings table
* `/api/v1/auth/create_user`
	* Creates a new user
	* By default, a user can only be created if there are not users in the database OR user creation setting is enabled.
* `/api/v1/auth/pair/start`
	* Generates a pairing code for the provided username and returns it in the response. The user needs to enter this code in the web client to complete the authentication process. Once the code is entered in the web client, a JWT token is generated and returned in the response which should be stored in the config file for future requests. 
	* Paring codes are single use and expire in 5 minutes or as configured per settings table
* `/api/v1/auth/pair/complete`
	* Completes the pairing process by validating the provided pairing code and returning a JWT token if the code is valid. The token should be used in the `Authorization` header for all subsequent requests.
	* JWT token expires in one month or as configured per settings table
* `/api/v1/sessions/[session_id]/start`
	* Creates a new session in the database with the provided session id and start time 
* `/api/v1/sessions/[session_id]/ping`
	* Updates the last ping time for the session in the database 
* `/api/v1/sessions/[session_id]/end`
	* Updates the session status to inactive and sets the end time in the database 
* `/api/v1/sessions/[session_id]/meta`
	* Updates the session metadata in the database with the provided session file data
* `/api/v1/sessions/updates`
	* A websocket endpoint that the web client can connect to for receiving real-time updates about the user's sessions. Whenever a session is started, pinged, ended, or updated, a message is sent to the connected clients with the updated session information.
* `/api/v1/sessions`
	* Returns a list of all sessions for the current user. This endpoint is used by the web client to display the list of sessions in the dashboard. 
* Add extra endpoints as needed for ssheasy
	* Use webauthn + ssheasy to use the local FIDO2 token for SSH authentication 
	* Ssheasy (https://github.com/hullarb/ssheasy) is a Go library, so it should be possible to integrate it directly into the server codebase and use it to establish SSH connections to the tmux sessions running on the user's machine when the user clicks on a session in the dashboard.
