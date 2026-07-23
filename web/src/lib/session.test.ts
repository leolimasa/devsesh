import { describe, it, expect, vi, afterEach } from "vitest"
import { isActive } from "@/lib/session"
import type { Session } from "@/types/api"

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "test-session",
    user_id: 1,
    host_id: 1,
    name: "Test",
    started_at: "2024-01-01T00:00:00Z",
    last_ping_at: "2024-01-01T00:00:00Z",
    last_activity_at: null,
    ended_at: null,
    metadata: null,
    ...overrides,
  }
}

describe("isActive", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns true when last_activity_at is within 5 seconds", () => {
    const now = new Date("2024-01-01T00:00:05Z")
    vi.setSystemTime(now)
    const session = makeSession({ last_activity_at: "2024-01-01T00:00:03Z" })
    expect(isActive(session)).toBe(true)
  })

  it("returns false when last_activity_at is more than 5 seconds ago", () => {
    const now = new Date("2024-01-01T00:00:10Z")
    vi.setSystemTime(now)
    const session = makeSession({ last_activity_at: "2024-01-01T00:00:04Z" })
    expect(isActive(session)).toBe(false)
  })

  it("returns false when last_activity_at is null", () => {
    const session = makeSession({ last_activity_at: null })
    expect(isActive(session)).toBe(false)
  })

  it("returns false when session is ended", () => {
    const now = new Date("2024-01-01T00:00:05Z")
    vi.setSystemTime(now)
    const session = makeSession({
      last_activity_at: "2024-01-01T00:00:04Z",
      ended_at: "2024-01-01T00:00:02Z",
    })
    expect(isActive(session)).toBe(false)
  })

  it("returns false when ended even if activity is fresh", () => {
    const now = new Date("2024-01-01T00:00:05Z")
    vi.setSystemTime(now)
    const session = makeSession({
      last_activity_at: "2024-01-01T00:00:04Z",
      ended_at: "2024-01-01T00:00:06Z",
    })
    expect(isActive(session)).toBe(false)
  })
})
