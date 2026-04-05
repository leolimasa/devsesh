import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { AuthProvider } from "@/contexts/AuthContext"
import DashboardPage from "@/pages/DashboardPage"
import * as api from "@/lib/api"
import * as hooks from "@/hooks/useSessionUpdates"

vi.mock("@/hooks/useSessionUpdates", () => ({
  useSessionUpdates: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  listSessions: vi.fn(),
  deleteStaleSessions: vi.fn(),
}))

function renderDashboardPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <DashboardPage />
      </AuthProvider>
    </MemoryRouter>
  )
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(hooks.useSessionUpdates).mockReturnValue({ reconnect: vi.fn() })
  })

  it("renders loading state initially", () => {
    vi.mocked(api.listSessions).mockImplementation(() => new Promise(() => {}))

    renderDashboardPage()
    expect(screen.getByText("Loading sessions...")).toBeInTheDocument()
  })

  it("renders empty state when no sessions", async () => {
    vi.mocked(api.listSessions).mockResolvedValue([])

    renderDashboardPage()

    await waitFor(() => {
      expect(screen.getByText(/no sessions found/i)).toBeInTheDocument()
    })
  })

  it("renders sessions when loaded", async () => {
    const mockSessions = [
      {
        id: "session-1",
        user_id: 1,
        name: "Test Session",
        hostname: "localhost",
        started_at: "2024-01-01T00:00:00Z",
        last_ping_at: "2024-01-01T00:04:00Z",
        ended_at: null,
        metadata: null,
      },
    ]
    vi.mocked(api.listSessions).mockResolvedValue(mockSessions)

    renderDashboardPage()

    await waitFor(() => {
      expect(screen.getAllByText("Test Session").length).toBeGreaterThan(0)
    })
  })

  it("shows active/inactive status badges", async () => {
    const now = new Date()
    const sessions = [
      {
        id: "session-1",
        user_id: 1,
        name: "Active Session",
        hostname: "localhost",
        started_at: now.toISOString(),
        last_ping_at: now.toISOString(),
        ended_at: null,
        metadata: null,
      },
      {
        id: "session-2",
        user_id: 1,
        name: "Inactive Session",
        hostname: "localhost",
        started_at: now.toISOString(),
        last_ping_at: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
        ended_at: null,
        metadata: null,
      },
    ]
    vi.mocked(api.listSessions).mockResolvedValue(sessions)

    renderDashboardPage()

    await waitFor(() => {
      expect(screen.getAllByText("Active").length).toBeGreaterThan(0)
      expect(screen.getAllByText("Inactive").length).toBeGreaterThan(0)
    })
  })

  it("calls deleteStaleSessions when button clicked", async () => {
    const mockSessions = [
      {
        id: "session-1",
        user_id: 1,
        name: "Test Session",
        hostname: "localhost",
        started_at: "2024-01-01T00:00:00Z",
        last_ping_at: "2024-01-01T00:04:00Z",
        ended_at: null,
        metadata: null,
      },
    ]
    vi.mocked(api.listSessions).mockResolvedValue(mockSessions)
    vi.mocked(api.deleteStaleSessions).mockResolvedValue({ deleted: 1 })

    renderDashboardPage()

    await waitFor(() => {
      expect(screen.getByText("Remove Stale Sessions")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText("Remove Stale Sessions"))

    await waitFor(() => {
      expect(api.deleteStaleSessions).toHaveBeenCalled()
    })
  })

  it("shows logout button", async () => {
    vi.mocked(api.listSessions).mockResolvedValue([])

    renderDashboardPage()

    await waitFor(() => {
      expect(screen.getByText("Logout")).toBeInTheDocument()
    })
  })

  it("shows passkeys link", async () => {
    vi.mocked(api.listSessions).mockResolvedValue([])

    renderDashboardPage()

    await waitFor(() => {
      expect(screen.getByText("Passkeys")).toBeInTheDocument()
    })
  })
})
