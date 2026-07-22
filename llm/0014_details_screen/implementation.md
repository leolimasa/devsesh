# Implementation: mobile-friendly session details screen + Quick Keys

This document describes the concrete changes for the requirements in `requirements.md`.
Each item carries the originating requirement tag(s). "CREATE" = new file/element,
"MODIFY" = change to an existing one.

The work splits into two tracks:

1. **Layout / connection UX** — restructure `SessionDetailPage` into a top bar + side
   details panel + always-on terminal, responsive across the `md` breakpoint, with
   auto-connect and auto-reconnect. Frontend only.
2. **Quick Keys** — a client-side preset library plus a per-user, server-persisted set
   of custom/pinned quick keys, an overlay to build/manage them, and top-bar pins that
   inject byte sequences into the PTY. Frontend + Go backend + one migration.

---

## Data structures

### SQL — CREATE `sql/00018_create_quick_keys_table.sql`

Stores only user-defined quick keys and their pin/order state. Presets are client-side
and are never persisted. [req.nwl6lm] [req.ni8xi0]

```sql
CREATE TABLE IF NOT EXISTS quick_keys (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    name          TEXT NOT NULL,          -- human label shown in the overlay
    display_token TEXT NOT NULL,          -- short label rendered on the top-bar pill
    spec          TEXT NOT NULL,          -- opaque JSON describing the keystroke sequence
    pinned        INTEGER NOT NULL DEFAULT 0,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    DATETIME NOT NULL,
    updated_at    DATETIME NOT NULL
);
```

* `spec` is treated as opaque JSON by the backend (validated as well-formed JSON and
  length-capped only). The client owns the structured shape and the byte encoding, so
  new key types never require a migration. [req.nwl6lm] [req.8c4lko] [req.vybd1f]
* Client `spec` shape (documented here for reference, not enforced server-side): an
  ordered array of steps, each either
  `{ "type": "combo", "ctrl": bool, "alt": bool, "shift": bool, "key": "c" }` or
  `{ "type": "literal", "text": "...", "enter": bool }`. [req.8c4lko] [req.vybd1f]

### Go — MODIFY `internal/db/queries.go`

CREATE `QuickKey` struct, mirroring the `Host` struct's JSON-tag + time-parse style:

```go
type QuickKey struct {
    ID           int64     `json:"id"`
    UserID       int64     `json:"user_id"`
    Name         string    `json:"name"`
    DisplayToken string    `json:"display_token"`
    Spec         string    `json:"spec"`
    Pinned       bool      `json:"pinned"`
    SortOrder    int       `json:"sort_order"`
    CreatedAt    time.Time `json:"created_at"`
    UpdatedAt    time.Time `json:"updated_at"`
}
```

### TypeScript — MODIFY `web/src/types/api.ts`

CREATE `QuickKey` interface matching the Go JSON shape (`id`, `user_id`, `name`,
`display_token`, `spec`, `pinned`, `sort_order`, timestamps). `spec` typed as a
discriminated-union array (`QuickKeyStep[]`) parsed from the JSON string. [req.nwl6lm]

---

## Backend

### CREATE `internal/db/queries.go` functions (MODIFY file)

Follow the existing `Host` CRUD idiom exactly (string time columns via `timeFormat` /
`parseTime`, `sql.ErrNoRows` → `nil, nil`).

* `CreateQuickKey(db, qk QuickKey) (int64, error)` — INSERT, stamps `created_at`/
  `updated_at` with `time.Now().UTC()`, returns `LastInsertId`.
* `GetQuickKeysByUserID(db, userID int64) ([]QuickKey, error)` — SELECT all rows for the
  user ordered by `sort_order, id`. Returns the full list the client filters/pins from.
  [req.ni8xi0]
* `GetQuickKeyByID(db, id int64) (*QuickKey, error)` — single row for ownership checks in
  update/delete.
* `UpdateQuickKey(db, qk QuickKey) error` — UPDATE `name, display_token, spec, pinned,
  sort_order, updated_at` by id. Used for edits, pin toggles, and reordering. [req.nf14cm]
* `DeleteQuickKey(db, id int64) error` — DELETE by id. [req.nf14cm]

### CREATE `internal/quickkeys/handler.go`

New package modeled on `internal/hosts/handler.go`. Every handler pulls `userID` from
`ctxutil.UserIDFromContext`; the row's `user_id` is checked against it on get/update/
delete so keys are strictly per-authenticated-user. Authorization is the shared JWT
middleware only — **not** `RequireSessionOwner`, since quick keys are not tied to a
session. [req.p84b62] [req.f88huo]

* `ListHandler(db) http.HandlerFunc` — returns the caller's quick keys as JSON (empty
  slice, never null, matching the hosts handler). [req.ni8xi0]
* `CreateHandler(db) http.HandlerFunc` — decodes `{name, display_token, spec, pinned,
  sort_order}`, validates: non-empty `name`/`display_token`, `spec` parses as JSON and is
  within a length cap, `display_token` within a short length cap. Inserts and returns 201
  + the created row. [req.qekrer] [req.f88huo]
