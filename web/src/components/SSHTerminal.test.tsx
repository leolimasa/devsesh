import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { SSHTerminal } from "./SSHTerminal"
import type { Host } from "@/types/api"
import type { ReactNode } from "react"

// Mock xterm
vi.mock("xterm", () => {
  return {
    Terminal: class MockTerminal {
      loadAddon = vi.fn()
      open = vi.fn()
      write = vi.fn()
      onData = vi.fn()
      dispose = vi.fn()
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

// Mock SSHClient instance methods that we want to track
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

// Mock the FROST context to avoid worker initialization
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

// Helper to get mock references
const mockSSHClient = {
  init: mockInit,
  connect: mockConnect,
  disconnect: mockDisconnect,
  exec: mockExec,
  sendInput: mockSendInput,
  resize: mockResize,
  resolvePassword: mockResolvePassword,
  rejectPassword: mockRejectPassword,
  on: mockOn,
  off: mockOff,
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
    mockSSHClient.init.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("renders loading state initially", () => {
    render(<SSHTerminal host={mockHost} sessionName="test-session-id" />)
    expect(screen.getByText("Loading SSH client...")).toBeInTheDocument()
  })

  it("shows connecting status after initialization", async () => {
    render(<SSHTerminal host={mockHost} sessionName="test-session-id" />)

    await waitFor(() => {
      expect(mockSSHClient.init).toHaveBeenCalled()
      expect(mockSSHClient.connect).toHaveBeenCalledWith(1, "testuser")
    })
  })

  it("uses default ssh_user when not specified", async () => {
    const hostWithoutUser: Host = {
      ...mockHost,
      ssh_user: "",
    }

    render(<SSHTerminal host={hostWithoutUser} sessionName="test-session-id" />)

    await waitFor(() => {
      expect(mockSSHClient.connect).toHaveBeenCalledWith(1, "root")
    })
  })

  it("executes tmux attach command when connected", async () => {
    // Capture the status callback
    let statusCallback: (status: string, error?: string) => void = () => {}
    mockSSHClient.on.mockImplementation((event: string, cb: any) => {
      if (event === "status") {
        statusCallback = cb
      }
    })

    render(<SSHTerminal host={mockHost} sessionName="my-session-uuid" />)

    await waitFor(() => {
      expect(mockSSHClient.init).toHaveBeenCalled()
    })

    // Simulate connected status
    statusCallback("connected")

    await waitFor(() => {
      expect(mockSSHClient.exec).toHaveBeenCalledWith("tmux attach -t my-session-uuid")
    })
  })

  it("uses session name for tmux attach command", async () => {
    let statusCallback: (status: string, error?: string) => void = () => {}
    mockSSHClient.on.mockImplementation((event: string, cb: any) => {
      if (event === "status") {
        statusCallback = cb
      }
    })

    // Session name is the friendly name like "my-project"
    const sessionName = "my-project"

    render(<SSHTerminal host={mockHost} sessionName={sessionName} />)

    await waitFor(() => {
      expect(mockSSHClient.init).toHaveBeenCalled()
    })

    statusCallback("connected")

    await waitFor(() => {
      // Should use the session name, not the UUID
      expect(mockSSHClient.exec).toHaveBeenCalledWith(`tmux attach -t ${sessionName}`)
    })
  })

  it("shows password dialog when authentication is required", async () => {
    let passwordCallback: () => void = () => {}
    mockSSHClient.on.mockImplementation((event: string, cb: any) => {
      if (event === "password-request") {
        passwordCallback = cb
      }
    })

    render(<SSHTerminal host={mockHost} sessionName="test-session-id" />)

    await waitFor(() => {
      expect(mockSSHClient.init).toHaveBeenCalled()
    })

    passwordCallback()

    await waitFor(() => {
      expect(screen.getByText(/Authenticating/)).toBeInTheDocument()
    })
  })

  it("displays error when connection fails", async () => {
    let statusCallback: (status: string, error?: string) => void = () => {}
    mockSSHClient.on.mockImplementation((event: string, cb: any) => {
      if (event === "status") {
        statusCallback = cb
      }
    })

    render(<SSHTerminal host={mockHost} sessionName="test-session-id" />)

    await waitFor(() => {
      expect(mockSSHClient.init).toHaveBeenCalled()
    })

    statusCallback("error", "Connection refused")

    await waitFor(() => {
      expect(screen.getByText("Connection refused")).toBeInTheDocument()
    })
  })

  it("calls disconnect when disconnect button is clicked", async () => {
    let statusCallback: (status: string, error?: string) => void = () => {}
    mockSSHClient.on.mockImplementation((event: string, cb: any) => {
      if (event === "status") {
        statusCallback = cb
      }
    })

    const onDisconnect = vi.fn()
    render(<SSHTerminal host={mockHost} sessionName="test-session-id" onDisconnect={onDisconnect} />)

    await waitFor(() => {
      expect(mockSSHClient.init).toHaveBeenCalled()
    })

    statusCallback("connected")

    await waitFor(() => {
      expect(screen.getByText("Connected", { exact: false })).toBeInTheDocument()
    })

    const disconnectButton = screen.getByText("Disconnect")
    fireEvent.click(disconnectButton)

    expect(mockSSHClient.disconnect).toHaveBeenCalled()
    expect(onDisconnect).toHaveBeenCalled()
  })

  it("handles terminal output", async () => {
    let outputCallback: ((data: string) => void) | null = null
    mockSSHClient.on.mockImplementation((event: string, cb: any) => {
      if (event === "output") {
        outputCallback = cb
      }
    })

    render(<SSHTerminal host={mockHost} sessionName="test-session-id" />)

    await waitFor(() => {
      expect(mockSSHClient.init).toHaveBeenCalled()
    })

    // The output callback should be registered
    expect(outputCallback).not.toBeNull()
  })

  it("cleans up on unmount", async () => {
    const { unmount } = render(<SSHTerminal host={mockHost} sessionName="test-session-id" />)

    await waitFor(() => {
      expect(mockSSHClient.init).toHaveBeenCalled()
    })

    unmount()

    expect(mockSSHClient.disconnect).toHaveBeenCalled()
  })
})
