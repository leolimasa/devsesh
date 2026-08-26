/**
 * NewSessionButton
 *
 * The shared "New session" affordance used by BOTH the dashboard and the
 * session-detail side panel, so the two entry points stay consistent. It renders
 * a button that opens a small dialog to pick a host and type a session name; on
 * submit it hands the chosen `{ host, name }` back to the parent via `onCreate`.
 *
 * The button is deliberately dumb about WHAT happens next — the dashboard runs
 * the create in a hidden terminal and stays put, while the session page
 * navigates into a live terminal for the new session (see SessionCreator). Both
 * funnel `devsesh start <name>` through the same SSH machinery.
 */
import { useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { listHosts } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { Host } from "@/types/api"

interface NewSessionButtonProps {
  // Called with the chosen host + trimmed name when the user confirms.
  onCreate: (host: Host, name: string) => void
  // Preselect this host in the dropdown (e.g. the current session's host).
  defaultHostId?: number
  // Button styling, so each placement can match its surroundings.
  className?: string
  variant?: React.ComponentProps<typeof Button>["variant"]
  size?: React.ComponentProps<typeof Button>["size"]
  label?: string
}

export function NewSessionButton({
  onCreate,
  defaultHostId,
  className,
  variant = "outline",
  size = "sm",
  label = "New session",
}: NewSessionButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={cn("gap-2", className)}
        onClick={() => setOpen(true)}
        aria-label="New session"
      >
        <Plus className="h-4 w-4" />
        {label}
      </Button>
      {open && (
        <NewSessionDialog
          defaultHostId={defaultHostId}
          onCancel={() => setOpen(false)}
          onSubmit={(host, name) => {
            setOpen(false)
            onCreate(host, name)
          }}
        />
      )}
    </>
  )
}

function NewSessionDialog({
  defaultHostId,
  onSubmit,
  onCancel,
}: {
  defaultHostId?: number
  onSubmit: (host: Host, name: string) => void
  onCancel: () => void
}) {
  const [hosts, setHosts] = useState<Host[] | null>(null)
  const [hostId, setHostId] = useState<number | "">(defaultHostId ?? "")
  const [name, setName] = useState("")
  const [error, setError] = useState("")

  // Load the host list once on open. Seed the selection with the caller's
  // default (the current session's host) or the first host so a submit always
  // has a target.
  useEffect(() => {
    let cancelled = false
    listHosts()
      .then((h) => {
        if (cancelled) return
        setHosts(h)
        setHostId((cur) => (cur !== "" ? cur : defaultHostId ?? h[0]?.id ?? ""))
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load hosts")
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError("Session name is required")
      return
    }
    const host = hosts?.find((h) => h.id === hostId)
    if (!host) {
      setError("Select a host")
      return
    }
    onSubmit(host, trimmed)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg p-6 w-96 shadow-lg" role="dialog" aria-label="New session">
        <h2 className="text-lg font-semibold mb-4">New Session</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="new-session-host" className="block text-sm font-medium mb-1">
              Host
            </label>
            <select
              id="new-session-host"
              value={hostId}
              onChange={(e) => setHostId(e.target.value ? Number(e.target.value) : "")}
              disabled={!hosts}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {!hosts && <option value="">Loading hosts…</option>}
              {hosts?.length === 0 && <option value="">No hosts configured</option>}
              {hosts?.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label || h.hostname}
                </option>
              ))}
            </select>
          </div>
          <div className="mb-4">
            <label htmlFor="new-session-name" className="block text-sm font-medium mb-1">
              Session name
            </label>
            <Input
              id="new-session-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. feature-x"
              autoFocus
            />
            {error && <p className="text-sm text-destructive mt-1">{error}</p>}
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!hosts || hosts.length === 0}>
              Create
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
