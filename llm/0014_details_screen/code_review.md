# Code Review — 0014 Details Screen + Quick Keys

## Summary
Rebuilds the session detail screen into a responsive top-bar + side-panel (or hamburger sheet) + always-on auto-connecting terminal, and adds a per-user, server-persisted Quick Keys feature (Go CRUD API, migration, client encoding core, hooks, overlay, and top-bar pins).

## Requirements Coverage

### General
- **[req.33t14v]** Session hash as a field — ✅ `SessionDetails` renders a "Session Hash" field (`SessionDetailPage.tsx`) and the `CardTitle` hash was removed. All required fields (name, host, started, last ping, ended, user id, status, metadata + hash) present.
- **[req.b26nmc]** Terminal always available, no close button — ✅ Terminal is always mounted; Connect/Close Terminal buttons removed from the page and the in-terminal Disconnect button removed from `SSHTerminal`.
- **[req.oiqfu6]** Auto-connect on load — ✅ `SSHTerminal` main effect calls `client.connect(...)` after `init()` when a host is present.
- **[req.q7qqoa]** Locked secrets surface WebAuthn dialog, no `get()` without gesture — ✅ Auto-connect only triggers the SSH attempt; `certificate-request` → `handleCertificateRequest` sets `showWebAuthnDialog`, and `navigator.credentials.get()` runs only inside `handleWebAuthnAuth` behind the dialog button.
- **[req.jy9djs]** Auto-reconnect unless user disconnected — ⚠️ Implemented via `userDisconnectedRef` + `maybeReconnect`, but the password-cancel path does **not** set the ref, producing a reconnect loop (see Code Review HIGH-1).
- **[req.t1sqqr]** `md` breakpoint + reuse Sheet — ✅ Uses `md:block`/`md:hidden` and the `Sheet` component for the mobile details drawer.

### Desktop
- **[req.3e9fsi]** Left details panel — ✅ `hidden md:block w-72 border-r` panel.
- **[req.fbzyn2]** Top bar layout name/status/pins/keyboard/connect — ✅ `SessionTopBar` lays out left→right as specified.
- **[req.0paub8]** Overflow pins collapse into overlay — ⚠️ Overflow measurement is present but measures against the wrong edge (see Code Review MEDIUM-1); collapse rarely triggers.
- **[req.zalpuc]** Terminal takes all remaining space — ✅ `flex-1 min-w-0 min-h-0` terminal region.

### Quick Keys
- **[req.2obqhe]** Overlay to send quick keys — ✅ `QuickKeysOverlay` Send tab + pins.
- **[req.d4hetp]** Only PTY-representable sequences — ✅ No ctrl+alt+del path; encoder only produces representable bytes.
- **[req.zvc5oo]** Presets (ctrl+c/d/z/l/a/e, esc, tab, arrows) — ✅ `PRESET_QUICK_KEYS`.
- **[req.gmwimk]** Special/nav presets (f1–f12, home, end, pgup/pgdn) — ✅ Present.
- **[req.nwl6lm]** Presets client-side, DB stores only customizations — ✅ Presets are constants; DB stores user rows only.
- **[req.pxhe1e]/[req.8c4lko]** Custom builder with modifiers + live byte preview — ✅ Builder tab + `previewSpec`. Caveat: `alt` and `shift` modifiers are largely ignored by the encoder (MEDIUM-2).
- **[req.vybd1f]** Sequences/macros + literal+Enter — ✅ Multi-step list + `encodeSpec` concatenation + literal `enter`.
- **[req.xrhovh]/[req.qekrer]/[req.nf14cm]** Manage/name/display token/edit/delete/reorder/pin cap — ✅ except no enforced pinned cap (server stores freely, top bar collapses by width — see MEDIUM-1).
- **[req.72jxmp]** Focus returns to terminal — ✅ `sendKeys` calls `xtermRef.current?.focus()`.
- **[req.f88huo]/[req.ni8xi0]** Save globally per user, shown on all sessions — ✅ Per-user rows, loaded on every session page.
- **[req.p84b62]** CRUD scoped to auth user, not session-owner middleware — ✅ Routes wrapped in `jwtMiddleware` only; ownership checked via `qk.UserID != userID`.

### Mobile
- **[req.bcu4b3]** Top bar + terminal only — ✅ Side panel hidden `< md`.
- **[req.ag52fu]** Details via hamburger — ✅ `SheetTrigger md:hidden` hamburger.
- **[req.bbdhtc]** Terminal fills screen minus top bar — ✅ Height derived from `viewportHeight - topBarHeight`.
- **[req.wom428]/[req.4tzctb]** Keyboard-aware resize via visualViewport — ✅ `useVisualViewport` drives a `fit()` + `resize()` effect. Caveats: hardcoded `topBarHeight={40}`, computed `inset` unused (LOW).

