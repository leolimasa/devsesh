Objective: bridge the clipboard between the remote terminal and the local device — copy content out of a remote session into the local OS clipboard, and paste the local OS clipboard into the remote terminal.

# Design rationale (why it works this way)

The terminal runs in the browser (Safari on macOS/iOS, for PRF WebAuthn). WebKit only lets a page write the OS clipboard from inside a **user gesture**, and it invalidates the write if you `await` anything (e.g. a network fetch) mid-gesture. So a copy pushed from the remote cannot silently land on the OS clipboard.

The approach: `devsesh copy` pushes the content into a **local in-browser buffer ahead of time**; a visible affordance then writes it to the OS clipboard **synchronously inside the user's click/keypress**, with the data already in hand. This is the only shape that:

* works in Safari desktop AND iPhone Safari/PWA (a tap is a valid gesture), [req.zeb8sj]
* needs no native agent, Tauri, or browser extension, [req.objbhh]
* keeps Safari (so PRF passkeys keep working) and keeps the installed PWA (so shortcut interception keeps working). [req.zjvsjy]

Cost: one tap/keypress per copy — unavoidable on WebKit, but trivial and predictable. Nothing reaches the OS clipboard until the user acts (a compromised/noisy remote can't silently spam the clipboard).

# Copy (remote terminal → local OS clipboard)

## Backend / CLI

* New command `devsesh copy` reads its **stdin** and sends the contents to the server (e.g. `echo foo | devsesh copy`, `devsesh copy < file`) [req.cp7a10]
* `devsesh copy` runs inside a session and identifies it via the existing session environment (`DEVSESH_SESSION_ID`); it authenticates as the paired CLI already does [req.cp3k22]
* Transport is an HTTP POST to the server (the CLI has no persistent websocket): `POST /api/v1/sessions/{session_id}/clipboard` with the stdin bytes as the body [req.cpq8f1]
* The endpoint is session-owner scoped (reuse the existing `RequireSessionOwner` middleware); a caller can only push clipboard for their own session [req.cp9v41]
* On receipt, the server broadcasts a `clipboard` event to the user over the existing sessions-updates websocket (`Hub.Broadcast(userID, …)`). The event carries the `session_id` and the copied text so the frontend can buffer it without a second round-trip [req.cp2m73]
* Content is treated as **UTF-8 text only** (the OS clipboard write is text). Enforce a size cap (proposed: 256 KB) and reject larger payloads with a clear error from `devsesh copy` [req.cp5s60]

## tmux integration (make selecting text "just copy")

* When `devsesh` creates its tmux session (both the attached `devsesh start` and the detached watcher paths), it configures that session so a copy action pipes the selection to `devsesh copy` — selecting text (mouse drag-release or a copy-mode confirm) lands in the browser buffer with no manual piping [req.cptmx1]
* Version-aware: on tmux ≥ 3.2 set `copy-command 'devsesh copy'`; on older tmux, bind the copy-mode confirm keys and the mouse drag-end to `send -X copy-pipe-and-cancel 'devsesh copy'` [req.cptmx2]
* Enable mouse mode on the devsesh session so drag-to-select works out of the box [req.cptmx3]
* All of this is scoped to the devsesh-created session (`set-option -t <session>` / session-local key tables) and must be **non-destructive** to the user's own global tmux config [req.cptmx4]
* Works even though tmux's copy-command child may not inherit `DEVSESH_SESSION_ID`: `devsesh copy` runs inside tmux (`$TMUX` set) and falls back to resolving the id from the tmux session environment (see req.cp3k22). `devsesh` must be on `PATH` on the host [req.cptmx5]

## Frontend

* The frontend listens on the sessions-updates websocket for the `clipboard` event and stores the payload in an in-memory buffer (it does NOT touch the OS clipboard yet). **Latest-only:** a new `clipboard` event replaces any still-pending buffer [req.cp8h19]
* While a buffer is pending, show a dismissible affordance (e.g. a pill/toast in the session top bar): a short label with the byte size and a **Copy** button — e.g. "Clipboard ready · 1.2 KB · Copy" [req.cp4t55]
* Clicking **Copy** writes the buffered text to the OS clipboard via `navigator.clipboard.writeText(buffer)` called **synchronously inside the click handler** (no awaited work before the write, so WebKit keeps the activation) [req.cp6w38]
* On a successful write, confirm briefly (e.g. the pill flips to "Copied") and clear/dismiss the buffer; on failure (blocked/again) surface a short error and keep the buffer so the user can retry [req.cp1n84]
* The affordance is scoped to the session it came from: it appears for the tab viewing that `session_id` (the session detail view), not on every open tab [req.cp0r27]
* In addition to the button, bind a platform-correct **flush hotkey** (proposed: ⌘⇧C on macOS / Ctrl+Shift+C on Linux/Windows) that performs the same synchronous OS-clipboard write when a buffer is pending and the terminal is focused. The visible button remains the discoverable path; the hotkey is the fast path [req.cp1x66]

# Paste (local OS clipboard → remote terminal)

* When the terminal is focused, intercept the platform paste shortcut and paste the OS clipboard into the terminal: **⌘V on macOS**, **Ctrl+Shift+V on Linux/Windows** (do not hard-code Ctrl+Shift+V) [req.ps3d14]
* Read the clipboard with `navigator.clipboard.readText()` from inside that keydown gesture (the keypress supplies the required activation; `clipboard-read` may prompt the first time) [req.ps7q62]
* Insert the text via xterm's `term.paste(text)` (NOT raw stdin), so the terminal's **bracketed-paste** mode protects the remote shell from paste-injection (a pasted newline must not auto-execute) [req.ps9b40]
* Do nothing if the terminal is not focused, or if the clipboard read is denied/empty [req.ps2k05]

# Resolved decisions

* **Buffer depth:** latest-only — a new copy replaces the pending one (see req.cp8h19). [req.s020ke]
* **Copy hotkey:** yes — a flush hotkey in addition to the button (see req.cp1x66). [req.mi5osv]
* **Paste source:** the real OS clipboard only; no separate devsesh-internal paste buffer (see the Paste section). [req.tq9kup]

# Non-goals / future

* **Zero-gesture desktop copy** (no button click) is explicitly out of scope: it's impossible in Safari from the web context. A future optional native "clipboard agent" (small Go binary managed via home-manager) could pre-empt the button on desktop for a gesture-free copy — tracked separately, not part of this project. [req.cpz001]
* Binary / non-text clipboard content is out of scope. [req.cpz002]

# Implementation details

* This project is only complete when the AGENT/LLM implementing this creates ALL applicable unit tests AND INTEGRATION TESTS, and ALL INTEGRATION TESTS and UNIT TESTS are passing [req.cpi900]
* The agent/llm shall NOT stop until integration and unit tests are fully written, executed, and passing [req.cpi901]
* Safari-specific clipboard gesture behavior cannot be reproduced in the Chromium-based Playwright suite. The integration test must exercise the full server → websocket → buffer path and the synchronous gesture-write in Chromium, and note explicitly what is Chromium-verified vs what still needs manual Safari/iOS confirmation [req.cpi902]
* Update any markdown documents (under `doc` and the README) with implementation changes [req.cpi903]
