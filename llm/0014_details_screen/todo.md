# TODO: mobile-friendly session details screen + Quick Keys

Checklist derived from `requirements.md` and `implementation.md`. Each item keeps its
`[req.*]` tags. Every phase ends with an explicit test step.

## Phase plan (dependencies & parallelism)

```
Phase A (backend)            ─┐
Phase B (encoding core)      ─┤  all three can start in parallel
Phase D (layout/terminal)    ─┘
        │            │
        ▼            │
Phase C (api+hooks) ─┘   depends on A (contract) + B (types)
        │
        ▼
Phase E (Quick Keys UI)   depends on B, C, D
        │
        ▼
Phase F (e2e integration) depends on A, C, D, E
```

* **Parallel at start:** A, B, D are independent of each other.
* **C** needs A's endpoint contract and B's types.
* **E** needs the terminal ref from D, the hooks from C, and the encoding from B.
* **F** is last — it exercises the whole stack.

---

## Phase A — Backend: Quick Keys persistence & API

Independent. Model on `internal/hosts/handler.go` and the `Host` DB CRUD.

- [ ] Create migration `sql/00018_create_quick_keys_table.sql` with the `quick_keys`
      table (per-user; stores only customizations + pin/order, no presets). [req.nwl6lm]
      [req.ni8xi0]
- [ ] Add `QuickKey` struct to `internal/db/queries.go` (Host-style JSON tags + time
      parsing). [req.qekrer]
- [ ] Add `CreateQuickKey` / `GetQuickKeysByUserID` / `GetQuickKeyByID` /
      `UpdateQuickKey` / `DeleteQuickKey` to `internal/db/queries.go`. [req.ni8xi0]
      [req.nf14cm]
- [ ] Create `internal/quickkeys/handler.go` with `ListHandler`, `CreateHandler`,
      `UpdateHandler`, `DeleteHandler`; pull `userID` from context and enforce per-user
      ownership on get/update/delete. [req.p84b62] [req.f88huo]
- [ ] Validate on create/update: non-empty `name` + `display_token`, `spec` is valid JSON
      within a length cap, short cap on `display_token`. [req.qekrer]
- [ ] Register routes in `internal/server/server.go` under `/api/v1/quick-keys`
      (GET/POST, PUT/DELETE `{id}`) wrapped in `jwtMiddleware` only — never
      `RequireSessionOwner`. [req.p84b62]
- [ ] **Test:** run `go test ./...`; then start the server and exercise the endpoints with
      `curl` (create → list → update/pin → delete) using two different users' JWTs to
      confirm keys are isolated per user. [req.p84b62] [req.ni8xi0]

## Phase B — Frontend: Quick Keys encoding core

Independent. Pure functions, no React.

- [ ] Add `QuickKey` / `QuickKeyStep` types to `web/src/types/api.ts` (matches Go JSON).
      [req.nwl6lm]
- [ ] Create `web/src/lib/quick-keys.ts` with `PRESET_QUICK_KEYS`: ctrl+c/d/z/l/a/e, esc,
      tab, arrows. [req.zvc5oo]
- [ ] Add mobile-only special/nav presets: f1–f12, home, end, page up/down. [req.gmwimk]
- [ ] Implement `encodeStep` (combo + literal) and `encodeSpec` (macro concatenation) →
      `Uint8Array` of PTY bytes; ensure only PTY-representable combos exist (no
      ctrl+alt+del path). [req.d4hetp] [req.vybd1f]
- [ ] Implement `previewSpec` producing the human-readable byte preview (e.g. `\x03`).
      [req.8c4lko]
- [ ] **Test:** unit tests for `encodeSpec` byte-accuracy (ctrl+c → `0x03`, esc, arrows,
      F-keys), macro concatenation, and literal+Enter. [req.zvc5oo] [req.gmwimk]
      [req.vybd1f]

## Phase C — Frontend: Quick Keys API client & hook

Depends on A (contract) + B (types).

- [ ] Add `listQuickKeys` / `createQuickKey` / `updateQuickKey` / `deleteQuickKey` to
      `web/src/lib/api.ts` (mirror the `*Host` helpers). [req.ni8xi0] [req.nf14cm]
- [ ] Create `web/src/hooks/useQuickKeys.ts` exposing `{ quickKeys, presets, pinned,
      create, update, remove, reorder, togglePin }`; merge read-only presets with the
      persisted list, derive `pinned` ordered subset, update optimistically. [req.nwl6lm]
      [req.ni8xi0] [req.nf14cm]
- [ ] **Test:** unit tests for `useQuickKeys` (preset+persisted merge, optimistic
      create/update/remove/reorder against a mocked api). [req.nwl6lm] [req.nf14cm]

## Phase D — Frontend: layout & terminal (independent of Quick Keys)

Independent. Uses the `md` breakpoint and the dashboard `Sheet` pattern.

