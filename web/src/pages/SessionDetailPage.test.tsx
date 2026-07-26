import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react"
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
  listSessions: vi.fn().mockResolvedValue([]),
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

vi.mock("@xterm/xterm", () => ({
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

vi.mock("@xterm/addon-fit", () => ({
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
      // Session name appears in the top bar and the Details-tab "Name" field
      // (the panel no longer repeats it in a header).
      expect(screen.getAllByText("Test Session").length).toBe(2)
      // Session hash as a field in details
      expect(screen.getByText("session-1")).toBeInTheDocument()
      // Host name in details
      expect(screen.getByText("My Host")).toBeInTheDocument()
      // The Details tab button is present in the panel's tab switcher.
      expect(screen.getByRole("tab", { name: "Details" })).toBeInTheDocument()
    })
  })

  it("renders the top bar at the bottom on mobile (order-last)", async () => {
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

    // The bar wrapper carries `order-last` so mobile flow places it at the
    // bottom of the flex column; `md:order-none` restores top placement on
    // desktop.
    const bar = await screen.findByTestId("session-top-bar")
    const wrapper = bar.parentElement
    expect(wrapper).toHaveClass("order-last", "md:order-none")
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

  // --- Desktop details panel (0016) ---

  const hostFixture = {
    id: 1,
    label: "My Host",
    hostname: "localhost",
    ssh_user: "root",
    ssh_port: 22,
    ssh_principal: "",
    user_id: 1,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  }

  function makeSession(over: Partial<Record<string, unknown>> = {}) {
    return {
      id: "session-1",
      user_id: 1,
      host_id: 1,
      name: "Test Session",
      started_at: "2024-01-01T00:00:00Z",
      last_ping_at: "2024-01-01T00:04:00Z",
      last_activity_at: null,
      ended_at: null,
      metadata: null,
      host: hostFixture,
      ...over,
    }
  }

  it("does not repeat the current session name/status in a panel header", async () => {
    vi.mocked(api.getSession).mockResolvedValue(
      makeSession({ metadata: JSON.stringify({ status: "deploying" }) })
    )

    renderSessionDetailPage("session-1")

    await waitFor(() => {
      // The redundant panel header (name + status) was removed; the panel
      // starts with the tab switcher.
      expect(screen.queryByTestId("panel-session-name")).not.toBeInTheDocument()
      expect(screen.queryByTestId("panel-status")).not.toBeInTheDocument()
    })
    // Status still surfaces in the Details tab's Status field.
    const statusEls = document.querySelectorAll("[data-status]")
    expect(
      Array.from(statusEls).some((el) => el.textContent === "deploying")
    ).toBe(true)
  })

  it("switches to the Sessions tab and lists sessions with index + status", async () => {
    vi.mocked(api.getSession).mockResolvedValue(makeSession())
    vi.mocked(api.listSessions).mockResolvedValue([
      makeSession({ id: "session-1", name: "Test Session", metadata: JSON.stringify({ status: "idle" }) }),
      makeSession({ id: "session-2", name: "Other Session", metadata: JSON.stringify({ status: "busy" }) }),
    ])

    renderSessionDetailPage("session-1")

    // Open the Sessions tab.
    const sessionsTab = await screen.findByRole("tab", { name: "Sessions" })
    fireEvent.click(sessionsTab)

    await waitFor(() => {
      expect(screen.getByText("Other Session")).toBeInTheDocument()
      // 1-based indices are rendered.
      expect(screen.getByText("1")).toBeInTheDocument()
      expect(screen.getByText("2")).toBeInTheDocument()
      // Per-session status subline.
      expect(screen.getByText("busy")).toBeInTheDocument()
    })
  })

  it("navigates to a session's detail URL when clicked in the Sessions tab", async () => {
    vi.mocked(api.getSession).mockResolvedValue(makeSession())
    vi.mocked(api.listSessions).mockResolvedValue([
      makeSession({ id: "session-1", name: "Test Session" }),
      makeSession({ id: "session-2", name: "Other Session" }),
    ])

    renderSessionDetailPage("session-1")

    const sessionsTab = await screen.findByRole("tab", { name: "Sessions" })
    fireEvent.click(sessionsTab)

    const otherRow = await screen.findByText("Other Session")
    vi.mocked(api.getSession).mockClear()
    fireEvent.click(otherRow)

    // Selecting a session refetches it by its id (route param changed).
    await waitFor(() => {
      expect(api.getSession).toHaveBeenCalledWith("session-2")
    })
  })

  // --- PWA Ctrl+Number session switching ---

  // Simulate installed-PWA (standalone) vs browser-tab by stubbing matchMedia.
  function setStandalone(on: boolean) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("display-mode: standalone") ? on : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia
  }

  function pressCtrlDigit(n: number) {
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { ctrlKey: true, code: `Digit${n}`, bubbles: true, cancelable: true })
      )
    })
  }

  async function renderWithSessions(ids: string[]) {
    vi.mocked(api.getSession).mockImplementation((sid: string) =>
      Promise.resolve(makeSession({ id: sid, name: sid }))
    )
    vi.mocked(api.listSessions).mockResolvedValue(ids.map((sid) => makeSession({ id: sid, name: sid })))
    renderSessionDetailPage(ids[0])
    // Ensure the sessions list is loaded (so the shortcut has data).
    const sessionsTab = await screen.findByRole("tab", { name: "Sessions" })
    fireEvent.click(sessionsTab)
    await screen.findByTestId(`session-item-${ids[ids.length - 1]}`)
  }

  it("Ctrl+2 switches to the 2nd session when running as a PWA", async () => {
    setStandalone(true)
    await renderWithSessions(["session-1", "session-2", "session-3"])

    vi.mocked(api.getSession).mockClear()
    pressCtrlDigit(2)

    await waitFor(() => {
      expect(api.getSession).toHaveBeenCalledWith("session-2")
    })
  })

  it("does not intercept Ctrl+Number in a normal browser tab", async () => {
    setStandalone(false)
    await renderWithSessions(["session-1", "session-2", "session-3"])

    vi.mocked(api.getSession).mockClear()
    pressCtrlDigit(2)

    // No navigation happened.
    await new Promise((r) => setTimeout(r, 50))
    expect(api.getSession).not.toHaveBeenCalledWith("session-2")
  })

  it("ignores an out-of-range index (Ctrl+9 with only 3 sessions)", async () => {
    setStandalone(true)
    await renderWithSessions(["session-1", "session-2", "session-3"])

    vi.mocked(api.getSession).mockClear()
    pressCtrlDigit(9)

    await new Promise((r) => setTimeout(r, 50))
    expect(api.getSession).not.toHaveBeenCalled()
  })
})