## Implementation Progress
- Data structures (SQL migration, `QuickKey` Go struct, TS types) — ✅
- Backend DB CRUD (`Create/GetByUser/GetByID/Update/Delete`) — ✅
- `internal/quickkeys/handler.go` (List/Create/Update/Delete + **added** `GetHandler`) — ✅ (Get single not in implementation.md but harmless).
- Route registration — ✅
- `web/src/lib/quick-keys.ts` (presets/encode/preview) — ✅ (contains dead code, MEDIUM-3)
- `web/src/lib/api.ts` helpers — ✅
- `useQuickKeys` hook — ✅ (optimistic; minor issues LOW-2)
- `useVisualViewport` — ✅
- `QuickKeysOverlay`, `SessionTopBar` — ✅
- `SSHTerminal` refactor (forwardRef/imperative handle/auto-connect/reconnect/sizing) — ✅ with reconnect-loop defect (HIGH-1)
- `SessionDetailPage` rebuild — ✅

## Todo Status
Completed (checked and verified in diff): all Phase A, B, D, E, F implementation items; Phase A test (go build passes, migration count updated to 18); Phase B test (21 unit tests pass).

Still pending:
- **Phase C test** (`[ ]`) — `useQuickKeys` unit tests (merge, optimistic create/update/remove/reorder) — **not written**.
- **Phase E test** (`[ ]`) — unit tests for pin/overlay send + refocus, builder preview, overflow routing, save/edit/delete/reorder/pin flows — **not written** (only covered indirectly by Playwright).

Note: the todo "Project Status" line marks the whole feature `IMPLEMENTED`, but two test items remain unchecked — the status is slightly optimistic.

## Unit test coverage
- **[req.zvc5oo]/[req.gmwimk]/[req.vybd1f]/[req.8c4lko]** — ✅ `web/src/lib/quick-keys.test.ts` (ctrl combos, esc, tab, arrows, F-keys, nav, literal+Enter, macro concat, preview, preset membership). 21 tests pass.
- **[req.33t14v]** hash as field — ✅ `SessionDetailPage.test.tsx` ("session-1" rendered, "Details" present).
- **[req.3e9fsi]/[req.ag52fu]** side panel / details presence — ⚠️ partial: tests assert the details fields render but do not assert desktop-panel-vs-Sheet placement per breakpoint (jsdom has no viewport media).
- **[req.b26nmc]** no Connect/Close buttons — ⚠️ partial: test asserts no "Connect" when host absent; does not assert the old "Close Terminal" is gone.
- **[req.oiqfu6]** auto-connect fires — ✅ `SSHTerminal.test.tsx` ("initializes SSH client on mount", asserts `connect(1,"testuser")`).
- **[req.72jxmp]** sendKeys → sendInput (+refocus) — ⚠️ partial: imperative-handle test asserts `sendInput` called; does **not** assert `xtermRef.focus()` refocus.
- **[req.fbzyn2]** status reporting — ✅ "reports status via onStatusChange".

Requirements with **no** unit test:
- **[req.jy9djs]** auto-reconnect / explicit-disconnect suppression — no test.
- **[req.q7qqoa]** WebAuthn behind gesture — no unit test.
- **[req.2obqhe]/[req.0paub8]/[req.pxhe1e]/[req.xrhovh]/[req.nf14cm]/[req.qekrer]** overlay + top-bar + manage/builder behaviors — no component unit tests (`SessionTopBar`, `QuickKeysOverlay`, `useQuickKeys` untested).
- **[req.p84b62]/[req.ni8xi0]** backend scoping — no Go unit test (integration only).
- **[req.wom428]/[req.bbdhtc]** viewport sizing — no unit test (`useVisualViewport` untested; mocked away everywhere).