- [ ] Create `web/src/hooks/useVisualViewport.ts` returning viewport height + keyboard
      inset (isolated iOS Safari handling). [req.wom428] [req.4tzctb]
- [ ] Refactor `web/src/components/SSHTerminal.tsx` to `forwardRef` +
      `useImperativeHandle` exposing `{ connect, disconnect, sendKeys, focus }`;
      `sendKeys` encodes + `sendInput` then refocuses the terminal. [req.72jxmp]
- [ ] Add `onStatusChange` prop forwarding ssh-client `"status"` events; remove the
      in-terminal Connect/Close buttons (terminal always mounted). [req.b26nmc]
- [ ] Auto-connect on mount; when FROST is locked, surface `WebAuthnDialog` and keep the
      ceremony behind the dialog button (no `get()` without a gesture). [req.oiqfu6]
      [req.q7qqoa]
- [ ] Auto-reconnect on unsolicited drop via a `userDisconnectedRef`; explicit disconnect
      suppresses reconnect. [req.jy9djs]
- [ ] Size the terminal from `useVisualViewport` and call `fitAddon.fit()` +
      `client.resize()` on change (keyboard-aware). [req.wom428] [req.4tzctb] [req.bbdhtc]
- [ ] Rebuild `web/src/pages/SessionDetailPage.tsx` layout: top bar always present;
      desktop (`md:`) left details panel; terminal fills remaining space. [req.3e9fsi]
      [req.zalpuc] [req.t1sqqr]
- [ ] Move the session hash from the title into a normal detail field alongside the
      existing fields (name, host, started, last ping, ended, user id, status, metadata).
      [req.33t14v]
- [ ] Mobile (`< md`): hide the side panel; put details behind a hamburger `Sheet`
      (dashboard pattern); show only top bar + terminal. [req.ag52fu] [req.bcu4b3]
      [req.t1sqqr]
- [ ] **Test:** unit tests — hash renders as a field not the title; details in Sheet on
      mobile / side panel on desktop; no Connect/Close buttons; auto-connect fires;
      explicit disconnect suppresses reconnect while a drop triggers it; `sendKeys` calls
      `sendInput` then refocuses. [req.33t14v] [req.b26nmc] [req.3e9fsi] [req.ag52fu]
      [req.oiqfu6] [req.jy9djs] [req.72jxmp]

## Phase E — Frontend: Quick Keys UI & top bar

Depends on B, C, D.

- [ ] Create `web/src/components/QuickKeysOverlay.tsx` — send/library section (presets +
      saved, plus overflowed pins), calling `onSend(spec)` and returning focus to the
      terminal. [req.2obqhe] [req.zvc5oo] [req.gmwimk] [req.72jxmp]
- [ ] Builder section: ctrl/alt/shift + base key, or literal string with append-Enter,
      multi-step macro list, live `previewSpec`; Save via `create`/`update`. [req.pxhe1e]
      [req.8c4lko] [req.vybd1f]
- [ ] Manage section: list saved keys with edit / delete / drag-reorder / pin toggle
      (edits `name` + `display_token`). [req.xrhovh] [req.qekrer] [req.nf14cm]
- [ ] Create `web/src/components/SessionTopBar.tsx` laid out left→right: name · status ·
      pinned pills · keyboard icon (opens overlay) · connect/disconnect button.
      [req.fbzyn2] [req.f88huo]
- [ ] Pinned pills render `display_token` and call `onSendKey(spec)`; width-measured
      overflow collapses extras into the overlay (no wrapping). [req.qekrer] [req.0paub8]
- [ ] Wire `SessionTopBar` + `QuickKeysOverlay` into `SessionDetailPage` via the terminal
      ref (`sendKeys`) and connect/disconnect handlers. [req.fbzyn2] [req.72jxmp]
- [ ] **Test:** unit tests — clicking a pin/overlay key calls `sendKeys` then refocuses;
      builder preview matches encoding; overflow routes extras to the overlay; save/
      edit/delete/reorder/pin flows update state. [req.2obqhe] [req.8c4lko] [req.0paub8]
      [req.nf14cm]

## Phase F — End-to-end integration

Depends on A, C, D, E. Playwright in `integration_tests/tests/`.

- [ ] Quick Keys CRUD is scoped to the authenticated user (second user cannot see/mutate
      another's keys). [req.p84b62]
- [ ] Pinned quick keys appear across different sessions for the same user. [req.ni8xi0]
- [ ] Sending a quick key over a live session injects the expected bytes into the PTY.
      [req.2obqhe]
- [ ] Mobile viewport: only top bar + terminal visible, details reachable via hamburger,
      terminal resizes when the on-screen keyboard appears. [req.bcu4b3] [req.ag52fu]
      [req.bbdhtc] [req.wom428]
- [ ] **Test:** run the Playwright suite (`integration_tests/integration_tests.sh`) and
      confirm all new specs pass.
