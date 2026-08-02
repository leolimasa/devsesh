# Implementation plan — clipboard bridge

Maps every requirement tag from `requirements.md` to concrete data structures, functions, and files. Nothing is implemented yet, so there are no ✅ markers.

## Design properties (how the shape satisfies the rationale)

These tags are properties of the architecture rather than a single artifact; they are realized by the pieces cited:

* Works on Safari desktop + iPhone PWA — realized by the **synchronous gesture write** (`copyBufferedText`, req.cp6w38) + the local pre-buffer (req.cp8h19). [req.zeb8sj]
* No native agent / Tauri / extension — the whole path is CLI HTTP POST → existing Hub → browser; no new runtime. [req.objbhh]
* Keeps Safari + PWA untouched — no change to auth, service worker, or webview; only new endpoint/event/UI. [req.zjvsjy]

---

## Backend

### internal/sessions/websocket.go — MODIFY

* **`SessionUpdate` struct (MODIFY)** — add a field `Clipboard string \`json:"clipboard,omitempty"\`` to carry the copied text for `clipboard` events. Existing events leave it empty; clipboard events leave `Session` as the zero value and set `SessionID` + `Clipboard`. Reuses the existing per-user `Hub.Broadcast`, so no new socket. [req.cp2m73]

### internal/sessions/handler.go — MODIFY (new handler)

* **`ClipboardHandler(database *sql.DB, hub *Hub) http.HandlerFunc` (CREATE)** — mirrors `MetaHandler`/`ReorderHandler` style.
  * Pulls the session from context via `SessionFromContext` (populated by `RequireSessionOwner`) and the `userID` via `UserIDFromContext`; both already guarantee ownership. [req.cp9v41]
  * Wraps the body in `http.MaxBytesReader(w, r.Body, maxClipboardBytes)` (const `maxClipboardBytes = 256 * 1024`) and `io.ReadAll`s it; a MaxBytes overflow returns `413`. [req.cp5s60]
  * Rejects non-text with `utf8.Valid(body)` → `400` and a clear message. [req.cp5s60]
  * Broadcasts `SessionUpdate{Event: "clipboard", SessionID: session.ID, Clipboard: string(body)}` with `hub.Broadcast(userID, …)`, then `204 No Content`. [req.cp2m73]

### internal/server/server.go — MODIFY

* **Route registration (MODIFY)** — add
  `mux.Handle("POST /api/v1/sessions/{session_id}/clipboard", jwtMiddleware(RequireSessionOwner(database)(http.HandlerFunc(sessions.ClipboardHandler(database, hub)))))`
  next to the other `/sessions/{session_id}/…` routes. [req.cpq8f1][req.cp9v41]

### internal/client/api.go — MODIFY

* **`SendClipboard(sessionID string, content []byte) error` (CREATE)** — the CLI→server call. `doRequest` only sends JSON, so this builds a request directly: `POST {serverURL}/api/v1/sessions/{id}/clipboard` with the **raw bytes** as the body and `Content-Type: text/plain; charset=utf-8`, plus the `Authorization: Bearer` header (same as `doRequest`). Non-2xx → error with the server message; `413`/`400` surface the size/encoding rejection. [req.cpq8f1][req.cp5s60]

### cmd/copy.go — CREATE

* **`NewCopyCmd() *cobra.Command` (CREATE)** — `Use: "copy"`, `Args: cobra.NoArgs`, `RunE: runCopy`. Short help notes it reads stdin and bridges it to the browser's clipboard buffer.
* **`runCopy(cmd *cobra.Command, args []string) error` (CREATE)**
  * Resolve the session id: `os.Getenv("DEVSESH_SESSION_ID")`, falling back to `client.GetSessionEnvCurrent("DEVSESH_SESSION_ID")` (same stale-env robustness as `resolveSessionFile` in `cmd/set.go`); empty → "not in an active devsesh session". [req.cp3k22]
  * `io.ReadAll(os.Stdin)`; reject early if `len > maxClipboardBytes` or `!utf8.Valid` with a clear message (fast local failure; the server re-checks). [req.cp5s60][req.cp7a10]
  * `cfg := client.LoadConfig()` for `ServerURL`/`JWTToken`; error if unset. `client.NewAPIClient(cfg.ServerURL, cfg.JWTToken).SendClipboard(sessionID, body)`. [req.cp3k22][req.cpq8f1]
  * Print a short confirmation (e.g. `Sent N bytes to clipboard`).