## Unit test quality issues
- **`SSHTerminal.test.tsx` refocus not asserted** — the imperative-handle test calls `sendKeys([...])` and only checks `mockSendInput`. Add `expect(mockTerminalFocus).toHaveBeenCalled()` (the xterm mock already stubs `focus`). This is the direct assertion for [req.72jxmp].
- **No auto-reconnect test** — Phase D todo explicitly calls for "explicit disconnect suppresses reconnect while a drop triggers it." Add a test that: (a) fires `status("disconnected")` unsolicited and, with fake timers, asserts `connect` is called again; (b) calls `ref.current.disconnect()` then fires `status("disconnected")` and asserts `connect` is **not** re-called. This would also have caught HIGH-1's cousin.
- **`SessionDetailPage.test.tsx` placement assertions are weak** — `getAllByText("Test Session").length === 2` couples the test to "name appears in top bar + panel." Prefer querying by role/region (e.g. the top bar container vs. the details region) so the intent (breakpoint placement) is what's verified.
- **Missing tests for `useQuickKeys`, `QuickKeysOverlay`, `SessionTopBar`** (Phase C & E test items). At minimum: `useQuickKeys` optimistic create rollback on API rejection; `SessionTopBar` overflow → "+N" indicator; `QuickKeysOverlay` builder preview equals `previewSpec` and Save calls `onCreate`.

## Integration test coverage
`integration_tests/tests/quick-keys.spec.ts`:
- **[req.p84b62]** CRUD scoped to user — ⚠️ "Quick Keys CRUD via API is scoped to authenticated user" exercises full CRUD + a 401 for an invalid token, but **does not create a second user** and assert that user B cannot see/mutate user A's keys. The test name overstates what it verifies (see quality issues).
- **[req.ni8xi0]** Pinned keys across sessions — ✅ "Pinned quick keys persist across different sessions" checks the pill appears in a second session.
- **[req.2obqhe]** Sending a quick key injects bytes into PTY — ❌ No test asserts the byte injection over a live PTY. The overlay/builder tests verify UI, not that pressing a key produces bytes at the shell. The todo item is checked but the "expected bytes into the PTY" assertion is absent.
- **[req.bcu4b3]/[req.ag52fu]** Mobile top bar + hamburger — ✅ "Mobile viewport shows top bar + terminal with hamburger."
- **[req.bbdhtc]/[req.wom428]** Terminal resize on keyboard — ❌ Not actually tested; the mobile test checks layout/controls only. Playwright/headless Chromium cannot raise a soft keyboard, so `visualViewport` resize is unverified (todo item checked regardless).

Requirements without integration coverage: **[req.2obqhe]** (byte injection), **[req.wom428]/[req.4tzctb]** (keyboard resize), **[req.0paub8]** (overflow collapse), **[req.p84b62]** cross-user isolation.

## Integration test quality issues
- **Overstated scoping test** — "scoped to authenticated user" never provisions a second user/JWT. To truly cover [req.p84b62], pair a second CLI/user, create a key as user A, then GET/PUT/DELETE it with user B's token and assert 404 (ownership) — the handler already returns 404 on `qk.UserID != userID`, so this path is currently untested.
- **Heavy reliance on `page.evaluate` timer choreography** — the overlay tests drive the WebAuthn→password→connect flow with nested `setTimeout`s and fixed waits (2000ms, 1000ms, etc.). This is brittle and slow (120s timeouts). Prefer stabilizing on observable state (e.g. `expect(status).toHaveText("Connected")`) instead of blind delays.
- **`waitForTimeout(5000)` in `navigateToSession`** and other fixed sleeps — flake risk; replace with explicit locators.
- **PTY byte-injection assertion missing** — the strongest integration proof of the whole feature (send `^C` and observe `^C`/SIGINT effect in the tmux pane, or echo a literal+Enter and read it back) is not implemented despite the todo marking it done.

## Code organization issues
- **`SSHTerminal.tsx` is large (~410 lines) and mixes concerns** — WebAuthn/PRF unlock ceremony, cert request, reconnect/backoff, viewport sizing, and rendering all live in one component. The `handleWebAuthnAuth` PRF ceremony (~90 lines) is a good candidate to extract into a `lib/` helper (e.g. `unlockMasterKeyViaWebAuthn()`), which would also make it unit-testable.
- **Duplicated `parseSpec`** — the same `try { JSON.parse } catch { [] }` helper is defined in `useQuickKeys.ts` and inline in `QuickKeysOverlay.tsx` (`SendTab`). Promote a single `parseSpec` into `web/src/lib/quick-keys.ts` and import it in both.
- **Duplicated `Status` union** — `type Status = "disconnected" | ...` is declared independently in `SSHTerminal.tsx`, `SessionTopBar.tsx`, and `SessionDetailPage.tsx`. Export it once (e.g. from `SSHTerminal` or `types/api.ts`) and import.
- **Duplicated status label/color maps** — `SSHTerminal` previously rendered emoji labels; `SessionTopBar` now has `STATUS_LABELS`/`STATUS_COLORS`. Fine to keep in the bar, but consider co-locating with the shared `Status` type.
- **Backend has no `handler_test.go`** — every other CRUD package should be checked; the hosts package pattern this was modeled on is the reference. A table-driven ownership test would be small and high-value.
- **`describeStep` / `BASE_KEYS`** are UI-local but conceptually belong with the encoding core (`quick-keys.ts`) so the builder and the encoder share one source of truth for the key list.

