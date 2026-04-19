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
      host_id: 1,
      name: "Test Session",
      started_at: "2024-01-01T00:00:00Z",
      last_ping_at: "2024-01-01T00:04:00Z",
      ended_at: null,
      metadata: JSON.stringify({ project: "my-project", branch: "main" }),
      host: {
        id: 1,
        label: "My Host",
        hostname: "localhost",
        ssh_user: "root",
        ssh_port: 22,
        user_id: 1,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    }
    vi.mocked(api.getSession).mockResolvedValue(mockSession)

    renderSessionDetailPage("session-1")

    await waitFor(() => {
      expect(screen.getByText("Session Details")).toBeInTheDocument()
      expect(screen.getByText("Test Session")).toBeInTheDocument()
      expect(screen.getByText("My Host")).toBeInTheDocument()
      expect(screen.getByText("session-1")).toBeInTheDocument()
    })
  })

  it("shows terminal placeholder", async () => {
    const mockSession = {
      id: "session-1",
      user_id: 1,
      host_id: 1,
      name: "Test",
      started_at: "2024-01-01T00:00:00Z",
      last_ping_at: null,
      ended_at: null,
      metadata: null,
    }
    vi.mocked(api.getSession).mockResolvedValue(mockSession)

    renderSessionDetailPage("session-1")

    await waitFor(() => {
      expect(screen.getByText("No host configured for this session")).toBeInTheDocument()
    })
  })

  it("shows back button", async () => {
    const mockSession = {
      id: "session-1",
      user_id: 1,
      host_id: 1,
      name: "Test",
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
      host_id: 1,
      name: "Test",
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

  it("shows connect button when host is configured", async () => {
    const mockSession = {
      id: "session-1",
      user_id: 1,
      host_id: 1,
      name: "Test",
      started_at: "2024-01-01T00:00:00Z",
      last_ping_at: null,
      ended_at: null,
      metadata: null,
      host: {
        id: 1,
        label: "My Host",
        hostname: "localhost",
        ssh_user: "root",
        ssh_port: 22,
        user_id: 1,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    }
    vi.mocked(api.getSession).mockResolvedValue(mockSession)

    renderSessionDetailPage("session-1")

    await waitFor(() => {
      expect(screen.getByText("Connect")).toBeInTheDocument()
    })
  })

  it("shows connect button for inactive session with host (ended session)", async () => {
    const mockSession = {
      id: "session-2",
      user_id: 1,
      host_id: 1,
      name: "Ended Session",
      started_at: "2024-01-01T00:00:00Z",
      last_ping_at: "2024-01-01T00:30:00Z",
      ended_at: "2024-01-01T01:00:00Z",
      metadata: null,
      host: {
        id: 1,
        label: "My Host",
        hostname: "localhost",
        ssh_user: "root",
        ssh_port: 22,
        user_id: 1,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    }
    vi.mocked(api.getSession).mockResolvedValue(mockSession)

    renderSessionDetailPage("session-2")

    await waitFor(() => {
      expect(screen.getByText("Connect")).toBeInTheDocument()
      expect(screen.getByText("Inactive")).toBeInTheDocument()
    })
  })

  it("shows connect button for inactive session with host (stale ping)", async () => {
    // Session with last_ping_at more than 5 minutes ago
    const oldPingTime = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const mockSession = {
      id: "session-3",
      user_id: 1,
      host_id: 1,
      name: "Stale Session",
      started_at: "2024-01-01T00:00:00Z",
      last_ping_at: oldPingTime,
      ended_at: null,
      metadata: null,
      host: {
        id: 1,
        label: "My Host",
        hostname: "localhost",
        ssh_user: "root",
        ssh_port: 22,
        user_id: 1,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    }
    vi.mocked(api.getSession).mockResolvedValue(mockSession)

    renderSessionDetailPage("session-3")

    await waitFor(() => {
      expect(screen.getByText("Connect")).toBeInTheDocument()
      expect(screen.getByText("Inactive")).toBeInTheDocument()
    })
  })
})