### cmd/root.go — MODIFY

* **Root command wiring (MODIFY)** — register `NewCopyCmd()` alongside the existing subcommands. [req.cp7a10]

### internal/client/tmux.go — MODIFY (tmux copy-command wiring)

* **`tmuxVersionAtLeast(major, minor int) bool` (CREATE)** — parse `tmux -V` (e.g. `tmux 3.4`) and compare, to choose the modern vs legacy copy binding. Tolerate non-numeric suffixes (`3.3a`). [req.cptmx2]
* **`ConfigureClipboard(sessionName string) error` (CREATE)** — runs a small set of `tmux ... -t <sessionName>` commands right after the session exists, all **session-scoped** so the user's global config is untouched [req.cptmx4]:
  * `set-option -t <s> mouse on` (drag-to-select) [req.cptmx3].
  * If `tmuxVersionAtLeast(3, 2)`: `set-option -t <s> copy-command 'devsesh copy'` [req.cptmx1][req.cptmx2].
  * Else (legacy): bind the copy-mode confirm keys and mouse drag-end in a session-local sense — `bind-key -T copy-mode-vi y send -X copy-pipe-and-cancel 'devsesh copy'` (and `MouseDragEnd1Pane`) [req.cptmx2]. (Key tables are server-global in old tmux; document that as the one unavoidable non-session-local bit, gated behind the old-version branch only.)
  * Best-effort: log and continue on failure — clipboard tmux wiring must never block session start.
  * Relies on `devsesh` being on `PATH` and on `devsesh copy`'s session-env fallback (req.cp3k22) since the copy-command child may not inherit `DEVSESH_SESSION_ID` [req.cptmx5].
* **`StartSession(...)` (MODIFY)** — after `pty.Start` succeeds and the session exists, call `ConfigureClipboard(sessionName)` (best-effort). [req.cptmx1]
* **`NewSessionDetached(...)` (MODIFY)** — after the detached `new-session` returns, call `ConfigureClipboard(sessionName)` (best-effort). [req.cptmx1]

---

## Frontend

### web/src/types/api.ts — MODIFY

* **`SessionUpdate` interface (MODIFY)** — add `"clipboard"` to the `event` union and an optional `clipboard?: string` field. [req.cp2m73][req.cp8h19]

### web/src/lib/clipboard.ts — CREATE

* **`writeClipboard(text: string): Promise<void>` (CREATE)** — thin wrapper over `navigator.clipboard.writeText(text)`. Callers invoke it **synchronously at the top of a gesture handler** (no awaited work first) so WebKit keeps the activation. [req.cp6w38]
* **`readClipboard(): Promise<string>` (CREATE)** — wrapper over `navigator.clipboard.readText()`, called from inside the paste keydown gesture. [req.ps7q62]

### web/src/lib/utils.ts — MODIFY

* **`isMac(): boolean` (CREATE)** — platform sniff (`navigator.platform`/`userAgent`) so paste maps to ⌘V on macOS vs Ctrl+Shift+V elsewhere, and the flush hotkey maps to ⌘⇧C vs Ctrl+Shift+C. [req.ps3d14][req.cp1x66]

### web/src/pages/SessionDetailPage.tsx — MODIFY

