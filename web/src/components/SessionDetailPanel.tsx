/**
 * SessionDetailPanel
 *
 * Desktop-only sidebar panel for the session detail page. Shows the current
 * session's name and self-reported status at the top, then a two-tab switcher
 * ("Sessions" / "Details"):
 *   - Details tab: all the fields of the classic details pane.
 *   - Sessions tab: a live list of every session; clicking one navigates to it.
 *
 * The mobile details view (a `Sheet`) keeps rendering `SessionDetails` directly
 * with its own header, so it is unaffected by this panel.
 */
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { isActive, statusMetadata } from "@/lib/session"
import type { Session } from "@/types/api"

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleString()
}

function formatJson(json: string | null): string {
  if (!json) return "-"
  try {
    return JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    return json
  }
}

// The classic details block. `showHeader` controls the leading
// "Details" + Active/Inactive badge row: mobile keeps it (default true), while
// the desktop panel hides it because the panel already shows name + status at
// the top.
export function SessionDetails({
  session,
  showHeader = true,
}: {
  session: Session
  showHeader?: boolean
}) {
  const active = isActive(session)

  return (
    <div className="space-y-4">
      {showHeader && (
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Details</h2>
          <Badge variant={active ? "success" : "secondary"}>
            {active ? "Active" : "Inactive"}
          </Badge>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Name</h3>
          <p>{session.name || "-"}</p>
        </div>
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Status</h3>
          <p data-status className="font-medium">{statusMetadata(session.metadata) || "-"}</p>
        </div>
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Host</h3>
          <p>{session.host?.label || session.host?.hostname || "-"}</p>
        </div>
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Session Hash</h3>
          <p className="font-mono text-sm break-all">{session.id}</p>
        </div>
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Started</h3>
          <p>{formatDate(session.started_at)}</p>
        </div>
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Last Ping</h3>
          <p>{session.last_ping_at ? formatDate(session.last_ping_at) : "-"}</p>
        </div>
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Ended</h3>
          <p>{session.ended_at ? formatDate(session.ended_at) : "-"}</p>
        </div>
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">User ID</h3>
          <p>{session.user_id}</p>
        </div>
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Activity</h3>
          <p>{active ? "Active" : "Inactive"}</p>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-1">Metadata</h3>
        <pre className="bg-muted p-3 rounded-md overflow-x-auto text-xs whitespace-pre-wrap">
          {formatJson(session.metadata)}
        </pre>
      </div>
    </div>
  )
}

type PanelTab = "sessions" | "details"

// Two-button segmented control switching between the Sessions and Details
// tabs. Purely presentational — the active tab is owned by the parent panel.
function PanelTabs({
  active,
  onChange,
}: {
  active: PanelTab
  onChange: (tab: PanelTab) => void
}) {
  const tabs: { key: PanelTab; label: string }[] = [
    { key: "sessions", label: "Sessions" },
    { key: "details", label: "Details" },
  ]
  return (
    <div className="flex gap-1 rounded-md bg-muted p-1" role="tablist">
      {tabs.map((tab) => {
        const selected = tab.key === active
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.key)}
            className={cn(
              "flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors",
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

// A single row in the Sessions tab: index (1-based), an activity dot, the
// session name, and the self-reported status below in a smaller font. Renders
// as a button so selection flows through the parent's navigation.
function SessionListItem({
  index,
  session,
  isCurrent,
  onSelect,
}: {
  index: number
  session: Session
  isCurrent: boolean
  onSelect: (sessionId: string) => void
}) {
  const active = isActive(session)
  return (
    <button
      type="button"
      data-testid={`session-item-${session.id}`}
      onClick={() => onSelect(session.id)}
      aria-current={isCurrent ? "true" : undefined}
      className={cn(
        "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent",
        isCurrent && "bg-accent"
      )}
    >
      <span className="w-5 shrink-0 text-sm tabular-nums text-muted-foreground">
        {index}
      </span>
      <span
        // Activity indicator: green when active (terminal output seen in the
        // last 5s), gray otherwise.
        className={cn(
          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
          active ? "bg-green-500" : "bg-muted-foreground/40"
        )}
        aria-label={active ? "active" : "inactive"}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{session.name || session.id}</span>
        <span data-status className="block truncate text-xs text-muted-foreground">
          {statusMetadata(session.metadata) || "-"}
        </span>
      </span>
    </button>
  )
}

// The Sessions tab body: lists every session with a 1-based index.
function SessionsList({
  sessions,
  currentId,
  onSelect,
}: {
  sessions: Session[]
  currentId: string
  onSelect: (sessionId: string) => void
}) {
  if (sessions.length === 0) {
    return <p className="text-sm text-muted-foreground">No sessions</p>
  }
  return (
    <div className="space-y-1">
      {sessions.map((session, i) => (
        <SessionListItem
          key={session.id}
          index={i + 1}
          session={session}
          isCurrent={session.id === currentId}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

// The desktop panel: name + status header, tab switcher, and the active tab.
export function SessionDetailPanel({
  session,
  sessions,
  currentId,
  onSelectSession,
}: {
  session: Session
  sessions: Session[]
  currentId: string
  onSelectSession: (sessionId: string) => void
}) {
  const [activeTab, setActiveTab] = useState<PanelTab>("details")

  return (
    <div className="space-y-4" data-testid="session-detail-panel">
      <div>
        <h2 data-testid="panel-session-name" className="text-lg font-semibold break-all">
          {session.name || session.id}
        </h2>
        <p data-testid="panel-status" data-status className="text-sm text-muted-foreground">
          {statusMetadata(session.metadata) || "-"}
        </p>
      </div>

      <PanelTabs active={activeTab} onChange={setActiveTab} />

      {activeTab === "sessions" ? (
        <SessionsList sessions={sessions} currentId={currentId} onSelect={onSelectSession} />
      ) : (
        <SessionDetails session={session} showHeader={false} />
      )}
    </div>
  )
}
