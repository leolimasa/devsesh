import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { AuthProvider } from "@/contexts/AuthContext"
import SessionDetailPage from "@/pages/SessionDetailPage"
import * as api from "@/lib/api"
import * as hooks from "@/hooks/useSessionUpdates"
import type { ReactNode } from "react"

vi.mock("@/hooks/useSessionUpdates", () => ({
  useSessionUpdates: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  getSession: vi.fn(),
  listQuickKeys: vi.fn().mockResolvedValue([]),
}))

vi.mock("@/contexts/FROSTContext", () => ({
  FROSTProvider: ({ children }: { children: ReactNode }) => children,
  useFROST: () => ({
    isActive: false,
    remainingTime: 0,
    client: null,
    initWorker: vi.fn(),
    requestCert: vi.fn().mockRejectedValue(new Error("Mock error")),
    terminate: vi.fn(),
  }),
}))

vi.mock("@/hooks/useVisualViewport", () => ({
  useVisualViewport: () => ({ height: 768, inset: 0 }),
}))

vi.mock("xterm", () => ({
  Terminal: class MockTerminal {
    loadAddon = vi.fn()
    open = vi.fn()
    write = vi.fn()
    onData = vi.fn()
    dispose = vi.fn()
    focus = vi.fn()
    rows = 24
    cols = 80
  },
}))

vi.mock("xterm-addon-fit", () => ({
  FitAddon: class MockFitAddon { fit = vi.fn() },
}))

vi.mock("@/lib/ssh-client", () => ({
  SSHClient: class MockSSHClient {
    init = vi.fn().mockResolvedValue(undefined)
    connect = vi.fn()
    disconnect = vi.fn()
    exec = vi.fn()
    sendInput = vi.fn()
    resize = vi.fn()
    resolvePassword = vi.fn()
    rejectPassword = vi.fn()
    resolveCertificate = vi.fn()
    rejectCertificate = vi.fn()
    on = vi.fn()
    off = vi.fn()
  },
}))

