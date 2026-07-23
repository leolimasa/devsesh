import type { Session } from "@/types/api"

// A session counts as active when it hasn't ended and has pinged within the
// last 5 minutes (a session with no ping yet is treated as freshly started,
// hence active). Shared so the dashboard and detail views agree.
export function isActive(session: Session): boolean {
  if (session.ended_at) return false
  if (!session.last_ping_at) return true

  const diffMs = Date.now() - new Date(session.last_ping_at).getTime()
  return diffMs / 60000 < 5
}
