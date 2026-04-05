import { useState, useEffect, useCallback } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getSession } from "@/lib/api"
import { useSessionUpdates } from "@/hooks/useSessionUpdates"
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

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

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
      <div className="min-h-screen p-4">
        <Card className="max-w-4xl mx-auto">
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">Loading session...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="min-h-screen p-4">
        <Card className="max-w-4xl mx-auto">
          <CardContent className="p-8 text-center">
            <p className="text-red-500">{error || "Session not found"}</p>
            <Button variant="link" onClick={() => navigate("/dashboard")}>
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const isActive = !session.ended_at && session.last_ping_at && 
    (new Date().getTime() - new Date(session.last_ping_at).getTime()) < 5 * 60 * 1000

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => navigate("/dashboard")}>
            Back
          </Button>
          <h1 className="text-2xl font-bold">Session Details</h1>
        </div>

        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="font-mono">{session.id}</CardTitle>
              <span className={`px-3 py-1 rounded-full text-sm ${isActive ? "bg-green-500/20 text-green-500" : "bg-gray-500/20 text-gray-400"}`}>
                {isActive ? "Active" : "Inactive"}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Name</h3>
                <p>{session.name || "-"}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Hostname</h3>
                <p>{session.hostname || "-"}</p>
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
            </div>

            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Metadata</h3>
              <pre className="bg-muted p-4 rounded-md overflow-x-auto text-sm">
                {formatJson(session.metadata)}
              </pre>
            </div>

            <div className="border-t pt-4">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Terminal</h3>
              <div className="h-64 bg-black/50 rounded-md flex items-center justify-center text-muted-foreground">
                Terminal will be available here in a future update
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}