function renderSessionDetailPage(sessionId: string) {
  return render(
    <MemoryRouter initialEntries={[`/sessions/${sessionId}`]}>
      <AuthProvider>
        <Routes>
          <Route path="/sessions/:id" element={<SessionDetailPage />} />
          <Route path="/dashboard" element={<div>Dashboard Page</div>} />
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

  it("renders session metadata fields when loaded", async () => {
    const mockSession = {
      id: "session-1",
      user_id: 1,
      host_id: 1,
      name: "Test Session",
      started_at: "2024-01-01T00:00:00Z",
      last_ping_at: "2024-01-01T00:04:00Z",
      last_activity_at: null,
      ended_at: null,
      metadata: JSON.stringify({ project: "my-project", branch: "main" }),
      host: {
        id: 1,
        label: "My Host",
        hostname: "localhost",
        ssh_user: "root",
        ssh_port: 22,
        ssh_principal: "",
        user_id: 1,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    }
    vi.mocked(api.getSession).mockResolvedValue(mockSession)

    renderSessionDetailPage("session-1")

    await waitFor(() => {
      // Session name appears in both top bar and details panel
      expect(screen.getAllByText("Test Session").length).toBe(2)
      // Session hash as a field in details
      expect(screen.getByText("session-1")).toBeInTheDocument()
      // Host name in details
      expect(screen.getByText("My Host")).toBeInTheDocument()
      // Session details panel is present
      expect(screen.getByText("Details")).toBeInTheDocument()
    })
  })

  it("navigates back to the dashboard from the top bar", async () => {
    const mockSession = {
      id: "session-1",
      user_id: 1,
      host_id: 1,
      name: "Test Session",
      started_at: "2024-01-01T00:00:00Z",
      last_ping_at: "2024-01-01T00:04:00Z",
      last_activity_at: null,
      ended_at: null,
      metadata: null,
      host: {
        id: 1,
        label: "My Host",
        hostname: "localhost",
        ssh_user: "root",
        ssh_port: 22,
        ssh_principal: "",
        user_id: 1,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    }
    vi.mocked(api.getSession).mockResolvedValue(mockSession)

    renderSessionDetailPage("session-1")

    const backButton = await screen.findByRole("button", { name: "Back to dashboard" })
    fireEvent.click(backButton)

    await waitFor(() => {
      expect(screen.getByText("Dashboard Page")).toBeInTheDocument()
    })
  })

  it("navigates back to the dashboard when no host is configured", async () => {
    const mockSession = {
      id: "session-1",
      user_id: 1,
      host_id: 1,
      name: "Test",
      started_at: "2024-01-01T00:00:00Z",
      last_ping_at: null,
      last_activity_at: null,
      ended_at: null,
      metadata: null,
    }
    vi.mocked(api.getSession).mockResolvedValue(mockSession)

    renderSessionDetailPage("session-1")

    const backButton = await screen.findByRole("button", { name: "Back to Dashboard" })
    fireEvent.click(backButton)

    await waitFor(() => {
      expect(screen.getByText("Dashboard Page")).toBeInTheDocument()
    })
  })

  it("shows terminal placeholder when no host configured", async () => {
    const mockSession = {
      id: "session-1",
      user_id: 1,
      host_id: 1,
      name: "Test",
      started_at: "2024-01-01T00:00:00Z",
      last_ping_at: null,
      last_activity_at: null,
      ended_at: null,
      metadata: null,
    }
    vi.mocked(api.getSession).mockResolvedValue(mockSession)

    renderSessionDetailPage("session-1")

    await waitFor(() => {
      expect(screen.getByText("No host configured for this session")).toBeInTheDocument()
    })
  })

  it("does not show top bar when no host", async () => {
    const mockSession = {
      id: "session-1",
      user_id: 1,
      host_id: 1,
      name: "Test",
      started_at: "2024-01-01T00:00:00Z",
      last_ping_at: null,
      last_activity_at: null,
      ended_at: null,
      metadata: null,
    }
    vi.mocked(api.getSession).mockResolvedValue(mockSession)

    renderSessionDetailPage("session-1")

    await waitFor(() => {
      expect(screen.getByText("No host configured for this session")).toBeInTheDocument()
    })
    // Connect should NOT be visible since there's no top bar
    expect(screen.queryByText("Connect")).not.toBeInTheDocument()
  })

  it("shows active status in details panel", async () => {
    const now = new Date()
    const mockSession = {
      id: "session-1",
      user_id: 1,
      host_id: 1,
      name: "Test",
      started_at: now.toISOString(),
      last_ping_at: now.toISOString(),
      last_activity_at: now.toISOString(),
      ended_at: null,
      metadata: null,
      host: {
        id: 1,
        label: "My Host",
        hostname: "localhost",
        ssh_user: "root",
        ssh_port: 22,
        ssh_principal: "",
        user_id: 1,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    }
    vi.mocked(api.getSession).mockResolvedValue(mockSession)

    renderSessionDetailPage("session-1")

    await waitFor(() => {
      // Active badge in the details panel
      const activeBadges = screen.getAllByText("Active")
      expect(activeBadges.length).toBeGreaterThan(0)
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
      last_activity_at: null,
      ended_at: null,
      metadata: null,
      host: {
        id: 1,
        label: "My Host",
        hostname: "localhost",
        ssh_user: "root",
        ssh_port: 22,
        ssh_principal: "",
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
      last_activity_at: null,
      ended_at: "2024-01-01T01:00:00Z",
      metadata: null,
      host: {
        id: 1,
        label: "My Host",
        hostname: "localhost",
        ssh_user: "root",
        ssh_port: 22,
        ssh_principal: "",
        user_id: 1,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    }
    vi.mocked(api.getSession).mockResolvedValue(mockSession)

    renderSessionDetailPage("session-2")

    await waitFor(() => {
      expect(screen.getByText("Connect")).toBeInTheDocument()
    })
  })

  it("shows connect button for inactive session with host (stale ping)", async () => {
    const oldPingTime = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const mockSession = {
      id: "session-3",
      user_id: 1,
      host_id: 1,
      name: "Stale Session",
      started_at: "2024-01-01T00:00:00Z",
      last_ping_at: oldPingTime,
      last_activity_at: null,
      ended_at: null,
      metadata: null,
      host: {
        id: 1,
        label: "My Host",
        hostname: "localhost",
        ssh_user: "root",
        ssh_port: 22,
        ssh_principal: "",
        user_id: 1,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    }
    vi.mocked(api.getSession).mockResolvedValue(mockSession)

    renderSessionDetailPage("session-3")

    await waitFor(() => {
      expect(screen.getByText("Connect")).toBeInTheDocument()
    })
  })
})
