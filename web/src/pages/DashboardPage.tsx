import { useState, useEffect, useCallback } from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { listSessions, deleteStaleSessions } from "@/lib/api"
import { useSessionUpdates } from "@/hooks/useSessionUpdates"
import { useAuth } from "@/contexts/AuthContext"
import type { Session } from "@/types/api"

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleString()
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never"
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  
  if (diffMins < 1) return "Just now"
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return formatDate(dateStr)
}

function isActive(session: Session): boolean {
  if (session.ended_at) return false
  if (!session.last_ping_at) return true
  
  const lastPing = new Date(session.last_ping_at)
  const now = new Date()
  const diffMs = now.getTime() - lastPing.getTime()
  const diffMins = diffMs / 60000
  return diffMins < 5
}

function truncateId(id: string): string {
  return id.length > 8 ? id.substring(0, 8) + "..." : id
}

function parseMetadata(metadata: string | null): string {
  if (!metadata) return "-"
  try {
    const parsed = JSON.parse(metadata)
    return Object.keys(parsed).filter(k => k !== "session_id" && k !== "name" && k !== "hostname" && k !== "start_time")
      .map(k => `${k}: ${parsed[k]}`)
      .join(", ") || "-"
  } catch {
    return "-"
  }
}

export default function DashboardPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const { logout } = useAuth()

  const loadSessions = useCallback(async () => {
    try {
      const data = await listSessions()
      setSessions(data)
    } catch (err) {
      console.error("Failed to load sessions:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  const handleUpdate = useCallback((update: { event: string; session: Session }) => {
    setSessions((prev) => {
      const exists = prev.find(s => s.id === update.session.id)
      if (update.event === "end" || update.event === "delete") {
        return prev.filter(s => s.id !== update.session.id)
      }
      if (exists) {
        return prev.map(s => s.id === update.session.id ? update.session : s)
      }
      return [update.session, ...prev]
    })
  }, [])

  useSessionUpdates(handleUpdate)

  const handleDeleteStale = async () => {
    try {
      const result = await deleteStaleSessions()
      alert(`Deleted ${result.deleted} stale session(s)`)
      loadSessions()
    } catch (err) {
      console.error("Failed to delete stale sessions:", err)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen p-4">
        <Card className="max-w-6xl mx-auto">
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">Loading sessions...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h1 className="text-2xl font-bold">Sessions</h1>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleDeleteStale}>
              Remove Stale Sessions
            </Button>
            <Button variant="outline" onClick={logout}>
              Logout
            </Button>
            <Button variant="outline" asChild>
              <Link to="/settings/passkeys">Passkeys</Link>
            </Button>
          </div>
        </div>

        {sessions.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">No sessions found. Start a session with the CLI to see it here.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Last Ping</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Metadata</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id} className="cursor-pointer">
                    <Link to={`/sessions/${session.id}`} className="contents">
                      <TableCell className="font-mono">{truncateId(session.id)}</TableCell>
                      <TableCell>{session.name || "-"}</TableCell>
                      <TableCell>{formatDate(session.started_at)}</TableCell>
                      <TableCell>{formatRelativeTime(session.last_ping_at)}</TableCell>
                      <TableCell>
                        <Badge variant={isActive(session) ? "success" : "secondary"}>
                          {isActive(session) ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {parseMetadata(session.metadata)}
                      </TableCell>
                    </Link>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="md:hidden space-y-4">
          {sessions.map((session) => (
            <Link key={session.id} to={`/sessions/${session.id}`}>
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-lg font-mono">{truncateId(session.id)}</CardTitle>
                    <Badge variant={isActive(session) ? "success" : "secondary"}>
                      {isActive(session) ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="text-sm space-y-1">
                  <p><span className="text-muted-foreground">Name:</span> {session.name || "-"}</p>
                  <p><span className="text-muted-foreground">Started:</span> {formatDate(session.started_at)}</p>
                  <p><span className="text-muted-foreground">Last Ping:</span> {formatRelativeTime(session.last_ping_at)}</p>
                  <p><span className="text-muted-foreground">Metadata:</span> {parseMetadata(session.metadata)}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}