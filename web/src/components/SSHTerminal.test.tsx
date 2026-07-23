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
vi.mock("xterm", () => {
  return {
    Terminal: class MockTerminal {
      loadAddon = vi.fn()
      open = vi.fn()
      write = vi.fn()
      onData = vi.fn()
      dispose = vi.fn()
      focus = mockFocus
      rows = 24
      cols = 80
    },
  }
})

vi.mock("xterm-addon-fit", () => {
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

vi.mock("@/lib/quick-keys", () => ({
  encodeSpec: vi.fn().mockReturnValue(new Uint8Array([0x03])),
}))

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
  })

  it("renders loading state initially", () => {
    render(<SSHTerminal host={mockHost} sessionName="test-session-id" />)
    expect(screen.getByText("Loading SSH client...")).toBeInTheDocument()
  })

  it("shows connecting status after initialization", async () => {
    render(<SSHTerminal host={mockHost} sessionName="test-session-id" />)

    await waitFor(() => {
      expect(mockInit).toHaveBeenCalled()
      expect(mockConnect).toHaveBeenCalledWith(1, "testuser")
    })
  })

  it("uses default ssh_user when not specified", async () => {
    const hostWithoutUser: Host = {
      ...mockHost,
      ssh_user: "",
    }

    render(<SSHTerminal host={hostWithoutUser} sessionName="test-session-id" />)

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledWith(1, "root")
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
      expect(mockExec).toHaveBeenCalledWith("tmux attach -t my-session-uuid")
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
      expect(mockExec).toHaveBeenCalledWith(`tmux attach -t ${sessionName}`)
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

    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledWith("error")
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

    ref.current!.sendKeys([{ type: "combo", ctrl: true, alt: false, shift: false, key: "c" }])
    expect(mockSendInput).toHaveBeenCalled()
    // Focus returns to the terminal after sending a quick key. [req.72jxmp]
    expect(mockFocus).toHaveBeenCalled()
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

    expect(mockDisconnect).toHaveBeenCalled()
  })
})
