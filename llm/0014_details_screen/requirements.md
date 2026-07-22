Objective: make the session details screen mobile friendly.

# General requirements

* Move the session hash from a title to just another field in the details panel. The details panel keeps the existing fields (name, host, started, last ping, ended, user id, status, metadata) plus the session hash as a field. [req.33t14v]
* The terminal should always be available. No need to have a button to close it [req.b26nmc]
* Automatically attempt to connect to the session once the page loads. [req.oiqfu6]
	* If secrets are locked, auto-connect surfaces the WebAuthn unlock dialog rather than failing silently. It must NOT call WebAuthn get() without a user gesture — the ceremony stays behind the dialog's button (iOS Safari requires transient activation). [req.q7qqoa]
	* Once connected, automatically reconnect on a dropped connection unless the user explicitly disconnected. [req.jy9djs]
* Layout breakpoint: use the existing Tailwind `md` breakpoint (768px) to switch between the desktop and mobile layouts, consistent with the rest of the app. The mobile hamburger reuses the existing Sheet component (as used by the dashboard mobile menu). [req.t1sqqr]

# Desktop requirements

When on desktop:

* Session details should be a panel at the left side of the screen [req.3e9fsi]
* There should be a top bar. Left to right: session name (far left), connection status (connected/disconnected/authenticating), pinned quick keys, then on the far right the keyboard icon that opens the Quick Keys overlay (see below) and the connect/disconnect button. [req.fbzyn2]
	* When pinned quick keys overflow the available width, collapse the overflow into the Quick Keys overlay (via the keyboard icon) rather than wrapping the top bar. [req.0paub8]
* The terminal should take ALL available space that is not taken by the side panel or top bar [req.zalpuc]

# Quick Keys requirements

* Overlay that allows sending quick keys to the terminal (like ctrl+c). [req.2obqhe]
	* Scope: only sequences a PTY actually accepts. OS-level signals like ctrl+alt+del are not representable over a PTY and are out of scope. [req.d4hetp]
* Preset library of common quick keys available out of the box: ctrl+c, ctrl+d, ctrl+z, ctrl+l, ctrl+a, ctrl+e, esc, tab, arrow keys. [req.zvc5oo]
	* Include special/navigation keys that mobile soft-keyboards lack: esc, f1–f12, home, end, page up, page down. This is the main mobile justification for the feature. [req.gmwimk]
	* Presets are built into the client and are not stored in the database. The database stores only user customizations (custom quick keys) and pin/order state. [req.nwl6lm]
* Custom quick key builder: [req.pxhe1e]
	* Pick modifiers (ctrl/alt/shift) + a base key, with a live preview of the exact byte sequence to be sent (e.g. ctrl+c → \x03). [req.8c4lko]
	* Support sequences/macros: several keystrokes sent in order (e.g. tmux detach = ctrl+a then d), or a literal string optionally followed by Enter. [req.vybd1f]
* Managing saved quick keys: [req.xrhovh]
	* Each saved quick key has a name and a short display token for the top bar (space is tight, especially on mobile). [req.qekrer]
	* Edit, delete, and reorder quick keys; cap how many can be pinned to the top bar. [req.nf14cm]
* After sending a quick key, focus returns to the terminal. [req.72jxmp]
* Option to save quick keys to be displayed in the top bar.  [req.f88huo]
	* Quick keys would be saved globally (in the sqlite database, per user) and be displayed on all sessions [req.ni8xi0]
	* CRUD endpoints for the per-user quick keys, scoped to the authenticated user (NOT session-owner middleware — quick keys are not tied to a session). Pinned quick keys appear across all of the user's sessions. [req.p84b62]

# Mobile requirements

When on mobile:

* Display only the top bar + terminal at the bottom [req.bcu4b3]
* The session details should be a hamburger icon on the top bar [req.ag52fu]
* The terminal should fill the entire screen, leaving room only for the top bar [req.bbdhtc]
* When the mobile keyboard shows up, the terminal should resize to accommodate it. [req.wom428]
	* Note: this is the riskiest requirement. Use the visualViewport API; it is notoriously fiddly on iOS Safari and overlaps the existing "terminal grows, screen gets covered up" bug. Treat it as a dedicated task, not a one-liner. [req.4tzctb]

# Notes

- All testing and integration testing should be done by the agent/LLM
- Investigate existing integration and unit tests for examples

