# TODO — Better Session Details Panel (0016)

Checklist to implement the desktop details-panel refactor described in
`requirements.md` and `implementation.md`. Front-end only (React/TypeScript);
no backend/SQL/Go changes.

> Do not commit to git unless explicitly told to.

## Project status

- 🟡 Phase 1 — Extract & extend `SessionDetails`
- 🟡 Phase 2 — Panel components (header, tabs, sessions list)
- 🟡 Phase 3 — Page data plumbing & wiring
- 🟡 Phase 4 — Full verification

_Legend: 🔴 NOT STARTED · 🟡 IMPLEMENTED · 🟢 COMMITTED_

---

## Phase 1 — Extract & extend `SessionDetails`

Foundation: relocate the details block so both mobile and the new desktop panel
can share it, and make its header optional.

- [x] Create `web/src/components/SessionDetailPanel.tsx` and move `SessionDetails`
      into it (along with its private `formatDate` and `formatJson` helpers) from
      `SessionDetailPage.tsx`. Export `SessionDetails`.
- [x] Add a `showHeader = true` prop to `SessionDetails`; wrap the top row
      (`<h2>Details</h2>` + Active/Inactive `Badge`) in `{showHeader && (…)}`.
      Leave all fields and the Metadata block unchanged. [req.p4qdil]
- [x] In `SessionDetailPage.tsx`, import `SessionDetails` from the new file and
      confirm the mobile `Sheet` still renders `<SessionDetails session={session} />`
      with no `showHeader` prop (default `true` → mobile unchanged). [req.grjjp4]
- [x] **Test:** run `cd web && npx vitest run src/pages/SessionDetailPage.test.tsx`
      and confirm the existing mobile-details assertions still pass (guards
      [req.grjjp4]); typecheck with `npx tsc --noEmit -p tsconfig.json`.

## Phase 2 — Panel components (header, tabs, sessions list)

Build the new desktop panel UI. Purely presentational except the tab state.

- [x] Implement `PanelTabs({ active, onChange })` — a two-button "Sessions" /
      "Details" segmented control; active button emphasized; presentational
      (no internal state). [req.5xxuhs]
- [x] Implement `SessionListItem({ index, session, isCurrent, onSelect })` — a
      clickable `<button>`/`role="button"` row showing the 1-based `index`, a
      small round activity dot (green when `isActive(session)`, gray otherwise),
      the session name; and below the name in a smaller muted font
      `statusMetadata(session.metadata) || "-"`. Clicking calls
      `onSelect(session.id)`. Highlight when `isCurrent`. [req.7e3kbe] [req.her0nt]
- [x] Implement `SessionsList({ sessions, currentId, onSelect })` — maps
      `sessions` to `SessionListItem`s with 1-based index; empty state shows a
      muted "No sessions" line. [req.se7ytg]
- [x] Implement `SessionDetailPanel({ session, sessions, currentId, onSelectSession })`
      with local `activeTab: "details" | "sessions"` state (default `"details"`):
  - [x] Header `<h2>` = `session.name || session.id` (replaces "Details" heading). [req.k2lrvl]
  - [x] `<p data-status>` = `statusMetadata(session.metadata) || "-"` directly
        below the name, no "Status" label. [req.rzu77v]
  - [x] `<PanelTabs>` bound to `activeTab`. [req.5xxuhs]
  - [x] Active tab body via early returns: `SessionDetails` with
        `showHeader={false}` for "details" [req.p4qdil]; `SessionsList` for
        "sessions" [req.se7ytg].
- [x] **Test:** add/extend `SessionDetailPage.test.tsx` (or a dedicated
      `SessionDetailPanel.test.tsx`) covering: name renders as header
      [req.k2lrvl], status shows beneath with no label [req.rzu77v], tab switch
      toggles bodies [req.5xxuhs], Details tab shows the fields [req.p4qdil],
      Sessions tab lists items with index + activity dot + status subline
      [req.se7ytg] [req.7e3kbe]. Run `npx vitest run` for the affected files +
      `npx tsc --noEmit`.

## Phase 3 — Page data plumbing & wiring

Feed the Sessions tab with a live list and wire selection/navigation.

