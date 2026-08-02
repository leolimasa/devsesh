# TODO — clipboard bridge

Checklist implementing `requirements.md` + `implementation.md`. Every requirement tag is covered.

## Project status

- 🟢 COMMITTED — Phase 1 — Backend: clipboard endpoint + broadcast
- 🟢 COMMITTED — Phase 2 — CLI: `devsesh copy`
- 🟢 COMMITTED — Phase 3 — tmux select-to-copy wiring
- 🟢 COMMITTED — Phase 4 — Frontend: copy buffer + pill
- 🟢 COMMITTED — Phase 5 — Frontend: paste + flush hotkey
- 🟢 COMMITTED — Phase 6 — Integration tests + docs
- 🔴 NOT STARTED — Phase 7 — Manual verification (Safari / iOS)

Legend: 🔴 NOT STARTED · 🟡 IMPLEMENTED · 🟢 COMMITTED

## Phase dependency / parallelization plan

```
Phase 1 (backend endpoint) ──┬── Phase 2 (CLI copy) ── Phase 3 (tmux wiring)      [Track A]
                             └── Phase 4 (frontend copy UI) ── Phase 5 (paste+hotkey) [Track B]
                                                                     │
Track A + Track B ───────────────────────► Phase 6 (integration tests + docs)
                                                                     │
                                                            Phase 7 (manual Safari/iOS)
```

* **Phase 1** is the foundation (the `clipboard` event shape) — nothing else can be tested end-to-end without it.
* After Phase 1, **Track A** (Phases 2→3, backend/CLI/tmux) and **Track B** (Phases 4→5, frontend) are independent and can be done in **parallel**.
* Within a track the phases are sequential (2 before 3; 4 before 5).
* **Phase 6** (integration + docs) needs both tracks complete.
* **Phase 7** (manual device verification) needs a deploy after Phase 6.

---

## Phase 1 — Backend: clipboard endpoint + broadcast

- [x] `internal/sessions/websocket.go`: add `Clipboard string \`json:"clipboard,omitempty"\`` to `SessionUpdate` [req.cp2m73]
- [x] `internal/sessions/handler.go`: add `ClipboardHandler(database, hub)` — session from `SessionFromContext` + `userID` from `UserIDFromContext` (ownership) [req.cp9v41]
- [x] `ClipboardHandler`: `http.MaxBytesReader` at `maxClipboardBytes = 256*1024`, `io.ReadAll`; overflow → `413` [req.cp5s60]
- [x] `ClipboardHandler`: reject `!utf8.Valid(body)` → `400` [req.cp5s60]
- [x] `ClipboardHandler`: broadcast `SessionUpdate{Event:"clipboard", SessionID, Clipboard}` via `hub.Broadcast(userID, …)`, return `204` [req.cp2m73]
- [x] `internal/server/server.go`: register `POST /api/v1/sessions/{session_id}/clipboard` behind `jwtMiddleware` + `RequireSessionOwner` [req.cpq8f1][req.cp9v41]
- [x] `internal/sessions/handler_test.go`: `TestClipboardHandler` — happy path broadcasts text (subscribed hub client), oversize → 413, invalid UTF-8 → 400, wrong-owner blocked [req.cpi900]
- [x] **Phase test:** `nix develop -c bash -c 'go test ./internal/sessions/... ./internal/server/... -count=1'` passes

## Phase 2 — CLI: `devsesh copy`  *(depends on Phase 1)*

- [x] `internal/client/api.go`: add `SendClipboard(sessionID, content []byte)` — raw-body `POST …/clipboard`, `Content-Type: text/plain; charset=utf-8`, `Authorization: Bearer`; surface 413/400 [req.cpq8f1][req.cp5s60]
- [x] `cmd/copy.go`: `NewCopyCmd()` (`Use:"copy"`, `NoArgs`) + `runCopy` [req.cp7a10]
- [x] `runCopy`: resolve session id from `DEVSESH_SESSION_ID` → fallback `client.GetSessionEnvCurrent(...)`; empty → clear error [req.cp3k22]
- [x] `runCopy`: `io.ReadAll(os.Stdin)`, early-reject oversize / non-UTF-8 [req.cp5s60][req.cp7a10]
- [x] `runCopy`: `LoadConfig` → `NewAPIClient(...).SendClipboard(...)`; print confirmation [req.cp3k22][req.cpq8f1]
- [x] `cmd/root.go`: register `NewCopyCmd()` [req.cp7a10]
- [x] `internal/client/api_test.go`: `TestSendClipboard` — asserts method/path/body/auth/content-type [req.cpi900]
- [x] **Phase test:** `go test ./internal/client/... ./cmd/... -count=1` passes; manual smoke — with a paired CLI in a session, `echo hi | devsesh copy` returns success (server logs the broadcast)

