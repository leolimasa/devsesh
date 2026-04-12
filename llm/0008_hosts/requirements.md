# Objective

Track detailed host information for the host where a session has started.

# Context

See README.md, and all markdown files in `doc/` for the full project context.

# Hosts table

Create a new table `hosts` that stores host information, along with any host options, such as ssh login method. This will require refactoring the login process so that hosts are associated to sessions.

* id [req.vvpo40]
* label [req.eo1lrm]
* hostname [req.ftt1fg]
* user_id [req.c17jn1]
* created_at [req.bi1i36]
* updated_at [req.633g0p]

Label should be unique per user. The hostname can be a FQDN or IP address.

# Session table changes

* The sessions table will no longer have a hostname [req.t9rqem]
* The sessions table will have a "host_id" that associates it to a host [req.6uz0es]
* Migration: delete all sessions before migrating. The user will be forced to login again. [req.y8mm4w]

# Hosts management page

* Create a new "hosts management" page on the webapp to add, edit, and remove hosts [req.c5coyy]
* Add a new `hosts` button to the dashboard that goes to the hosts management page [req.ocvhii]
* Make the "new host" functionality a reusable component so that it can be embedded in other pages easily. [req.lb8h97]
* All hosts fields except for ID are editable [req.1mxp3p]
* Create any endpoints necessary for the host management page [req.nf90gj]

# Login process refactor

We'll need to change the login process so that a login is associated with a host. The host ID will be stored in the JWT claims. That effectively means one host per login. The user can be logged into multiple hosts at the same time (each one with a different JWT).

* Change the web dashboard pairing page so that the user can: [req.wnkwb9]
	* Select an existing host to associate with the login, OR [req.8f1jl1]
	* Create a new host which will then be associated to the login (reuse the "new host" component so it is consistent) [req.w8plh3]
* The pairing page will require BOTH a pairing code and a valid host to proceed [req.u3eo8i]
* Change the JWT generation to include the "host_id" for the selected host for the session [req.z0gkx3]

# Session start refactor

* When a session starts, read the host_id from the JWT and set the "host_id" record for the session accordingly [req.kltodt]

# Dashboard refactor

* Ensure all instances where hostname is displayed now points to the `hosts` table, as the `sessions` table will no longer have a denormalized hostname. [req.16szve]

# Data integrity

* If a host is deleted while a JWT references it, the request should return an error. The user will have to login again so the machine can be associated with an existing host. [req.amxefx]
* When a host is deleted, delete all associated sessions. The user will have to relogin. [req.3pb2je]

# Testing

* Create unit tests for all changes [req.zvmenj]
* Create integration tests for all changes [req.egvlji]
