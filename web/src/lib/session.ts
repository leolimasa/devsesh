import type { Session } from "@/types/api"

// Sessions render in user-controlled order (the `seq` field, ascending).
// Returns a new sorted array; a missing seq falls back to 0 so older/partial
// data still sorts deterministically. Ties keep their relative input order.
export function sortBySeq(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
}

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

// The `status` metadata key is a free-text status a session reports about
// itself (e.g. an AI agent setting `devsesh set status "waiting for input"`).
// It's surfaced as a first-class field, so read it out of the metadata JSON.
export function statusMetadata(metadata: string | null): string | null {
  if (!metadata) return null
  try {
    const parsed = JSON.parse(metadata)
    const s = parsed?.status
    return s == null || s === "" ? null : String(s)
  } catch {
    return null
  }
}