## Phase 3 — tmux select-to-copy wiring  *(depends on Phase 2)*

- [x] `internal/client/tmux.go`: `tmuxVersionAtLeast(major, minor)` — parse `tmux -V`, tolerate suffixes (`3.3a`) [req.cptmx2]
- [x] `internal/client/tmux.go`: `ConfigureClipboard(sessionName)` — all `set-option -t <s>` session-scoped, non-destructive [req.cptmx4]
  - [x] `set-option -t <s> mouse on` [req.cptmx3]
  - [x] tmux ≥ 3.2 → `set-option -t <s> copy-command 'devsesh copy'` [req.cptmx1][req.cptmx2]
  - [x] legacy → bind copy-mode confirm + `MouseDragEnd1Pane` to `copy-pipe-and-cancel 'devsesh copy'` [req.cptmx2]
  - [x] best-effort (log + continue); relies on PATH + `devsesh copy` session-env fallback [req.cptmx5]
- [x] `StartSession(...)`: call `ConfigureClipboard(sessionName)` after the session exists [req.cptmx1]
- [x] `NewSessionDetached(...)`: call `ConfigureClipboard(sessionName)` after creation [req.cptmx1]
- [x] `internal/client/tmux_test.go`: `TestTmuxVersionAtLeast`; + real-tmux test asserting `tmux show-options -t <s> copy-command` == `devsesh copy` (skip if tmux < 3.2/absent) [req.cptmx1][req.cptmx2][req.cpi900]
- [x] **Phase test:** `go test ./internal/client/... -count=1` passes; manual — start a devsesh session and confirm `tmux show-options -t <name> copy-command` and `mouse` are set

## Phase 4 — Frontend: copy buffer + pill  *(depends on Phase 1; parallel with Track A)*

- [x] `web/src/types/api.ts`: add `"clipboard"` to `SessionUpdate.event` union + optional `clipboard?: string` [req.cp2m73][req.cp8h19]
- [x] `web/src/lib/clipboard.ts`: `writeClipboard(text)` (sync-callable `navigator.clipboard.writeText`) [req.cp6w38]
- [x] `web/src/lib/clipboard.ts`: `readClipboard()` (`navigator.clipboard.readText`) [req.ps7q62]
- [x] `web/src/lib/utils.ts`: `isMac()` platform sniff (⌘V vs Ctrl+Shift+V; ⌘⇧C vs Ctrl+Shift+C) [req.ps3d14][req.cp1x66]
- [x] `SessionDetailPage.tsx`: clipboard buffer state `{text,bytes}|null` (OS clipboard untouched) [req.cp8h19]
- [x] `SessionDetailPage.tsx`: `handleUpdate` branch — `event==="clipboard" && session_id===id` sets buffer, latest-only replace; ignore other sessions [req.cp8h19][req.cp0r27][req.s020ke]
- [x] `SessionDetailPage.tsx`: `handleCopyClipboard` — synchronous `writeClipboard(text)`, then "Copied"/clear; on reject keep + error [req.cp6w38][req.cp1n84]
- [x] `SessionDetailPage.tsx`: `handleDismissClipboard` — clear without writing
- [x] `SessionDetailPage.tsx`: pass `clipboard`/`onCopyClipboard`/`onDismissClipboard` to `SessionTopBar` [req.cp4t55]
- [x] `SessionTopBar.tsx`: props + dismissible pill `Clipboard ready · {size} · [Copy]`, Copy `onClick`→gesture write, "Copied ✓" flash [req.cp4t55][req.cp1n84]
- [x] vitest `SessionTopBar` — pill renders, Copy calls handler, "Copied" state [req.cpi900]
- [x] vitest buffer/`handleUpdate` — current-session event sets+replaces buffer (latest-only); other-session ignored [req.cp8h19][req.cp0r27][req.cpi900]
- [x] **Phase test:** `cd web && npx tsc --noEmit && npx vitest run src/components/SessionTopBar* src/pages/SessionDetailPage*` green

## Phase 5 — Frontend: paste + flush hotkey  *(depends on Phase 4)*