## Code Review

### HIGH-1 — Password-cancel (and password-dialog) path triggers an auto-reconnect loop
`SSHTerminal.handlePasswordCancel` calls `sshClientRef.current.disconnect()` and `setStatus("disconnected")` but never sets `userDisconnectedRef.current = true`. The `status` event handler then sees `disconnected` with `userDisconnectedRef === false` and schedules `maybeReconnect()`, which reconnects, re-surfaces the WebAuthn/password dialogs, and loops. The integration tests literally document this ("If we 'Cancel' the password dialog the terminal disconnects and auto-reconnect reopens the dialogs — an infinite loop") and work around it rather than fixing it.
Fix:
1. In `handlePasswordCancel`, set `userDisconnectedRef.current = true` before `disconnect()`, or route it through the existing `doDisconnect()` which already sets the ref.
2. Consider treating an explicit auth cancellation as "user intent to stop," so the bar shows Disconnected with a Connect button instead of silently retrying.
3. Add the unit test described above to lock this behavior in.

### HIGH-2 — Reconnect can be scheduled during unmount / after teardown
In the main effect cleanup, `clearTimeout(reconnectTimeoutRef.current)` runs *before* `client.disconnect()`. If `disconnect()` synchronously emits a `status: "disconnected"` event and `userDisconnectedRef` is still `false`, `maybeReconnect()` schedules a **new** timer after the clear, which later fires `doConnect()`/`setStatus` on an unmounted component (React state-update-after-unmount warning; possible resurrection of a torn-down client).
Fix: set `userDisconnectedRef.current = true` at the very start of cleanup (before `disconnect()`), and/or guard `maybeReconnect`/`doConnect` with a `mountedRef`. Clearing the timer should also happen *after* disconnect, or disconnect should be marked user-initiated during teardown.

### MEDIUM-1 — Top-bar overflow measured against the wrong boundary ([req.0paub8])
`SessionTopBar.measureOverflow` compares each pill's `rect.right` to `parent.getBoundingClientRect().right`, where `parent` is the **entire top-bar flex row** — including the keyboard icon and Connect/Disconnect buttons to the right. Pills are therefore considered "fitting" even when they visually overlap those controls, so overflow-into-overlay essentially never triggers until pills exceed the whole bar width. This defeats [req.0paub8]'s "no wrapping, collapse extras."
Fix:
1. Measure against the pills container's own available width (its `clientWidth`), not the outer bar's right edge — e.g. give the pills wrapper a bounded `max-width`/`flex` region and compare pill offsets to that region's right edge.
2. After hiding overflowed pills, the layout changes; re-run measurement in a `requestAnimationFrame` (or measure with all pills visible in a hidden ghost row) to avoid one-frame flip-flop.
3. Add a component test with a fixed container width to assert the "+N" indicator appears at the expected count.

### MEDIUM-2 — `alt` and `shift` modifiers are silently dropped by the encoder ([req.8c4lko])
`encodeStep` never emits an ESC-prefix for `alt`, and `shift` only affects bare letters (uppercasing). Building e.g. `Alt+F` or `Shift+Tab` in the builder yields just `f` / `\t`, while the live preview shows the same — so the user gets a confidently-wrong result. Requirement text says "shift/alt fold into the sequence where representable."
Fix:
1. Implement `alt` as an ESC (`0x1b`) prefix before the base byte(s) (xterm meta-sends-escape convention).
2. Implement common shifted specials (e.g. Shift+Tab → `ESC [ Z` / `0x1b 0x5b 0x5a`).
3. For combinations with no representable encoding, either disable the Add button or surface a "not representable" note so the preview never lies.

### MEDIUM-3 — Dead/unreachable code in the arrow-key branch
`quick-keys.ts` `encodeStep` arrow handling contains unreachable code: inside `if (step.shift) { return bytes; <then more statements> }`, everything after the first `return bytes` is dead, and the block returns the unmodified sequence anyway. It documents an intent (shift+arrow CSI modifier) that isn't implemented.
Fix: remove the dead block entirely (arrows currently ignore shift), or implement the modified CSI form (`ESC [ 1 ; 2 A` for Shift+Up, etc.) and test it. Leaving unreachable code invites confusion.

