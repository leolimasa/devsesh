# Implementation — Better Session Details Panel

Refactor the **desktop** details panel on the session detail page into a
header (session name + status) plus a two-tab switcher (**Sessions** /
**Details**). The mobile panel (the hamburger `Sheet`) is left untouched.

## Overview of the change

Today the desktop panel (`web/src/pages/SessionDetailPage.tsx`, the
`hidden md:block w-72 …` sidebar) renders a single `SessionDetails` block. We
replace that block with a new `SessionDetailPanel` component. The same
`SessionDetails` block continues to render, unchanged, inside the mobile
`Sheet`.

To feed the Sessions tab, `SessionDetailPage` gains a list of **all** sessions
(loaded once via `listSessions()` and kept live through the existing
WebSocket), mirroring `DashboardPage`'s pattern.

No backend, SQL, or Go changes are required — the existing
`GET /api/v1/sessions` list endpoint and the session-updates WebSocket already
provide everything.

## Data structures

No new persistent data structures (no structs, enums, or SQL tables). Only
front-end React state is added:

- **`SessionDetailPage` local state (modified):** add
  `sessions: Session[]` — the full list of sessions shown in the Sessions tab,
  seeded from `listSessions()` and reconciled from WebSocket events.
- **`SessionDetailPanel` local state (created):** add
  `activeTab: "details" | "sessions"` — which tab is shown. Defaults to
  `"details"` to preserve the current landing view.

The existing `Session` and `SessionUpdate` types (`web/src/types/api.ts`) are
reused as-is; no fields are added.

## Functions / components by file

### `web/src/components/SessionDetailPanel.tsx` (created)

New desktop-only panel. Encapsulates the header, the tab switcher, and both tab
bodies. Keeps everything a pure function of its props (tab choice is the only
local state).

- **`SessionDetailPanel({ session, sessions, currentId, onSelectSession })`
  (created)** — [req.k2lrvl] [req.rzu77v] [req.5xxuhs]
  - Renders, top to bottom:
    1. `<h2>` with the session name (`session.name || session.id`), replacing
       the old "Details" heading. [req.k2lrvl]
    2. `<p data-status>` with `statusMetadata(session.metadata) || "-"`
       directly below the name, with no "Status" label. Reuses the existing
       `data-status` hook and `statusMetadata` helper for consistency with the
       dashboard/detail markup and its tests. [req.rzu77v]
    3. `<PanelTabs>` switcher (below), bound to the local `activeTab` state.
       [req.5xxuhs]
    4. The active tab body: `<SessionDetails session={session}
       showHeader={false} />` when `activeTab === "details"` [req.p4qdil], or
       `<SessionsList sessions={sessions} currentId={currentId}
       onSelect={onSelectSession} />` when `activeTab === "sessions"`.
       [req.se7ytg]
  - Uses an early `return` for the two tab bodies to keep nesting shallow.

- **`PanelTabs({ active, onChange })` (created)** — [req.5xxuhs]
  - Lightweight two-button segmented control ("Sessions" / "Details"). No
    Radix/`ui` Tabs primitive exists in the repo, so this is a small local
    component: a flex row of two `Button`s (or styled `<button>`s) where the
    active one gets an emphasized variant. Calls `onChange("sessions" |
    "details")`. Kept presentational (no internal state).

- **`SessionsList({ sessions, currentId, onSelect })` (created)** —
  [req.se7ytg] [req.7e3kbe]
  - Maps `sessions` to `SessionListItem`s, passing the 1-based index. Renders a
    vertical list. If `sessions` is empty, shows a muted "No sessions" line.
  - Ordering follows the array as delivered by the API/WebSocket reconciliation
    (same convention as the dashboard). The current session is highlighted via
    `currentId`.

- **`SessionListItem({ index, session, isCurrent, onSelect })` (created)** —
  [req.7e3kbe] [req.her0nt]
  - A clickable row showing, left to right: the `index` (starting at 1), a
    small round activity indicator, and the session name; and, below the name
    in a smaller muted font, `statusMetadata(session.metadata) || "-"`.
  - Activity indicator: a small dot colored green when `isActive(session)` is
    true and gray otherwise (reuses the existing `isActive` helper — the same
    5-second activity window the dashboard badge uses). [req.7e3kbe]
  - Clicking the row calls `onSelect(session.id)`, which the page turns into a
    navigation to that session's detail URL. [req.her0nt]
  - Rendered as a `<button>`/`role="button"` row (not an `<a>`) so selection
    goes through the page's `navigate`, giving the "immediately load" behavior
    within the SPA.