- [x] `SSHTerminal.tsx`: add `onClipboardHotkey?: () => void` prop [req.cp1x66][req.mi5osv]
- [x] `SessionDetailPage.tsx`: pass `handleCopyClipboard` as `onClipboardHotkey` (sync callback preserves gesture) [req.cp1x66][req.mi5osv]
- [x] `SSHTerminal.tsx`: `term.attachCustomKeyEventHandler(...)` fires only when terminal focused [req.ps2k05]
  - [x] Paste — ⌘V / Ctrl+Shift+V → preventDefault, `readClipboard()` → `term.paste(text)` (bracketed-paste) [req.ps3d14][req.ps7q62][req.ps9b40]
  - [x] Paste — no-op on empty/denied read [req.ps2k05]
  - [x] Flush hotkey — ⌘⇧C / Ctrl+Shift+C → sync `onClipboardHotkey?.()`, return `false` [req.cp1x66]
  - [x] Paste source is the real OS clipboard only, no internal buffer [req.tq9kup]
- [x] Confirm the design properties are realized: synchronous gesture write works Safari/iOS + PWA, no native runtime, Safari/PWA untouched [req.zeb8sj][req.objbhh][req.zjvsjy]
- [x] vitest `SSHTerminal` — custom key handler triggers paste (`readClipboard`→`term.paste`) and flush hotkey (`onClipboardHotkey`) on the right combos when focused
- [x] **Phase test:** `cd web && npx tsc --noEmit && npx vitest run src/components/SSHTerminal*` green

## Phase 6 — Integration tests + docs  *(depends on Phases 1–5)*

- [x] `integration_tests/tests/clipboard.spec.ts`: pair CLI, start session, open detail page, grant `clipboard-read`/`clipboard-write`
- [x] copy end-to-end — POST `…/clipboard` → pill appears → click Copy → `navigator.clipboard.readText()` == pushed text [req.cp2m73][req.cp4t55][req.cp6w38][req.cpi900]
- [x] oversize push rejected; non-active-session push shows no pill on the wrong tab [req.cp5s60][req.cp0r27]
- [x] flush hotkey — buffer pending + terminal focused, `page.keyboard` ⌘⇧C/Ctrl+Shift+C → clipboard holds text; documented fallback if synthetic-key activation is flaky [req.cp1x66][req.mi5osv]
- [x] paste — set OS clipboard, focus terminal, dispatch paste combo → text reaches remote pty (ssh-e2e/tmux harness) [req.ps3d14][req.ps9b40]
- [x] spec header states Chromium-only mechanics; Safari/iOS gesture behavior needs manual confirm [req.cpi902]
- [x] tmux copy path (stretch e2e or CLI-level) — copy-mode `copy-pipe-and-cancel`/`devsesh copy` → pill appears [req.cptmx1][req.cptmx5]
- [x] README / `doc/`: document `devsesh copy`, Copy pill + flush hotkey, paste (⌘V / Ctrl+Shift+V), "one tap per copy on Safari/iOS" [req.cpi903]
- [x] **Phase test (completion gate):** `nix develop -c ./build.sh` then full Playwright suite green, and full `go test ./internal/...` + `vitest run` green — task complete only when ALL unit + integration tests pass [req.cpi900][req.cpi901]

## Phase 7 — Manual verification (Safari / iOS)  *(depends on a deploy after Phase 6)*

Cannot be automated (Chromium can't reproduce WebKit activation). Record results in `implementation.md`. [req.cpi902]

- [ ] macOS Safari PWA — `echo hello | devsesh copy` → pill → click Copy → paste shows `hello`
- [ ] macOS Safari — flush hotkey ⌘⇧C writes the clipboard
- [ ] iPhone Safari Home-Screen PWA — `devsesh copy` → pill → tap Copy → paste in Notes shows text
- [ ] Paste (mac + iPhone where applicable) — ⌘V into terminal, multi-line paste does NOT auto-execute (bracketed paste)
- [ ] tmux drag-select → pill appears without running `devsesh copy` manually
- [ ] Failure surface — a blocked write shows an error and keeps the buffer (retryable)
- [ ] Record which cases passed + OS versions; never report Chromium-green as Safari/iOS-verified

## Non-goals (record only — nothing to implement)

- [ ] Confirm zero-gesture desktop copy is NOT implemented (would need native agent) [req.cpz001]
- [ ] Confirm binary/non-text clipboard is rejected by the UTF-8 check, not supported [req.cpz002]
