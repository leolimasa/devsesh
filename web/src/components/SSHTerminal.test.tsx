import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { SSHTerminal } from "./SSHTerminal"
import type { Host } from "@/types/api"

// Mock xterm
vi.mock("xterm", () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    loadAddon: vi.fn(),
    open: vi.fn(),
    write: vi.fn(),
    onData: vi.fn(),
    dispose: vi.fn(),
    rows: 24,
    cols: 80,
  })),
}))

vi.mock("xterm-addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
  })),
}))

// Mock SSHClient
const mockSSHClient = {
  init: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  exec: vi.fn(),
  sendInput: vi.fn(),
  resize: vi.fn(),
  resolvePassword: vi.fn(),
  rejectPassword: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}

vi.mock("@/lib/ssh-client", () => ({
  SSHClient: vi.fn().mockImplementation(() => mockSSHClient),
}))

describe("SSHTerminal", () => {
  const mockHost: Host = {
    id: 1,
    label: "Test Host",
    hostname: "localhost",
    ssh_user: "testuser",
    ssh_port: 22,
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
    render(<SSHTerminal host={mockHost} sessionId="test-session-id" />)
    expect(screen.getByText("Loading SSH client...")).toBeInTheDocument()
  })

  it("shows connecting status after initialization", async () => {
    render(<SSHTerminal host={mockHost} sessionId="test-session-id" />)

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

    render(<SSHTerminal host={hostWithoutUser} sessionId="test-session-id" />)

    await waitFor(() => {
      expect(mockSSHClient.connect).toHaveBeenCalledWith(1, "root")
    })
  })

  it("executes tmux new-session command when connected", async () => {
    // Capture the status callback
    let statusCallback: ((status: string, error?: string) => void) | null = null
    mockSSHClient.on.mockImplementation((event: string, cb: any) => {
      if (event === "status") {
        statusCallback = cb
      }
    })

    render(<SSHTerminal host={mockHost} sessionId="my-session-uuid" />)

    await waitFor(() => {
      expect(mockSSHClient.init).toHaveBeenCalled()
    })

    // Simulate connected status
    if (statusCallback) {
      statusCallback("connected")
    }

    await waitFor(() => {
      expect(mockSSHClient.exec).toHaveBeenCalledWith("tmux new-session -A -s my-session-uuid")
    })
  })

  it("uses session id (UUID) for tmux session name, not session name", async () => {
    let statusCallback: ((status: string, error?: string) => void) | null = null
    mockSSHClient.on.mockImplementation((event: string, cb: any) => {
      if (event === "status") {
        statusCallback = cb
      }
    })

    // Session ID is a UUID like "abc-123-def"
    const sessionUUID = "abc-123-def-456"

    render(<SSHTerminal host={mockHost} sessionId={sessionUUID} />)

    await waitFor(() => {
      expect(mockSSHClient.init).toHaveBeenCalled()
    })

    if (statusCallback) {
      statusCallback("connected")
    }

    await waitFor(() => {
      // Should use the UUID, not a friendly name
      expect(mockSSHClient.exec).toHaveBeenCalledWith(`tmux new-session -A -s ${sessionUUID}`)
    })
  })

  it("shows password dialog when authentication is required", async () => {
    let passwordCallback: (() => void) | null = null
    mockSSHClient.on.mockImplementation((event: string, cb: any) => {
      if (event === "password-request") {
        passwordCallback = cb
      }
    })

    render(<SSHTerminal host={mockHost} sessionId="test-session-id" />)

    await waitFor(() => {
      expect(mockSSHClient.init).toHaveBeenCalled()
    })

    if (passwordCallback) {
      passwordCallback()
    }

    await waitFor(() => {
      expect(screen.getByText("Authenticating...")).toBeInTheDocument()
    })
  })

  it("displays error when connection fails", async () => {
    let statusCallback: ((status: string, error?: string) => void) | null = null
    mockSSHClient.on.mockImplementation((event: string, cb: any) => {
      if (event === "status") {
        statusCallback = cb
      }
    })

    render(<SSHTerminal host={mockHost} sessionId="test-session-id" />)

    await waitFor(() => {
      expect(mockSSHClient.init).toHaveBeenCalled()
    })

    if (statusCallback) {
      statusCallback("error", "Connection refused")
    }

    await waitFor(() => {
      expect(screen.getByText("Connection refused")).toBeInTheDocument()
    })
  })

  it("calls disconnect when disconnect button is clicked", async () => {
    let statusCallback: ((status: string, error?: string) => void) | null = null
    mockSSHClient.on.mockImplementation((event: string, cb: any) => {
      if (event === "status") {
        statusCallback = cb
      }
    })

    const onDisconnect = vi.fn()
    render(<SSHTerminal host={mockHost} sessionId="test-session-id" onDisconnect={onDisconnect} />)

    await waitFor(() => {
      expect(mockSSHClient.init).toHaveBeenCalled()
    })

    if (statusCallback) {
      statusCallback("connected")
    }

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

    render(<SSHTerminal host={mockHost} sessionId="test-session-id" />)

    await waitFor(() => {
      expect(mockSSHClient.init).toHaveBeenCalled()
    })

    // The output callback should be registered
    expect(outputCallback).not.toBeNull()
  })

  it("cleans up on unmount", async () => {
    const { unmount } = render(<SSHTerminal host={mockHost} sessionId="test-session-id" />)

    await waitFor(() => {
      expect(mockSSHClient.init).toHaveBeenCalled()
    })

    unmount()

    expect(mockSSHClient.disconnect).toHaveBeenCalled()
  })
})
