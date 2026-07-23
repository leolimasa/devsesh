Objective: have the "active" indicator represent recent terminal activity, and have ping as a measure of whether the session is still alive.

This will be a full overhaul of the currently implemented "ping" system.

# Backend requirements

When the `devsesh` binary spawns a new session with `devsesh start ...`, that process creates a TTY that spawns a tmux session. That makes it possible for it to inspect the terminal output and regularly ping the server.

* As long as the `devsesh start` process is running for a particular session, the process shall send a regular ping message every 5 seconds back to the server [req.1a7c0q]
* Upon receiving the ping message, the server will update the `last_ping_at` database field for that session [req.2s2rj8]
* **every time** the terminal changes state (the screen buffer changes), send a separate `activity` message to the backend. Throttle it to max of 1 message per second.  [req.ugzh7u]
	* Throttling does not mean discarding messages. So, if the buffer is the same at the start and end of that one second, but it was changed in between, the message should still be sent. [req.quoywx]
* Upon receiving an `activity` message, update the `last_activity_at` database field (create it) for that session [req.lgmngh]
* Send both `ping` and `activity` messages in the sessions update websocket accordingly [req.dwt6ud]

# Front end requirements 

* A session is considered "active" when there has been an `activity` message within the last 5 seconds. Update this logic where applicable. [req.qi06bf]
* The frontend should listen to the sessions/updates websocket for both `activity` and `ping` messages and update the frontend model where applicable. [req.t2od0w]

# Implementation details

* This project is only complete when the AGENT/LLM implementing this creates ALL applicable tests AND INTEGRATION TESTS, and ALL INTEGRATION TESTS and UNIT TESTS are passing. [req.garhw0]
* The agent/llm shall NOT stop until integration and unit tests are fully written, executed, and passing. [req.i6hso6]
* Update any markdown documents (under `doc` and the README) with implementation changes [req.x6sv41]
