import type { Session } from "@/types/api"

// A session is "active" when terminal activity (output) has been observed
// within the last 5 seconds. This is driven by the `last_activity_at` field,
// which the CLI updates whenever the terminal buffer changes.
// `last_ping_at` signals liveness (the `devsesh start` process is still
// running) and is tracked independently.
export function isActive(session: Session): boolean {
  if (session.ended_at) return false
  if (!session.last_activity_at) return false

  const diffMs = Date.now() - new Date(session.last_activity_at).getTime()
  return diffMs < 5000
}
