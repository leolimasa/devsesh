import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, act } from "@testing-library/react"
import { SSHTerminal } from "./SSHTerminal"
import type { TerminalHandle } from "./SSHTerminal"
import type { Host } from "@/types/api"
import type { ReactNode } from "react"
import { createRef } from "react"

// Shared focus mock so tests can assert the terminal is refocused.
const { mockFocus } = vi.hoisted(() => ({ mockFocus: vi.fn() }))

// Mock xterm
vi.mock("@xterm/xterm", () => {
  return {
    Terminal: class MockTerminal {
      loadAddon = vi.fn()
      open = vi.fn()
      write = vi.fn()
      onData = vi.fn()
      dispose = vi.fn()
      focus = mockFocus
      attachCustomKeyEventHandler = vi.fn()
      paste = vi.fn()
      rows = 24
      cols = 80
    },
  }
})

vi.mock("@xterm/addon-fit", () => {
  return {
    FitAddon: class MockFitAddon {
      fit = vi.fn()
    },
  }
})

// Mock SSHClient instance methods
const mockInit = vi.fn().mockResolvedValue(undefined)
const mockConnect = vi.fn()
const mockDisconnect = vi.fn()
const mockDisconnectAll = vi.fn()
const mockExec = vi.fn()
const mockSendInput = vi.fn()
const mockResize = vi.fn()
const mockResolvePassword = vi.fn()
const mockRejectPassword = vi.fn()
const mockOn = vi.fn()
const mockOff = vi.fn()
const mockResolveCertificate = vi.fn()
const mockRejectCertificate = vi.fn()

vi.mock("@/lib/ssh-client", () => {
  return {
    SSHClient: class MockSSHClient {
      init = mockInit
      connect = mockConnect
      disconnect = mockDisconnect
      disconnectAll = mockDisconnectAll
      exec = mockExec
      sendInput = mockSendInput
      resize = mockResize
      resolvePassword = mockResolvePassword
      rejectPassword = mockRejectPassword
      resolveCertificate = mockResolveCertificate
      rejectCertificate = mockRejectCertificate
      on = mockOn
      off = mockOff
    },
  }
})

// Controllable FROST mocks so tests can simulate the worker being alive or
// evicted (iOS kills the Web Worker holding the FROST share on background).
const {
  mockInitWorker,
  mockRequestCert,
  mockEnsureAlive,
  mockTerminate,
  frostState,
} = vi.hoisted(() => ({
  mockInitWorker: vi.fn(),
  mockRequestCert: vi.fn().mockRejectedValue(new Error("Mock error")),
  mockEnsureAlive: vi.fn().mockResolvedValue(true),
  mockTerminate: vi.fn(),
  frostState: { isActive: false },
}))

vi.mock("@/contexts/FROSTContext", () => ({
  FROSTProvider: ({ children }: { children: ReactNode }) => children,
  useFROST: () => ({
    isActive: frostState.isActive,
    remainingTime: 0,
    client: null,
    initWorker: mockInitWorker,
    requestCert: mockRequestCert,
    ensureAlive: mockEnsureAlive,
    terminate: mockTerminate,
  }),
}))

vi.mock("@/hooks/useVisualViewport", () => ({
  useVisualViewport: () => ({ height: 768, inset: 0 }),
}))

vi.mock("@/lib/quick-keys", () => ({
  encodeSpec: vi.fn().mockReturnValue(new Uint8Array([0x03])),
}))