### MEDIUM-4 — Missing DB index and FK cleanup on `quick_keys`
The migration has no index on `user_id`, yet every list query filters by it (`WHERE user_id = ? ORDER BY sort_order, id`). There is also no `ON DELETE CASCADE`, so deleting a user orphans their quick keys.
Fix:
1. Add `CREATE INDEX IF NOT EXISTS idx_quick_keys_user_id ON quick_keys(user_id);`
2. Consider `REFERENCES users(id) ON DELETE CASCADE` (matching how other per-user tables handle deletion, if enabled) — verify `PRAGMA foreign_keys` is on for it to take effect.

### LOW-1 — Hardcoded `topBarHeight={40}` and unused `inset`
`SessionDetailPage` passes a literal `topBarHeight={40}` that must stay in sync with `SessionTopBar`'s `h-10`. `useVisualViewport` computes `inset` but nothing consumes it.
Fix: measure the top bar via a ref/`ResizeObserver` and pass the real height, or export a shared constant. Either use `inset` for the keyboard-aware calculation or drop it from the hook's return to avoid implying support that isn't wired.

### LOW-2 — `useQuickKeys.reorder` drops keys not in `ids`; `keyMap.get(id)!` can throw
`reorder` replaces the whole list with only the mapped `ids`; if a caller ever passes a partial id list, other keys vanish from state. `keyMap.get(id)!` non-null-asserts and would throw on an unknown id.
Fix: build the reordered list by remapping existing keys and appending any not referenced, and guard the `get` with a filter/fallback. Current callers pass all ids, so this is latent, not active.

### LOW-3 — `sessionName={session.name}` may be empty → `tmux attach -t ""`
The terminal uses `session.name` for the tmux target while the top bar falls back to `session.name || session.id`. If `name` is empty, `tmux attach -t ""` will fail.
Fix: use the same `session.name || session.id` fallback for the tmux target (or the canonical session identifier the CLI actually names the tmux session with).

### LOW-4 — `json.NewEncoder(...).Encode(...)` errors ignored in handlers
All handlers ignore the encode error (matches existing hosts style, so low priority). Optional: log on failure for consistency with the `slog.Error` usage elsewhere.

## Code review TODO

### HIGH
- [ ] Fix password-cancel reconnect loop: set `userDisconnectedRef` in `handlePasswordCancel` (or route through `doDisconnect`) and stop the dialog-reopen loop the integration tests work around. (HIGH-1)
- [ ] Prevent reconnect scheduling during unmount/teardown; set user-disconnect intent before `disconnect()` in cleanup and/or guard with a `mountedRef`. (HIGH-2)
- [ ] Add the missing PTY byte-injection integration test for [req.2obqhe] (send `^C`/literal+Enter, observe effect in the tmux pane).

### MEDIUM
- [ ] Fix top-bar overflow measurement to use the pills region width, re-measure after hide, and add a bounded-width test. (MEDIUM-1, [req.0paub8])
- [ ] Encode `alt` (ESC prefix) and representable `shift` specials, or block non-representable combos in the builder so the preview never lies. (MEDIUM-2, [req.8c4lko])
- [ ] Remove the unreachable arrow-key `shift` block (or implement modified CSI). (MEDIUM-3)
- [ ] Add `idx_quick_keys_user_id` index and consider `ON DELETE CASCADE`. (MEDIUM-4)
- [ ] Add a true cross-user isolation integration test (user B cannot GET/PUT/DELETE user A's key → 404). ([req.p84b62])
- [ ] Add the pending Phase C (`useQuickKeys`) and Phase E (`SessionTopBar`/`QuickKeysOverlay`) unit tests; assert `sendKeys` refocuses the terminal ([req.72jxmp]) and auto-reconnect suppression ([req.jy9djs]).
- [ ] Add a Go handler test for quickkeys ownership/validation.

### LOW / FUTURE
- [ ] Replace hardcoded `topBarHeight={40}` with a measured/shared value; use or remove `useVisualViewport.inset`. (LOW-1)
- [ ] Harden `useQuickKeys.reorder` against partial id lists / unknown ids. (LOW-2)
- [ ] Use `session.name || session.id` as the tmux attach target. (LOW-3)
- [ ] Deduplicate `parseSpec`, the `Status` union, and the base-key list into shared modules. (Code organization)
- [ ] Extract the WebAuthn/PRF unlock ceremony out of `SSHTerminal` into a testable `lib/` helper. (Code organization)
- [ ] Reduce Playwright reliance on fixed `setTimeout`/`waitForTimeout` choreography; stabilize on observable state. (Integration quality)
- [ ] Reconcile the todo "Project Status: IMPLEMENTED" line with the two still-unchecked test items.
