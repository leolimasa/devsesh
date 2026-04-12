# Devsesh SSH

Goal: use SSH to connect to a running tmux session and have it interactively displayed on the dashboard.

# High level workflow



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