* `UpdateHandler(db) http.HandlerFunc` — loads row, 404 if missing or not owned, applies
  provided fields (name/display_token/spec/pinned/sort_order), persists, returns the row.
  Serves edits, pin/unpin, and reorder. [req.nf14cm] [req.0paub8]
* `DeleteHandler(db) http.HandlerFunc` — loads row, ownership check, deletes, 204.
  [req.nf14cm]

Note on the pinned cap: the "max pinned in top bar" limit [req.nf14cm] is enforced
client-side (the top bar decides how many pills fit and collapses the rest into the
overlay [req.0paub8]); the server stores `pinned`/`sort_order` without a hard cap.

### MODIFY `internal/server/server.go`

Register routes next to the hosts block, each wrapped in `jwtMiddleware` only: [req.p84b62]

```
GET    /api/v1/quick-keys        -> quickkeys.ListHandler
POST   /api/v1/quick-keys        -> quickkeys.CreateHandler
PUT    /api/v1/quick-keys/{id}   -> quickkeys.UpdateHandler
DELETE /api/v1/quick-keys/{id}   -> quickkeys.DeleteHandler
```

---

## Frontend

### CREATE `web/src/lib/quick-keys.ts`

Pure functions — the encoding/preset core, no React. [req.d4hetp]

* `PRESET_QUICK_KEYS` — the built-in, non-persisted library: ctrl+c/d/z/l/a/e, esc, tab,
  arrows [req.zvc5oo], plus f1–f12, home, end, page up/down [req.gmwimk]. Each entry is a
  `{ name, display_token, spec }` value using the same `spec` shape as saved keys.
* `encodeStep(step): Uint8Array` — resolves one step to PTY bytes:
  * combo: ctrl+letter → `letter.toUpperCase().charCodeAt(0) - 64` (ctrl+c → `0x03`);
    esc → `0x1b`; tab → `0x09`; arrows/home/end/pgup/pgdn/F-keys → their xterm escape
    sequences; shift/alt fold into the sequence where representable.
  * literal: UTF-8 bytes of `text`, plus `0x0d` when `enter` is set.
* `encodeSpec(spec): Uint8Array` — concatenates `encodeStep` over the step array (macros).
  [req.vybd1f]
* `previewSpec(spec): string` — human-readable hex/escape rendering for the builder's
  live preview (e.g. `\x03`). [req.8c4lko]
* Scope guard: only representable combos are constructible; OS-only chords like
  ctrl+alt+del have no encoding path and are not offered. [req.d4hetp]

### MODIFY `web/src/lib/api.ts`

CREATE client functions mirroring the existing `*Host` helpers:
`listQuickKeys()`, `createQuickKey(body)`, `updateQuickKey(id, body)`,
`deleteQuickKey(id)`. Reorder and pin/unpin are expressed as `updateQuickKey` calls.
[req.ni8xi0] [req.nf14cm]

### CREATE `web/src/hooks/useQuickKeys.ts`