- [x] In `SessionDetailPage`, add `sessions: Session[]` state and a
      `loadSessions` callback calling `listSessions()` on mount (store
      `data ?? []`), mirroring `DashboardPage.loadSessions`. [req.se7ytg]
- [x] Extend `handleUpdate` to reconcile the `sessions` list from every
      WebSocket event (upsert on non-`end`, remove on `end`) in addition to
      replacing the viewed `session`. [req.7wil29]
- [x] Add `handleSelectSession` (`useCallback`) → `navigate(\`/sessions/${id}\`)`;
      rely on the existing `loadSession` effect (keyed on `id`) to refetch and
      on `SSHTerminal` (keyed on host) to reconnect. [req.her0nt]
- [x] Replace the desktop sidebar's `<SessionDetails …>` with
      `<SessionDetailPanel session={session} sessions={sessions}
      currentId={session.id} onSelectSession={handleSelectSession} />`; keep the
      sidebar container classes (`hidden md:block w-72 border-r … overflow-y-auto`). [req.k2lrvl]
- [x] **Test:** extend `SessionDetailPage.test.tsx` to cover: clicking a session
      in the Sessions tab navigates to its detail URL [req.her0nt], and a
      WebSocket update mutates a listed session's status/activity [req.7wil29].
      Run `npx vitest run src/pages/SessionDetailPage.test.tsx` + `npx tsc --noEmit`.

## Phase 4 — Full verification

- [x] Run the whole web unit suite: `cd web && npm run test` (all vitest green).
- [x] Build the app to confirm the bundle compiles:
      `nix develop -c ./build.sh` (or `cd web && npm run build`).
- [x] Desktop end-to-end coverage via Playwright:
      `integration_tests/tests/session-detail-panel.spec.ts` (2 tests, both
      green) — Details-tab fields render correctly, panel header shows
      name + live status, websocket 'meta' updates the Status field + header
      live, Sessions tab lists all sessions with 1-based index / activity dot /
      status subline, a websocket update lands on the RIGHT row only, a real
      activity event flips the dot, and clicking a row loads that session's
      detail URL. Ran under a real browser + dockerized SSH + tmux.
      [req.grjjp4] [req.k2lrvl] [req.rzu77v] [req.5xxuhs] [req.p4qdil]
      [req.se7ytg] [req.7e3kbe] [req.her0nt] [req.7wil29]
- [x] Regression: existing `session.spec.ts` (12 tests) still green after the
      desktop panel refactor.
- [x] (Before any eventual deploy — not part of this task) note that navigating
      between sessions reconnects the terminal; if the terminal path is touched,
      run the integration suite (`ssh-e2e`, `quick-keys`) per project rules.

---

## Phase dependency & parallelization plan

```
Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4
   └──────────────────► (Phase 3 data plumbing can start in parallel)
```

- **Phase 1** is the foundation — must land first (Phase 2's Details tab and the
  page both import the relocated `SessionDetails`).
- **Phase 2** depends on Phase 1 (needs `SessionDetails` moved + `showHeader`).
  *Within* Phase 2, `PanelTabs`, `SessionListItem`/`SessionsList`, and the
  header can be built **in parallel** — they are independent leaf components;
  `SessionDetailPanel` composes them last.
- **Phase 3** depends on Phase 2 for the final render wiring, **but** its data
  work (adding `sessions` state, `loadSessions`, extending `handleUpdate`,
  `handleSelectSession`) has no dependency on the panel components and can be
  done **in parallel with Phase 2**; only the `<SessionDetailPanel …>` swap must
  wait for Phase 2.
- **Phase 4** depends on Phases 1–3 all being complete.

**Suggested execution:** do Phase 1 → then run Phase 2 (parallel leaf
components) alongside Phase 3's data plumbing → merge with the panel swap →
Phase 4.

## Requirement coverage

| Tag | Phase(s) |
| --- | --- |
| [req.grjjp4] | 1, 4 |
| [req.k2lrvl] | 2, 3 |
| [req.rzu77v] | 2 |
| [req.5xxuhs] | 2 |
| [req.p4qdil] | 1, 2 |
| [req.se7ytg] | 2, 3 |
| [req.7e3kbe] | 2 |
| [req.her0nt] | 2, 3 |
| [req.7wil29] | 3 |
