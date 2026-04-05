import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { AuthProvider } from "@/contexts/AuthContext"
import SessionDetailPage from "@/pages/SessionDetailPage"
import * as api from "@/lib/api"
import * as hooks from "@/hooks/useSessionUpdates"

vi.mock("@/hooks/useSessionUpdates", () => ({
  useSessionUpdates: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  getSession: vi.fn(),
}))

function renderSessionDetailPage(sessionId: string) {
  return render(
    <MemoryRouter initialEntries={[`/sessions/${sessionId}`]}>
      <AuthProvider>
        <Routes>
          <Route path="/sessions/:id" element={<SessionDetailPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  )
}

describe("SessionDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(hooks.useSessionUpdates).mockReturnValue({ reconnect: vi.fn() })
  })

  it("renders loading state initially", () => {
    vi.mocked(api.getSession).mockImplementation(() => new Promise(() => {}))

    renderSessionDetailPage("session-1")
    expect(screen.getByText("Loading session...")).toBeInTheDocument()
  })

  it("renders error when session not found", async () => {
    vi.mocked(api.getSession).mockRejectedValue(new Error("Session not found"))

    renderSessionDetailPage("nonexistent")

    await waitFor(() => {
      expect(screen.getByText("Session not found")).toBeInTheDocument()
    })
  })

  it("renders session metadata when loaded", async () => {
    const mockSession = {
      id: "session-1",
      user_id: 1,
      name: "Test Session",
      hostname: "localhost",
      started_at: "2024-01-01T00:00:00Z",
      last_ping_at: "2024-01-01T00:04:00Z",
      ended_at: null,
      metadata: JSON.stringify({ project: "my-project", branch: "main" }),
    }
    vi.mocked(api.getSession).mockResolvedValue(mockSession)

    renderSessionDetailPage("session-1")

    await waitFor(() => {
      expect(screen.getByText("Session Details")).toBeInTheDocument()
      expect(screen.getByText("Test Session")).toBeInTheDocument()
      expect(screen.getByText("localhost")).toBeInTheDocument()
      expect(screen.getByText("session-1")).toBeInTheDocument()
    })
  })

  it("shows terminal placeholder", async () => {
    const mockSession = {
      id: "session-1",
      user_id: 1,
      name: "Test",
      hostname: "localhost",
      started_at: "2024-01-01T00:00:00Z",
      last_ping_at: null,
      ended_at: null,
      metadata: null,
    }
    vi.mocked(api.getSession).mockResolvedValue(mockSession)

    renderSessionDetailPage("session-1")

    await waitFor(() => {
      expect(screen.getByText(/terminal will be available/i)).toBeInTheDocument()
    })
  })

  it("shows back button", async () => {
    const mockSession = {
      id: "session-1",
      user_id: 1,
      name: "Test",
      hostname: "localhost",
      started_at: "2024-01-01T00:00:00Z",
      last_ping_at: null,
      ended_at: null,
      metadata: null,
    }
    vi.mocked(api.getSession).mockResolvedValue(mockSession)

    renderSessionDetailPage("session-1")

    await waitFor(() => {
      expect(screen.getByText("Back")).toBeInTheDocument()
    })
  })

  it("shows active status for recent ping", async () => {
    const now = new Date()
    const mockSession = {
      id: "session-1",
      user_id: 1,
      name: "Test",
      hostname: "localhost",
      started_at: now.toISOString(),
      last_ping_at: now.toISOString(),
      ended_at: null,
      metadata: null,
    }
    vi.mocked(api.getSession).mockResolvedValue(mockSession)

    renderSessionDetailPage("session-1")

    await waitFor(() => {
      expect(screen.getByText("Active")).toBeInTheDocument()
    })
  })
})
