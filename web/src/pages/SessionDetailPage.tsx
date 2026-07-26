import { useState, useEffect, useCallback, useRef } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { getSession, listSessions } from "@/lib/api"
import { useSessionUpdates } from "@/hooks/useSessionUpdates"
import { useQuickKeys } from "@/hooks/useQuickKeys"
import { SSHTerminal } from "@/components/SSHTerminal"
import { SessionTopBar } from "@/components/SessionTopBar"
import { QuickKeysOverlay } from "@/components/QuickKeysOverlay"
import { SessionDetails, SessionDetailPanel } from "@/components/SessionDetailPanel"
import { useVisualViewport } from "@/hooks/useVisualViewport"
import type { TerminalHandle } from "@/components/SSHTerminal"
import type { Session, SessionUpdate, ConnectionStatus } from "@/types/api"
import { Menu } from "lucide-react"

type Status = ConnectionStatus

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const terminalRef = useRef<TerminalHandle>(null)
  const topBarRef = useRef<HTMLDivElement>(null)
  const [session, setSession] = useState<Session | null>(null)
  // Full list of sessions, shown in the desktop panel's "Sessions" tab. Seeded
  // from listSessions() and kept live via the session-updates WebSocket.
  const [sessions, setSessions] = useState<Session[]>([])
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

  // Load the full session list once for the Sessions tab. Mirrors
  // DashboardPage.loadSessions; the WebSocket keeps it fresh afterwards.
  const loadSessions = useCallback(async () => {
    try {
      const data = await listSessions()
      setSessions(data ?? [])
    } catch (err) {
      console.error("Failed to load sessions:", err)
      setSessions([])
    }
  }, [])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  const handleUpdate = useCallback((update: SessionUpdate) => {
    // Keep the currently-viewed session in sync.
    if (update.session_id === id) {
      setSession(update.session)
    }
    // Reconcile the Sessions-tab list from every event, using the same
    // upsert/remove rules as the dashboard so all listed sessions stay live.
    setSessions((prev) => {
      if (update.event === "end") {
        return prev.filter((s) => s.id !== update.session.id)
      }
      const exists = prev.some((s) => s.id === update.session.id)
      if (exists) {
        return prev.map((s) => (s.id === update.session.id ? update.session : s))
      }
      return [update.session, ...prev]
    })
  }, [id])

  useSessionUpdates(handleUpdate)

  // Navigate to another session's detail URL. The route param change drives
  // loadSession (refetch) and, if the host differs, SSHTerminal reconnects.
  const handleSelectSession = useCallback((sessionId: string) => {
    navigate(`/sessions/${sessionId}`)
  }, [navigate])

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
        // On mobile the bar renders last so it sits at the bottom of the
        // (visual-viewport-sized) screen — reachable by thumb, and kept just
        // above the on-screen keyboard when it opens. On desktop it stays on
        // top in source order.
        <div ref={topBarRef} className="order-last md:order-none">
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
                  <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Details">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left">
                  <SheetHeader>
                    <SheetTitle>Session Details</SheetTitle>
                  </SheetHeader>
                  {/* Connect/Disconnect lives here on mobile (it's hidden in
                      the top bar below the md breakpoint). */}
                  <div className="mt-4">
                    {status === "disconnected" || status === "error" ? (
                      <Button
                        variant="outline"
                        className="w-full h-11"
                        onClick={() => terminalRef.current?.connect()}
                      >
                        Connect
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="w-full h-11 text-destructive"
                        onClick={() => terminalRef.current?.disconnect()}
                      >
                        Disconnect
                      </Button>
                    )}
                  </div>
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
            <SessionDetailPanel
              session={session}
              sessions={sessions}
              currentId={session.id}
              onSelectSession={handleSelectSession}
            />
          </div>
        )}

        <div className="flex-1 min-w-0 min-h-0">
          {session.host ? (
            <SSHTerminal
              // NOTE: deliberately NOT keyed on session.id. Switching sessions
              // on the same host must REUSE the existing (already authenticated)
              // SSH connection — the terminal re-attaches tmux to the new
              // session over the same connection rather than reconnecting and
              // re-authenticating. See SSHTerminal's tmux-attach effect.
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
