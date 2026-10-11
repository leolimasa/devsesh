import type { Session } from "@/types/api"

// Mirrors the server limits (internal/sessions/tags.go). The server is the
// authority; these only give the user an early, friendly error.
export const MAX_TAG_LENGTH = 32
export const MAX_TAGS = 20

const FILTER_STORAGE_KEY = "tagFilter"

// A session's tags, tolerating older/partial data where the field is absent.
export function sessionTags(session: Session): string[] {
  return session.tags ?? []
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

// Every tag in use across the sessions, unique ignoring case (first spelling
// wins) and sorted for a stable dropdown.
export function allTags(sessions: Session[]): string[] {
  const seen = new Map<string, string>()
  for (const s of sessions) {
    for (const t of sessionTags(s)) {
      const key = t.toLowerCase()
      if (!seen.has(key)) seen.set(key, t)
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

export type TagCheck = { ok: true; tag: string } | { ok: false; error: string }

// Validate a tag the user typed against the ones the session already has.
// Characters are counted as code points so an emoji counts as one.
export function checkNewTag(raw: string, existing: string[]): TagCheck {
  const tag = raw.trim()
  if (tag === "") return { ok: false, error: "Type a tag first" }
  if ([...tag].length > MAX_TAG_LENGTH) {
    return { ok: false, error: `Tags can be up to ${MAX_TAG_LENGTH} characters` }
  }
  const isControl = (ch: string) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127
  if ([...tag].some((ch) => ch === "," || isControl(ch))) {
    return { ok: false, error: "Tags cannot contain commas" }
  }
  if (existing.some((t) => same(t, tag))) {
    return { ok: false, error: "That tag is already on this session" }
  }
  if (existing.length >= MAX_TAGS) {
    return { ok: false, error: `A session can have at most ${MAX_TAGS} tags` }
  }
  return { ok: true, tag }
}

// The saved filter can name tags that no longer exist (the last session using
// one was deleted). Those are ignored so the list never goes empty because of a
// tag nobody can see or untick.
export function effectiveFilter(selected: string[], available: string[]): string[] {
  return available.filter((a) => selected.some((s) => same(s, a)))
}

// A session passes when it has ANY of the selected tags. An empty selection
// means "no filter".
export function filterByTags(sessions: Session[], selected: string[]): Session[] {
  if (selected.length === 0) return sessions
  return sessions.filter((s) => sessionTags(s).some((t) => selected.some((f) => same(f, t))))
}

// Turn a reorder of the VISIBLE (filtered) sessions into a full ordering.
// Hidden sessions keep their exact slots; the visible ones are placed, in their
// new relative order, into the slots the visible ones already occupied. With no
// filter this is the identity (visible === full).
export function mergeReorder(fullIds: string[], visibleNew: string[]): string[] {
  const visible = new Set(visibleNew)
  const result = [...fullIds]
  let next = 0
  for (let i = 0; i < result.length; i++) {
    if (visible.has(result[i])) result[i] = visibleNew[next++]
  }
  return result
}

export function loadTagFilter(): string[] {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string") : []
  } catch {
    return []
  }
}

export function saveTagFilter(selected: string[]): void {
  try {
    if (selected.length === 0) localStorage.removeItem(FILTER_STORAGE_KEY)
    else localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(selected))
  } catch {
    /* storage unavailable: the filter just will not persist */
  }
}