* **Clipboard buffer state (CREATE)** — `const [clipboard, setClipboard] = useState<{ text: string; bytes: number } | null>(null)`. Holds the pending buffer; the OS clipboard is untouched until the user acts. [req.cp8h19]
* **`handleUpdate` (MODIFY)** — add a branch: when `update.event === "clipboard"` and `update.session_id === id` (the session this tab is viewing), `setClipboard({ text: update.clipboard ?? "", bytes: byteLen(update.clipboard) })`. Latest-only: this replaces any pending buffer; other sessions' clipboard events are ignored here. [req.cp8h19][req.cp0r27][req.s020ke]
* **`handleCopyClipboard` (CREATE)** — the gesture write. Reads `clipboard.text` already in hand and calls `writeClipboard(text)` **synchronously** (first statement); on resolve, flip the pill to "Copied" then clear the buffer; on reject, keep the buffer and surface a short error so the user can retry. [req.cp6w38][req.cp1n84]
* **`handleDismissClipboard` (CREATE)** — clears the buffer without writing.
* **Wire `SessionTopBar`** — pass `clipboard`, `onCopyClipboard`, `onDismissClipboard`. [req.cp4t55]
* **Flush hotkey plumbing** — pass `handleCopyClipboard` into `SSHTerminal` as `onClipboardHotkey` (the terminal owns focus, so it decides when the hotkey applies; see below). Calling the callback from the terminal's synchronous key handler preserves the gesture. [req.cp1x66][req.mi5osv]

### web/src/components/SessionTopBar.tsx — MODIFY

* **Props (MODIFY)** — add `clipboard?: { text: string; bytes: number } | null`, `onCopyClipboard: () => void`, `onDismissClipboard: () => void`.
* **Clipboard pill (CREATE)** — when `clipboard` is set, render a dismissible pill: `Clipboard ready · {formatBytes(bytes)} · [Copy]`. The **Copy** button's `onClick` calls `onCopyClipboard` (a user gesture). A local `copied` flag flips the label to "Copied ✓" briefly before the parent clears the buffer. Dismiss "×" calls `onDismissClipboard`. [req.cp4t55][req.cp1n84]

### web/src/components/SSHTerminal.tsx — MODIFY

* **`onClipboardHotkey?: () => void` prop (CREATE)** — invoked when the flush hotkey is pressed while the terminal is focused.
* **`term.attachCustomKeyEventHandler(...)` (CREATE, in the mount effect)** — single handler, only fires when xterm has focus (which gives us "terminal focused" for free) [req.ps2k05]:
  * **Paste**: on `keydown` matching ⌘V (mac) / Ctrl+Shift+V (else) → prevent xterm's default, call `readClipboard()` and, on resolve, `term.paste(text)` (bracketed-paste aware — protects the remote shell) [req.ps3d14][req.ps7q62][req.ps9b40]. Do nothing on empty/denied read [req.ps2k05].
  * **Flush hotkey**: on `keydown` matching ⌘⇧C (mac) / Ctrl+Shift+C (else) → synchronously call `onClipboardHotkey?.()`; return `false` to swallow the key. The parent writes the buffer in the same synchronous stack, preserving the gesture. [req.cp1x66]
  * Returning `false` stops xterm from also sending the bytes to the pty for these combos.

---

## Tests

### Go unit

* **internal/sessions/handler_test.go — `TestClipboardHandler` (CREATE)** — table cases: happy path broadcasts a `clipboard` `SessionUpdate` with the text (assert via a subscribed hub client), oversize body → `413`, invalid UTF-8 → `400`, wrong-owner blocked by middleware. [req.cpi900]
* **internal/client/api_test.go — `TestSendClipboard` (CREATE)** — httptest server asserts method/path/body/`Authorization` and text/plain content type. [req.cpi900]
* **internal/client/tmux_test.go — `TestTmuxVersionAtLeast` (CREATE)** — parses representative `tmux -V` strings (`3.4`, `3.3a`, `2.9`) and checks the ≥3.2 boundary. Integration-level: a test that creates a real tmux session and asserts `tmux show-options -t <s> copy-command` returns `devsesh copy` (skipped when tmux < 3.2 or absent). [req.cptmx1][req.cptmx2][req.cpi900]

### Web unit (vitest)

* **SessionTopBar** — pill renders with size + Copy; clicking calls `onCopyClipboard`; "Copied" state shows. [req.cpi900]
* **clipboard buffer reducer / handleUpdate** — a `clipboard` event for the current session sets the buffer and replaces a prior one (latest-only); an event for another session is ignored. [req.cp8h19][req.cp0r27][req.cpi900]

### Integration (Playwright) — clipboard.spec.ts (CREATE)

