/**
 * NewSessionPage  (route: /sessions/new)
 *
 * The session-page entry point for "New session": the side panel collects a host
 * + name and navigates here with them in history state. We render a visible
 * SessionCreator so the user watches `devsesh start <name>` run and lands in a
 * live terminal. Once the host reports the session, we replace the URL with the
 * real session id — dropping the user onto the normal SessionDetailPage.
 *
 * Reaching this page without state (e.g. a manual reload, which drops history
 * state) has nothing to create, so we bounce back to the dashboard.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { SessionCreator } from "@/components/SessionCreator"
import type { Host, Session, ConnectionStatus } from "@/types/api"

interface NewSessionState {
  host?: Host
  name?: string
}

export default function NewSessionPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state as NewSessionState | null) ?? {}
  const { host, name } = state

  const [status, setStatus] = useState<ConnectionStatus>("connecting")
  const [error, setError] = useState("")
  const [topBarHeight, setTopBarHeight] = useState(48)
  const topBarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = topBarRef.current
    if (el) setTopBarHeight(el.getBoundingClientRect().height)
  }, [])

  // No host/name in history state (direct load / reload): nothing to create.
  useEffect(() => {
    if (!host || !name) navigate("/dashboard", { replace: true })
  }, [host, name, navigate])

  const handleCreated = useCallback(
    (session: Session) => {
      // Swap into the real session view. The URL now points at a persistent
      // session so a reload works; the SessionDetailPage re-attaches over SSH.
      navigate(`/sessions/${session.id}`, { replace: true })
    },
    [navigate]
  )

  const handleError = useCallback((message: string) => {
    setError(message)
  }, [])

  if (!host || !name) return null

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div ref={topBarRef} className="flex items-center gap-3 border-b px-4 py-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
          ← Dashboard
        </Button>
        <div className="min-w-0">
          <span className="font-medium">{name}</span>
          <span className="ml-2 text-sm text-muted-foreground">
            {error ? "Error" : status === "connected" ? "Starting session…" : "Connecting…"}
          </span>
        </div>
      </div>

      {error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <p className="text-destructive">{error}</p>
          <Button variant="outline" onClick={() => navigate("/dashboard")}>
            Back to Dashboard
          </Button>
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <SessionCreator
            host={host}
            name={name}
            onCreated={handleCreated}
            onError={handleError}
            onStatusChange={(s) => setStatus(s)}
            topBarHeight={topBarHeight}
          />
        </div>
      )}
    </div>
  )
}