- **`SessionDetails({ session, showHeader = true })` (moved + modified)** —
  [req.p4qdil] [req.grjjp4]
  - Moved here from `SessionDetailPage.tsx` (along with its private
    `formatDate` and `formatJson` helpers) so both the page (mobile `Sheet`)
    and the panel (desktop Details tab) can import it without a circular
    dependency. Exported.
  - Modified to accept `showHeader` (default `true`). The top row (the
    `<h2>Details</h2>` + Active/Inactive `Badge`) is now wrapped in
    `{showHeader && (…)}`. Everything else — every field (Name, Status, Host,
    Session Hash, Started, Last Ping, Ended, User ID, Activity) and the
    Metadata block — is unchanged, satisfying "show all the information as it
    is in the current details pane". [req.p4qdil]
  - Mobile keeps calling it with no `showHeader` prop, so the default `true`
    preserves the current mobile rendering exactly. [req.grjjp4]

- **`formatDate` / `formatJson` (moved)** — private helpers relocated from the
  page into this file alongside `SessionDetails`; logic unchanged.

### `web/src/pages/SessionDetailPage.tsx` (modified)

- **`SessionDetails` (removed from this file)** — moved to
  `SessionDetailPanel.tsx` (see above) and re-imported. The mobile `Sheet`
  keeps rendering `<SessionDetails session={session} />` with the default
  header, so mobile is byte-for-byte unchanged. [req.grjjp4]

- **`SessionDetailPage` (modified)** — [req.se7ytg] [req.her0nt] [req.7wil29]
  - **Add `sessions` state + loader:** introduce `sessions: Session[]` state
    and a `loadSessions` callback that calls `listSessions()` on mount (in a
    `useEffect`), storing `data ?? []`. This mirrors `DashboardPage.loadSessions`.
  - **Extend `handleUpdate`:** the existing handler currently only replaces the
    single viewed `session` when `update.session_id === id`. Extend it to also
    reconcile the `sessions` list from every event, reusing the dashboard's
    upsert/remove logic: on `end` remove by id; otherwise replace an existing
    entry or prepend a new one. This keeps all listed sessions (including the
    activity indicator and per-session status) live over the WebSocket.
    [req.7wil29]
  - **Render the panel on desktop:** replace the desktop sidebar's
    `<SessionDetails session={session} />` with
    `<SessionDetailPanel session={session} sessions={sessions}
    currentId={session.id} onSelectSession={handleSelectSession} />`. The
    sidebar container classes (`hidden md:block w-72 border-r … overflow-y-auto`)
    are kept.
  - **Add `handleSelectSession`:** a `useCallback` that calls
    `navigate(\`/sessions/${sessionId}\`)`. Because the route param `id`
    changes, the existing `loadSession` effect (keyed on `id`) refetches the
    newly selected session, and `SSHTerminal` (keyed on `host.id`/`ssh_user`)
    reconnects as needed — i.e. the detail URL loads immediately. [req.her0nt]
  - The mobile `Sheet` branch is left as-is (still `SessionDetails` with its
    header). [req.grjjp4]

Note on the activity indicator freshness: `isActive` is time-based (a 5s window
vs `last_activity_at`). As on the dashboard today, the green/gray dot updates
whenever a WebSocket event triggers a re-render; we intentionally match that
existing behavior rather than adding a periodic timer. [req.7e3kbe]

### `web/src/pages/SessionDetailPage.test.tsx` (modified)

- Update/extend existing tests to reflect the desktop panel: assert the session
  name renders in place of the "Details" heading [req.k2lrvl], the status shows
  beneath it [req.rzu77v], the Sessions/Details tabs switch [req.5xxuhs], the
  Sessions tab lists sessions with 1-based index + activity dot + status
  [req.se7ytg] [req.7e3kbe], and clicking a session navigates to its detail URL
  [req.her0nt]. Keep the mobile `Sheet` assertions unchanged to guard
  [req.grjjp4].

## Requirement coverage

| Tag | Where |
| --- | --- |
| [req.grjjp4] | Mobile `Sheet` path unchanged; `SessionDetails` default `showHeader` |
| [req.k2lrvl] | `SessionDetailPanel` name `<h2>` replaces "Details" heading |
| [req.rzu77v] | `SessionDetailPanel` status `<p>` below name, no label |
| [req.5xxuhs] | `PanelTabs` + `activeTab` state |
| [req.p4qdil] | Details tab renders `SessionDetails` (`showHeader={false}`) |
| [req.se7ytg] | `SessionsList` over page `sessions` state |
| [req.7e3kbe] | `SessionListItem` — index, activity dot, name, status subline |
| [req.her0nt] | `handleSelectSession` → `navigate('/sessions/:id')` |
| [req.7wil29] | `SessionDetailPage.handleUpdate` reconciles `sessions` list live |
