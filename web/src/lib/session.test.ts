import { describe, it, expect, vi, afterEach } from "vitest"
import { isActive, statusMetadata } from "@/lib/session"
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

describe("statusMetadata", () => {
  it("returns the status value from metadata JSON", () => {
    expect(statusMetadata(JSON.stringify({ name: "s", status: "running tests" }))).toBe("running tests")
  })

  it("returns null when there is no status key", () => {
    expect(statusMetadata(JSON.stringify({ name: "s", cwd: "/tmp" }))).toBeNull()
  })

  it("returns null for empty status", () => {
    expect(statusMetadata(JSON.stringify({ status: "" }))).toBeNull()
  })

  it("returns null for null / invalid metadata", () => {
    expect(statusMetadata(null)).toBeNull()
    expect(statusMetadata("not json")).toBeNull()
  })

  it("coerces non-string status values to string", () => {
    expect(statusMetadata(JSON.stringify({ status: 42 }))).toBe("42")
  })
})
