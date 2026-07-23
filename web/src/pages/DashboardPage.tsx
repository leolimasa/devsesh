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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet"
import { Menu } from "lucide-react"
import { listSessions, deleteStaleSessions, deleteSession, getSSHCAPublicKey } from "@/lib/api"
import { useSessionUpdates } from "@/hooks/useSessionUpdates"
import { useAuth } from "@/contexts/AuthContext"
import type { Session } from "@/types/api"
import { isActive } from "@/lib/session"

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

function truncateId(id: string): string {
  return id.length > 8 ? id.substring(0, 8) + "..." : id
}

function parseMetadata(metadata: string | null): string {
  if (!metadata) return "-"
  try {
    const parsed = JSON.parse(metadata)
    return Object.keys(parsed).filter(k => k !== "session_id" && k !== "name" && k !== "start_time")
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
      setSessions(data ?? [])
    } catch (err) {
      console.error("Failed to load sessions:", err)
      setSessions([])
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

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm("Delete this session?")) return
    try {
      await deleteSession(sessionId)
      setSessions((prev) => prev.filter((s) => s.id !== sessionId))
    } catch (err) {
      console.error("Failed to delete session:", err)
    }
  }

  const handleDownloadCAKey = async () => {
    try {
      const response = await getSSHCAPublicKey()
      // The API returns the public key already in OpenSSH format (ssh-ed25519 AAAA...)
      const content = response.public_key

      const blob = new Blob([content], { type: "text/plain" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = "devsesh-ca.pub"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      if (err instanceof Error && err.message.includes("404")) {
        alert("SSH CA not configured. Register with a passkey that supports PRF.")
      } else {
        console.error("Failed to download CA key:", err)
        alert("Failed to download CA key")
      }
    }
  }

  const actions: { label: string; to?: string; onClick?: () => void }[] = [
    { label: "Hosts", to: "/hosts" },
    { label: "Download CA Key", onClick: handleDownloadCAKey },
    { label: "Remove Stale Sessions", onClick: handleDeleteStale },
    { label: "Logout", onClick: logout },
    { label: "Add Passkey", to: "/passkeys/add" },
  ]

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
        <div className="flex flex-row justify-between items-center gap-4">
          <h1 className="text-2xl font-bold">Sessions</h1>

          {/* Desktop: inline action buttons */}
          <div className="hidden sm:flex flex-wrap gap-2">
            {actions.map((action) =>
              action.to ? (
                <Button key={action.label} variant="outline" asChild>
                  <Link to={action.to}>{action.label}</Link>
                </Button>
              ) : (
                <Button key={action.label} variant="outline" onClick={action.onClick}>
                  {action.label}
                </Button>
              )
            )}
          </div>

          {/* Mobile: hamburger side menu */}
          <Sheet>
            <SheetTrigger asChild className="sm:hidden">
              <Button variant="outline" size="icon" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <div className="mt-6 flex flex-col gap-2">
                {actions.map((action) => (
                  <SheetClose asChild key={action.label}>
                    {action.to ? (
                      <Button variant="outline" className="w-full justify-start" asChild>
                        <Link to={action.to}>{action.label}</Link>
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="w-full justify-start"
                        onClick={action.onClick}
                      >
                        {action.label}
                      </Button>
                    )}
                  </SheetClose>
                ))}
              </div>
            </SheetContent>
          </Sheet>
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
                  <TableHead>Host</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Last Ping</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Metadata</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id} className="cursor-pointer">
                    <Link to={`/sessions/${session.id}`} className="contents">
                      <TableCell className="font-mono">{truncateId(session.id)}</TableCell>
                      <TableCell>{session.name || "-"}</TableCell>
                      <TableCell>{session.host?.label || session.host?.hostname || "-"}</TableCell>
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
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={(e) => handleDeleteSession(e, session.id)}
                        >
                          ✕
                        </Button>
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
            <div key={session.id} className="relative">
              <Link to={`/sessions/${session.id}`}>
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
                    <p><span className="text-muted-foreground">Host:</span> {session.host?.label || session.host?.hostname || "-"}</p>
                    <p><span className="text-muted-foreground">Started:</span> {formatDate(session.started_at)}</p>
                    <p><span className="text-muted-foreground">Last Ping:</span> {formatRelativeTime(session.last_ping_at)}</p>
                    <p><span className="text-muted-foreground">Metadata:</span> {parseMetadata(session.metadata)}</p>
                  </CardContent>
                </Card>
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 h-7 w-7 text-destructive hover:text-destructive"
                onClick={(e) => handleDeleteSession(e, session.id)}
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