* Pair a CLI, start a session, open its detail page. Grant `clipboard-read`/`clipboard-write` to the context.
* Drive copy via the endpoint (`POST …/clipboard`) — equivalent to `devsesh copy` — assert the **pill appears** on the viewing tab; click **Copy**; assert `navigator.clipboard.readText()` returns the pushed text (full server→ws→buffer→gesture-write path). [req.cp2m73][req.cp4t55][req.cp6w38][req.cpi900]
* Assert an oversize push is rejected and a non-active-session push does **not** show a pill on the wrong tab. [req.cp5s60][req.cp0r27]
* **Flush hotkey**: with a buffer pending and the terminal focused, dispatch ⌘⇧C / Ctrl+Shift+C (via `page.keyboard`) and assert the OS clipboard now holds the buffered text (same read-back as the button path). Playwright key events are trusted/activated, so the synchronous write should hold. If the synthetic-key activation proves flaky in Chromium, fall back to unit-testing the terminal key handler + parent write and note that fallback explicitly in the spec (do not silently drop the assertion). [req.cp1x66][req.mi5osv]
* **Paste**: set the OS clipboard, focus the terminal, dispatch the paste combo, and assert the text reaches the remote pty (reuse the ssh-e2e/tmux harness). [req.ps3d14][req.ps9b40]
* The spec header must state explicitly: this verifies the mechanics in **Chromium**; the **Safari/iOS synchronous-gesture behavior still needs manual confirmation** (the Chromium suite can't reproduce WebKit's activation rules). [req.cpi902]
* **tmux copy path (stretch e2e / or CLI-level):** in a devsesh-started session, trigger a copy-mode `copy-pipe-and-cancel` (or run `devsesh copy` directly) and assert the pill appears on the viewing tab — proving the tmux wiring reaches the browser. If driving copy-mode selection through xterm proves flaky, cover the wiring with the `tmux show-options` Go test above and drive the browser path via the endpoint. [req.cptmx1][req.cptmx5]
* The task is complete only when all unit + integration tests are written and green. [req.cpi900][req.cpi901]

### Docs

* **README / doc/ (MODIFY)** — document `devsesh copy`, the Copy pill + flush hotkey, and paste (⌘V / Ctrl+Shift+V), including the "one tap per copy on Safari/iOS" note. [req.cpi903]

---

## Manual verification — Safari / iOS (cannot be automated)

The Chromium suite proves the mechanics but not WebKit's clipboard-activation rules, which are the entire reason for the buffer + synchronous-gesture design. Before considering this done, run this checklist on real devices and record the result in this doc. [req.cpi902]

* **macOS Safari (installed PWA):** run `echo hello | devsesh copy` on the remote → the "Clipboard ready" pill appears → click **Copy** → paste into a native app shows `hello`.
* **macOS Safari — flush hotkey:** repeat, but press ⌘⇧C instead of clicking → clipboard holds the text.
* **iPhone Safari (Home-Screen PWA):** run `devsesh copy` on the remote → pill appears → tap **Copy** → paste into Notes/Messages shows the text. (This is the case no other approach solved.)
* **Paste, both:** put text on the OS clipboard, focus the terminal, press ⌘V (mac) → text lands in the shell via bracketed paste (a multi-line paste does NOT auto-execute).
* **tmux select-to-copy:** in a devsesh session, drag-select with the mouse → pill appears without running `devsesh copy` manually.
* **Failure surface:** if a write is blocked, the pill shows an error and keeps the buffer (retryable) rather than failing silently.

Note in the PR/commit which of these were confirmed and on which OS versions; a Chromium-green suite must NOT be reported as "works on Safari/iOS."

## Non-goals (recorded, not implemented)

* Zero-gesture desktop copy (would need the optional native agent) — out of scope. [req.cpz001]
* Binary / non-text clipboard — rejected by the UTF-8 check. [req.cpz002]

## Resolved-decision tags

* Latest-only buffer — see the `handleUpdate` replace behavior. [req.tq9kup is paste-source; buffer depth →] [req.s020ke]
* Flush hotkey present — `onClipboardHotkey` + `attachCustomKeyEventHandler`. [req.mi5osv]
* Paste reads the real OS clipboard only (`readClipboard`), no internal paste buffer. [req.tq9kup]
