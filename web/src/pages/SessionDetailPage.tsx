import { useState, useEffect, useCallback, useRef } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { getSession } from "@/lib/api"
import { useSessionUpdates } from "@/hooks/useSessionUpdates"
import { useQuickKeys } from "@/hooks/useQuickKeys"
import { SSHTerminal } from "@/components/SSHTerminal"
import { SessionTopBar } from "@/components/SessionTopBar"
import { QuickKeysOverlay } from "@/components/QuickKeysOverlay"
import { useVisualViewport } from "@/hooks/useVisualViewport"
import type { TerminalHandle } from "@/components/SSHTerminal"
import type { Session, ConnectionStatus } from "@/types/api"
import { Menu } from "lucide-react"

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

type Status = ConnectionStatus

function SessionDetails({ session }: { session: Session }) {
  const isActive = !session.ended_at && (
    !session.last_ping_at ||
    (new Date().getTime() - new Date(session.last_ping_at).getTime()) < 5 * 60 * 1000
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Details</h2>
        <span className={`px-2 py-0.5 rounded-full text-xs ${isActive ? "bg-green-500/20 text-green-500" : "bg-gray-500/20 text-gray-400"}`}>
          {isActive ? "Active" : "Inactive"}
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Name</h3>
          <p>{session.name || "-"}</p>
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
          <h3 className="text-sm font-medium text-muted-foreground">Status</h3>
          <p>{isActive ? "Active" : "Inactive"}</p>
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

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const terminalRef = useRef<TerminalHandle>(null)
  const topBarRef = useRef<HTMLDivElement>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [status, setStatus] = useState<Status>("disconnected")
  const [showOverlay, setShowOverlay] = useState(false)
  const [topBarHeight, setTopBarHeight] = useState(40)

  // Track the visual viewport so the whole page shrinks when the on-screen
  // keyboard opens (iOS Safari keeps 100vh unchanged while the keyboard
  // covers the bottom of the screen). Sizing the page container off the
  // visual viewport lets the flex terminal shrink to fit above the keyboard
  // instead of being overlaid by it.
  const { height: viewportHeight } = useVisualViewport()

  // Measure the real top-bar height so the terminal sizing stays in sync with
  // the bar instead of relying on a hardcoded pixel value.
  useEffect(() => {
    const el = topBarRef.current
    if (!el) return
    setTopBarHeight(el.getBoundingClientRect().height)
    if (typeof ResizeObserver === "undefined") return
    const obs = new ResizeObserver(() => {
      setTopBarHeight(el.getBoundingClientRect().height)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [session?.host])

  const { pinned, create, update, remove, reorder, togglePin, quickKeys } = useQuickKeys()

  const loadSession = useCallback(async () => {
    if (!id) return
    try {
      const data = await getSession(id)
      setSession(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load session")
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadSession()
  }, [loadSession])

  const handleUpdate = useCallback((update: { session_id: string; session: Session }) => {
    if (update.session_id === id) {
      setSession(update.session)
    }
  }, [id])

  useSessionUpdates(handleUpdate)

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading session...</p>
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-red-500">{error || "Session not found"}</p>
        <Button variant="link" onClick={() => navigate("/dashboard")}>
          Back to Dashboard
        </Button>
      </div>
    )
  }

  return (
    <div
      className="h-screen flex flex-col overflow-hidden"
      style={viewportHeight > 0 ? { height: `${viewportHeight}px` } : undefined}
    >
      {session.host && (
        <div ref={topBarRef}>
          <SessionTopBar
            sessionName={session.name || session.id}
            status={status}
            pinnedKeys={pinned}
            onSendKey={(spec) => terminalRef.current?.sendKeys(spec)}
            onOpenOverlay={() => setShowOverlay(true)}
            onConnect={() => terminalRef.current?.connect()}
            onDisconnect={() => terminalRef.current?.disconnect()}
            onBack={() => navigate("/dashboard")}
            hamburger={
              <Sheet>
                <SheetTrigger asChild className="md:hidden">
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Details">
                    <Menu className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left">
                  <SheetHeader>
                    <SheetTitle>Session Details</SheetTitle>
                  </SheetHeader>
                  <div className="mt-4">
                    <SessionDetails session={session} />
                  </div>
                </SheetContent>
              </Sheet>
            }
          />
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {session.host && (
          <div className="hidden md:block w-72 border-r bg-card p-4 overflow-y-auto flex-shrink-0">
            <SessionDetails session={session} />
          </div>
        )}

        <div className="flex-1 min-w-0 min-h-0">
          {session.host ? (
            <SSHTerminal
              ref={terminalRef}
              host={session.host}
              sessionName={session.name || session.id}
              onStatusChange={setStatus}
              topBarHeight={topBarHeight}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-4 bg-black text-muted-foreground">
              <p>No host configured for this session</p>
              <Button variant="outline" onClick={() => navigate("/dashboard")}>
                Back to Dashboard
              </Button>
            </div>
          )}
        </div>
      </div>

      <QuickKeysOverlay
        isOpen={showOverlay}
        onClose={() => setShowOverlay(false)}
        onSend={(spec) => terminalRef.current?.sendKeys(spec)}
        quickKeys={quickKeys}
        onCreate={create}
        onUpdate={update}
        onDelete={remove}
        onReorder={reorder}
        onTogglePin={togglePin}
      />
    </div>
  )
}
