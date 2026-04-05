import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

describe("api client", () => {
  const originalLocation = window.location

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
    Object.defineProperty(window, "location", {
      value: {
        ...originalLocation,
        href: "http://localhost:5173",
        protocol: "http:",
        host: "localhost:5173",
      },
      writable: true,
    })
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
    })
  })

  describe("fetchApi wrapper behavior", () => {
    it("adds Authorization header when token exists", async () => {
      localStorage.setItem("token", "test-token")
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ exists: true }),
      })

      const { checkUsersExist } = await import("@/lib/api")
      await checkUsersExist()

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/v1/auth/status",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        })
      )
    })

    it("redirects to login on 401", async () => {
      localStorage.setItem("token", "test-token")
      localStorage.setItem("user", JSON.stringify({ id: 1, email: "test@test.com", token: "test-token" }))
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      })

      const { checkUsersExist } = await import("@/lib/api")
      await expect(checkUsersExist()).rejects.toThrow("Unauthorized")
      expect(localStorage.getItem("token")).toBeNull()
      expect(localStorage.getItem("user")).toBeNull()
    })

    it("throws on non-ok response", async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Server error"),
      })

      const { checkUsersExist } = await import("@/lib/api")
      await expect(checkUsersExist()).rejects.toThrow("Server error")
    })

    it("returns empty object on 204", async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 204,
      })

      const { deletePasskey } = await import("@/lib/api")
      const result = await deletePasskey("cred-1")
      expect(result).toEqual({})
    })
  })

  describe("checkUsersExist", () => {
    it("calls /auth/status endpoint", async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ exists: true }),
      })

      const { checkUsersExist } = await import("@/lib/api")
      const result = await checkUsersExist()
      expect(result).toEqual({ exists: true })
    })
  })

  describe("loginBegin", () => {
    it("calls /auth/login/begin with email", async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ challenge: "abc123" }),
      })

      const { loginBegin } = await import("@/lib/api")
      const result = await loginBegin("test@example.com")
      expect(result).toEqual({ challenge: "abc123" })
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/v1/auth/login/begin",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ email: "test@example.com" }),
        })
      )
    })
  })

  describe("registerBegin", () => {
    it("calls /auth/register/begin with email", async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ challenge: "reg123" }),
      })

      const { registerBegin } = await import("@/lib/api")
      const result = await registerBegin("test@example.com")
      expect(result).toEqual({ challenge: "reg123" })
    })
  })

  describe("listSessions", () => {
    it("calls /sessions endpoint", async () => {
      const sessions = [
        { id: "1", user_id: 1, name: "Test", hostname: "localhost", started_at: "2024-01-01T00:00:00Z", last_ping_at: null, ended_at: null, metadata: null },
      ]
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(sessions),
      })

      localStorage.setItem("token", "test-token")
      const { listSessions } = await import("@/lib/api")
      const result = await listSessions()
      expect(result).toEqual(sessions)
    })
  })

  describe("getSession", () => {
    it("calls /sessions/{id} endpoint", async () => {
      const session = { id: "session-123", user_id: 1, name: "Test", hostname: "localhost", started_at: "2024-01-01T00:00:00Z", last_ping_at: null, ended_at: null, metadata: null }
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(session),
      })

      const { getSession } = await import("@/lib/api")
      const result = await getSession("session-123")
      expect(result).toEqual(session)
    })
  })

  describe("deleteStaleSessions", () => {
    it("calls DELETE /sessions/stale", async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ deleted: 3 }),
      })

      const { deleteStaleSessions } = await import("@/lib/api")
      const result = await deleteStaleSessions()
      expect(result).toEqual({ deleted: 3 })
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/v1/sessions/stale",
        expect.objectContaining({ method: "DELETE" })
      )
    })
  })

  describe("pairExchange", () => {
    it("calls /auth/pair/exchange with code", async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ token: "jwt-token" }),
      })

      localStorage.setItem("token", "test-token")
      const { pairExchange } = await import("@/lib/api")
      const result = await pairExchange("ABC123")
      expect(result).toEqual({ token: "jwt-token" })
    })
  })

  describe("listPasskeys", () => {
    it("calls /auth/passkeys endpoint", async () => {
      const passkeys = [{ id: "cred-1", created_at: "2024-01-01T00:00:00Z" }]
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(passkeys),
      })

      const { listPasskeys } = await import("@/lib/api")
      const result = await listPasskeys()
      expect(result).toEqual(passkeys)
    })
  })

  describe("deletePasskey", () => {
    it("calls DELETE /auth/passkeys/{id}", async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 204,
      })

      const { deletePasskey } = await import("@/lib/api")
      await deletePasskey("cred-1")
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/v1/auth/passkeys/cred-1",
        expect.objectContaining({ method: "DELETE" })
      )
    })
  })

  describe("getWsEndpoint", () => {
    it("returns ws URL with token", async () => {
      localStorage.setItem("token", "test-token")
      Object.defineProperty(window, "location", {
        value: {
          protocol: "http:",
          host: "localhost:5173",
        },
        writable: true,
      })

      const { getWsEndpoint } = await import("@/lib/api")
      const endpoint = getWsEndpoint()
      expect(endpoint).toBe("ws://localhost:5173/api/v1/sessions/updates?token=test-token")
    })

    it("returns wss URL for https", async () => {
      localStorage.setItem("token", "test-token")
      Object.defineProperty(window, "location", {
        value: {
          protocol: "https:",
          host: "example.com",
        },
        writable: true,
      })

      const { getWsEndpoint } = await import("@/lib/api")
      const endpoint = getWsEndpoint()
      expect(endpoint).toBe("wss://example.com/api/v1/sessions/updates?token=test-token")
    })
  })
})