// isDesktopViewport() reads window.matchMedia; jsdom doesn't implement it, so
// stub it to simulate a desktop or mobile viewport.
function setDesktopViewport(isDesktop: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isDesktop,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

describe("SSHTerminal", () => {
  const mockHost: Host = {
    id: 1,
    label: "Test Host",
    hostname: "localhost",
    ssh_user: "testuser",
    ssh_port: 22,
    ssh_principal: "",
    user_id: 1,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockInit.mockResolvedValue(undefined)
    // Default: FROST worker is alive and responsive.
    mockEnsureAlive.mockResolvedValue(true)
    mockRequestCert.mockRejectedValue(new Error("Mock error"))
    frostState.isActive = false
    // Default each test to a mobile viewport so the mount-time auto-focus
    // (desktop only) doesn't leak across tests. Tests that need desktop opt in
    // via setDesktopViewport(true) before render.
    setDesktopViewport(false)
  })

  it("renders loading state initially", () => {
    render(<SSHTerminal host={mockHost} sessionName="test-session-id" />)
    expect(screen.getByText("Loading SSH client...")).toBeInTheDocument()
  })

  it("shows connecting status after initialization", async () => {
    render(<SSHTerminal host={mockHost} sessionName="test-session-id" />)

    await waitFor(() => {
      expect(mockInit).toHaveBeenCalled()
      // connect(hostKey, hostId, user) — hostKey is the stringified host id.
      expect(mockConnect).toHaveBeenCalledWith("1", 1, "testuser")
    })
  })

  it("uses default ssh_user when not specified", async () => {
    const hostWithoutUser: Host = {
      ...mockHost,
      ssh_user: "",
    }

    render(<SSHTerminal host={hostWithoutUser} sessionName="test-session-id" />)

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledWith("1", 1, "root")
    })
  })

  it("executes tmux attach command when connected", async () => {
    let statusCallback: (status: string, error?: string) => void = () => {}
    mockOn.mockImplementation((event: string, cb: any) => {
      if (event === "status") {
        statusCallback = cb
      }
    })

    render(<SSHTerminal host={mockHost} sessionName="my-session-uuid" />)

    await waitFor(() => {
      expect(mockInit).toHaveBeenCalled()
    })

    statusCallback("connected")

    await waitFor(() => {
      expect(mockExec).toHaveBeenCalledWith("1", "tmux attach -t my-session-uuid")
    })
  })

  it("uses session name for tmux attach command", async () => {
    let statusCallback: (status: string, error?: string) => void = () => {}
    mockOn.mockImplementation((event: string, cb: any) => {
      if (event === "status") {
        statusCallback = cb
      }
    })

    const sessionName = "my-project"
    render(<SSHTerminal host={mockHost} sessionName={sessionName} />)

    await waitFor(() => {
      expect(mockInit).toHaveBeenCalled()
    })

    statusCallback("connected")

    await waitFor(() => {
      expect(mockExec).toHaveBeenCalledWith("1", `tmux attach -t ${sessionName}`)
    })
  })

  it("shows password dialog when authentication is required", async () => {
    let passwordCallback: () => void = () => {}
    mockOn.mockImplementation((event: string, cb: any) => {
      if (event === "password-request") {
        passwordCallback = cb
      }
    })

    render(<SSHTerminal host={mockHost} sessionName="test-session-id" />)

    await waitFor(() => {
      expect(mockInit).toHaveBeenCalled()
    })

    passwordCallback()

    await waitFor(() => {
      expect(screen.getByText("SSH Password Authentication")).toBeInTheDocument()
    })
  })

  // Reproduces the iOS "stuck on connecting after unlocking the phone" report:
  // while the PWA is backgrounded iOS both drops the WebSocket AND evicts the
  // Web Worker that holds the unlocked FROST share. On resume the terminal must
  // notice the worker is gone and prompt a re-unlock; the bug was that it never
  // re-authenticated (the pooled connection was reused / recovery early-returned
  // on the stale "connected" status), so it sat forever without ever asking to
  // unlock the master key again.
  it("re-prompts to unlock when resumed after the FROST worker was evicted", async () => {
    let statusCallback: (status: string, error?: string) => void = () => {}
    mockOn.mockImplementation((event: string, cb: any) => {
      if (event === "status") {
        statusCallback = cb
      }
    })

    render(<SSHTerminal host={mockHost} sessionName="test-session-id" />)

    await waitFor(() => {
      expect(mockInit).toHaveBeenCalled()
    })

    // Establish a live, authenticated connection (worker alive).
    await act(async () => {
      statusCallback("connected")
    })

    // iOS backgrounds the PWA: the WebSocket dies and the FROST worker is
    // evicted (no onerror fires — the handle just goes stale).
    mockEnsureAlive.mockResolvedValue(false)

    // Unlock the phone → the tab becomes visible again.
    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      })
      document.dispatchEvent(new Event("visibilitychange"))
    })

    // The terminal must detect the dead worker and surface the unlock dialog,
    // rather than sitting silently on a dead connection.
    await waitFor(() => {
      expect(screen.getByText("Unlock SSH Certificate")).toBeInTheDocument()
    })
  })

  // Computer sleeps/wakes with the tab still "visible": visibilitychange never
  // fires, so recovery must also key off window `focus`. Otherwise the user has
  // to manually click Reconnect after the idle FROST cert expires.
  it("recovers on window focus (computer wake) when the worker went stale", async () => {
    let statusCallback: (status: string, error?: string) => void = () => {}
    mockOn.mockImplementation((event: string, cb: any) => {
      if (event === "status") statusCallback = cb
    })

    render(<SSHTerminal host={mockHost} sessionName="test-session-id" />)
    await waitFor(() => expect(mockInit).toHaveBeenCalled())
    await act(async () => { statusCallback("connected") })

    // Idle long enough that the FROST worker (which signs the SSH cert) locked.
    mockEnsureAlive.mockResolvedValue(false)

    // Wake / return to the app — window regains focus (no visibilitychange).
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })

    await waitFor(() => {
      expect(screen.getByText("Unlock SSH Certificate")).toBeInTheDocument()
    })
  })

  it("reports status via onStatusChange", async () => {
    let statusCallback: (status: string, error?: string) => void = () => {}
    mockOn.mockImplementation((event: string, cb: any) => {
      if (event === "status") {
        statusCallback = cb
      }
    })

    const onStatusChange = vi.fn()
    render(<SSHTerminal host={mockHost} sessionName="test-session-id" onStatusChange={onStatusChange} />)

    await waitFor(() => {
      expect(mockInit).toHaveBeenCalled()
    })

    statusCallback("error", "Connection refused")

    // onStatusChange now carries the error detail so the top bar can explain it.
    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledWith("error", "Connection refused")
    })
  })

  it("provides connect/disconnect/sendKeys via imperative handle", async () => {
    const ref = createRef<TerminalHandle>()
    render(<SSHTerminal ref={ref} host={mockHost} sessionName="test-session-id" />)

    await waitFor(() => {
      expect(mockInit).toHaveBeenCalled()
    })

    // Imperative handle methods
    expect(ref.current).not.toBeNull()

    ref.current!.connect()
    expect(mockConnect).toHaveBeenCalled()

    ref.current!.disconnect()
    expect(mockDisconnect).toHaveBeenCalled()

    // On desktop, focus returns to the terminal after sending a quick key so
    // typing continues there. [req.72jxmp]
    setDesktopViewport(true)
    ref.current!.sendKeys([{ type: "combo", ctrl: true, alt: false, shift: false, key: "c" }])
    expect(mockSendInput).toHaveBeenCalled()
    expect(mockFocus).toHaveBeenCalled()
  })

  it("does NOT refocus the terminal after a quick key on mobile", async () => {
    // Mobile viewport is the beforeEach default, so no mount-time auto-focus.
    const ref = createRef<TerminalHandle>()
    render(<SSHTerminal ref={ref} host={mockHost} sessionName="test-session-id" />)

    await waitFor(() => {
      expect(mockInit).toHaveBeenCalled()
    })

    // On mobile, refocusing xterm's textarea would pop the on-screen keyboard,
    // so the quick key is sent but focus is left alone.
    ref.current!.sendKeys([{ type: "combo", ctrl: true, alt: false, shift: false, key: "c" }])
    expect(mockSendInput).toHaveBeenCalled()
    expect(mockFocus).not.toHaveBeenCalled()
  })

  it("auto-focuses the terminal on load on desktop", () => {
    setDesktopViewport(true)
    render(<SSHTerminal host={mockHost} sessionName="test-session-id" />)
    // Terminal grabs focus on mount so the user can type immediately.
    expect(mockFocus).toHaveBeenCalled()
  })

  it("does NOT auto-focus the terminal on load on mobile", () => {
    // Mobile viewport is the beforeEach default. Auto-focusing would pop the
    // on-screen keyboard before the user taps into the terminal.
    render(<SSHTerminal host={mockHost} sessionName="test-session-id" />)
    expect(mockFocus).not.toHaveBeenCalled()
  })

  it("auto-reconnects after an unsolicited drop", async () => {
    let statusCallback: (status: string, error?: string) => void = () => {}
    mockOn.mockImplementation((event: string, cb: any) => {
      if (event === "status") statusCallback = cb
    })

    render(<SSHTerminal host={mockHost} sessionName="test-session-id" />)

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledTimes(1) // initial auto-connect
    })

    vi.useFakeTimers()
    try {
      // Unsolicited disconnect (user did not request it) → schedule reconnect.
      act(() => statusCallback("disconnected"))
      await act(async () => {
        vi.advanceTimersByTime(2000)
      })
      expect(mockConnect).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not reconnect after an explicit disconnect", async () => {
    let statusCallback: (status: string, error?: string) => void = () => {}
    mockOn.mockImplementation((event: string, cb: any) => {
      if (event === "status") statusCallback = cb
    })

    const ref = createRef<TerminalHandle>()
    render(<SSHTerminal ref={ref} host={mockHost} sessionName="test-session-id" />)

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledTimes(1)
    })

    // User explicitly disconnects, then a "disconnected" status arrives.
    act(() => ref.current!.disconnect())

    vi.useFakeTimers()
    try {
      act(() => statusCallback("disconnected"))
      await act(async () => {
        vi.advanceTimersByTime(5000)
      })
      // No further connect() beyond the initial auto-connect.
      expect(mockConnect).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("handles terminal output", async () => {
    let outputCallback: ((data: string) => void) | null = null
    mockOn.mockImplementation((event: string, cb: any) => {
      if (event === "output") {
        outputCallback = cb
      }
    })

    render(<SSHTerminal host={mockHost} sessionName="test-session-id" />)

    await waitFor(() => {
      expect(mockInit).toHaveBeenCalled()
    })

    expect(outputCallback).not.toBeNull()
  })

  it("cleans up on unmount", async () => {
    const { unmount } = render(<SSHTerminal host={mockHost} sessionName="test-session-id" />)

    await waitFor(() => {
      expect(mockInit).toHaveBeenCalled()
    })

    unmount()

    // Unmount tears down every pooled connection.
    expect(mockDisconnectAll).toHaveBeenCalled()
  })
})
