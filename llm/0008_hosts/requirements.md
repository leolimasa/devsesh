# Objective

Track detailed host information for the host where a session has started.

# Context

See README.md, and all markdown files in `doc/` for the full project context.

# Hosts table

Create a new table `hosts` that stores host information, along with any host options, such as ssh login method. This will require refactoring the login process so that hosts are associated to sessions.

* id
* label
* hostname
* user_id
* created_at
* updated_at

Name should be unique per user. The hostname can be a FQDN or IP address.

# Session table changes

* The sessions table will no longer have a hostname
* The sessions table will have a "host_id" that associates it to a host
* Migration: delete all sessions before migrating. The user will be forced to login again.

# Hosts management page

* Create a new "hosts management" page on the webapp to add, edit, and remove hosts
* Add a new `hosts` button to the dashboard that goes to the hosts management page
* Make the "new host" functionality a reusable component so that it can be embedded in other pages easily.
* All hosts fields except for ID are editable
* Create any endpoints necessary for the host management page

# Login process refactor

We'll need to change the login process so that a login is associated with a host. The host ID will be stored in the JWT claims. That effectively means one host per login. The user can be logged into multiple hosts at the same time (each one with a different JWT).

* Change the web dashboard pairing page so that the user can:
	* Select an existing host to associate with the login, OR
	* Create a new host which will then be associated to the login (reuse the "new host" component so it is consistent)
* The pairing page will require BOTH a pairing code and a valid host to proceed
* Change the JWT generation to include the "host_id" for the selected host for the session

# Session start refactor

* When a session starts, read the host_id from the JWT and set the "host_id" record for the session accordingly

# Dashboard refactor

* Ensure all instances where hostname is displayed now points to the `hosts` table, as the `sessions` table will no longer have a denormalized hostname.

# Data integrity

* If a host is deleted while a JWT references it, the request should return an error. The user will have to login again so the machine can be associated with an existing host.
* When a host is deleted, delete all associated sessions. The user will have to relogin.

# Testing

* Create unit tests for all changes
* Create integration tests for all changes
