# Devsesh SSH

Goal: use SSH to connect to a running tmux session and have it interactively displayed on the dashboard.

## Context

See README.md, and all markdown files in `doc/` for the full project context.

## Hosts

Create a new table `hosts` that stores host information, along with any host options, such as ssh login method. This will require refactoring the login process so that hosts are associated to sessions.

### Hosts table

* id
* hostname
* ip_addr
* ssh_login_type (default: password)
* ssh_username
* ssh_password

## Session table changes

* The sessions table will no longer have a hostname
* The sessions table will have a "host_id" that associates it to a host

### Hosts management page

* Create a new "hosts management" page on the webapp to add, edit, and remove hosts
* Add a new `hosts` button to the dashboard that goes to the hosts management page
* Make the "new host" functionality a reusable component so that it can be embedded in other pages easily.
* Create any endpoints necessary for the host management page

### Login process refactor

We'll need to change the login process so that a login is associated with a host. The host ID will be stored in the JWT claims.

* Change the web dashboard pairing page so that the user can:
	* Select an existing host to associate with the login, OR
	* Create a new host which will then be associated to the login (reuse the "new host" component so it is consistent)
* The pairing page will require BOTH a pairing code and a valid host to proceed
* Change the JWT generation to include the "host_id" for the selected host for the session

## Session start refactor

* When a session starts, read the host_id from the JWT and set the "host_id" record for the session accordingly

## Port endpoint

API endpoint that creates a new proxy websocket. The proxy forwards TCP packets to/from the session's machine IP given a port.

Endpoint: `/api/v1/sessions/<id>/port/<port_number>`

Process:

* Starts a websocket
* Receives JWT token as the first message and performs authentication.
* Gets a IP address for the machine hosting the session from the `sessions` table
* Creates a new TCP socket connection to that IP and the port specified in the request
* Proxies packets to/from websocket to TCP socket

## How SSH works

* 