Loads the user's quick keys once and exposes `{ quickKeys, presets, pinned, create,
update, remove, reorder, togglePin }`. Merges `PRESET_QUICK_KEYS` (read-only) with the
persisted list for display in the overlay; `pinned` is the ordered subset flagged for the
top bar. State updates optimistically then reconciles with the API. [req.ni8xi0]
[req.nwl6lm]

### CREATE `web/src/hooks/useVisualViewport.ts`

Subscribes to `window.visualViewport` `resize`/`scroll` events and returns the current
viewport height and keyboard inset. Isolated so the fiddly iOS Safari behavior lives in
one place. This is the riskiest piece and is deliberately its own unit. [req.wom428]
[req.4tzctb]

### CREATE `web/src/components/QuickKeysOverlay.tsx`

Dialog (built on the existing `ui/alert-dialog` / dialog primitives) with two sections:
[req.2obqhe]

* **Send / library** — grid of preset + saved quick keys; clicking one calls the
  injected `onSend(spec)` and closes/returns focus to the terminal. Also renders any
  pinned keys that overflowed the top bar. [req.zvc5oo] [req.gmwimk] [req.0paub8]
* **Builder** — modifier checkboxes (ctrl/alt/shift) + base-key selector, or a
  literal-string field with an "append Enter" toggle, plus a multi-step list for macros;
  shows `previewSpec` live; Save persists via `useQuickKeys.create`/`update`. [req.pxhe1e]
  [req.8c4lko] [req.vybd1f]
* **Manage** — list of saved keys with edit / delete / drag-reorder / pin toggle wired to
  `update`/`remove`/`reorder`/`togglePin`; edits `name` + `display_token`. [req.xrhovh]
  [req.qekrer] [req.nf14cm]

### CREATE `web/src/components/SessionTopBar.tsx`

The shared top bar, laid out left→right: session name (far left) · connection status
(connected/disconnected/authenticating) · pinned quick-key pills · (far right) keyboard
icon that opens `QuickKeysOverlay` · connect/disconnect button. [req.fbzyn2]

* Pins render as `display_token` pills; on click they call `onSendKey(spec)`.
  [req.qekrer]
* Overflow: pills are laid out in a width-measured flex row; those that don't fit are not
  wrapped — a count/indicator routes them into the overlay instead. [req.0paub8]
* On mobile the same bar hosts the hamburger (details) and the keyboard icon. [req.ag52fu]

### MODIFY `web/src/components/SSHTerminal.tsx`

Converted from a self-contained connect/disconnect widget into an always-present terminal
whose connection is driven by the parent.

* Convert to `forwardRef` + `useImperativeHandle` exposing `{ connect, disconnect,
  sendKeys(spec), focus }`. `sendKeys` runs `encodeSpec` and calls
  `sshClientRef.current.sendInput`, then `xtermRef.current.focus()` so focus returns to
  the terminal after every quick key. [req.72jxmp] [req.2obqhe]
* Add `onStatusChange(status)` prop; forward the ssh-client `"status"` events up so
  `SessionTopBar` can render live status. Removes the need for the in-terminal Connect/
  Close buttons. [req.fbzyn2] [req.b26nmc]
* **Auto-connect** on mount when a host is present. The FROST-locked path is unchanged:
  it still surfaces `WebAuthnDialog` and runs the WebAuthn ceremony behind the dialog
  button — auto-connect only triggers the attempt, never calls `navigator.credentials.get()`
  without the user gesture. [req.oiqfu6] [req.q7qqoa]
* **Auto-reconnect**: track a `userDisconnectedRef`. On a `"status"` transition to
  `disconnected`/`error` that was not user-initiated, schedule a reconnect (with simple
  backoff); `disconnect()` sets the ref so explicit disconnects do not reconnect.
  [req.jy9djs]
* **Keyboard-aware sizing**: consume `useVisualViewport`; the terminal container height is
  derived from the visual viewport minus the top bar, and on change it calls
  `fitAddon.fit()` + `sshClientRef.current.resize(rows, cols)`. [req.wom428] [req.4tzctb]
  [req.bbdhtc]

### MODIFY `web/src/pages/SessionDetailPage.tsx`

Rebuild the layout around the `md` breakpoint using the app's existing Tailwind
conventions and `Sheet`. [req.t1sqqr]

* Remove the "Connect"/"Close Terminal" buttons and the click-to-open gate; the terminal
  is always mounted and auto-connects. [req.b26nmc] [req.oiqfu6]
* Render `SessionTopBar` at the top on all sizes; the terminal fills remaining space.
  [req.fbzyn2] [req.zalpuc] [req.bbdhtc]
* **Desktop (`md:` and up)**: a left-hand details panel (`md:block`) holding the existing
  fields — name, host, started, last ping, ended, user id, status, metadata — with the
  session hash demoted from the title into a normal field. Terminal takes the rest.
  [req.3e9fsi] [req.33t14v] [req.zalpuc]
* **Mobile (`< md`)**: details panel hidden; a hamburger `SheetTrigger` in the top bar
  opens a `Sheet` (reusing the dashboard pattern) containing the same detail fields. Only
  top bar + terminal are visible. [req.ag52fu] [req.bcu4b3] [req.33t14v]
* Wire an `SSHTerminal` ref so `SessionTopBar` pins and the overlay call
  `terminalRef.current.sendKeys(spec)`, and the connect/disconnect button calls
  `connect()`/`disconnect()`. [req.72jxmp] [req.fbzyn2]

---

## Testing

Per the requirements' notes, all testing is done by the agent. Reuse existing patterns:
`web/src/pages/SessionDetailPage.test.tsx` and `SSHTerminal.test.tsx` for component/unit
tests, and `integration_tests/tests/` (Playwright) for end-to-end.

* Unit — `web/src/lib/quick-keys.ts`: `encodeSpec` byte-accuracy for presets (ctrl+c →
  `0x03`, esc, arrows, F-keys), macro concatenation, and literal+Enter. [req.zvc5oo]
  [req.gmwimk] [req.vybd1f]
* Unit — `SessionDetailPage`: hash renders as a field not the title; details live in the
  Sheet on mobile and the side panel on desktop; no Connect/Close buttons. [req.33t14v]
  [req.b26nmc] [req.3e9fsi] [req.ag52fu]
* Unit — `SSHTerminal`: auto-connect fires on mount; explicit disconnect suppresses
  reconnect while an unsolicited drop triggers it; `sendKeys` calls `sendInput` then
  refocuses. [req.oiqfu6] [req.jy9djs] [req.72jxmp]
* Integration — Quick Keys CRUD is scoped to the authenticated user (a second user cannot
  see or mutate another's keys); pinned keys appear across sessions. [req.p84b62]
  [req.ni8xi0]
* Integration — sending a quick key over a live session injects the expected bytes into
  the PTY. [req.2obqhe]
