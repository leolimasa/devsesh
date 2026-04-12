import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { AuthProvider } from "@/contexts/AuthContext"
import PairPage from "@/pages/PairPage"

const mockListHosts = vi.fn().mockResolvedValue([
  { id: 1, label: "My Laptop", hostname: "laptop.local", user_id: 1, created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z" },
])

const mockPairExchange = vi.fn().mockResolvedValue({ token: "jwt-token" })

vi.mock("@/lib/api", () => ({
  listHosts: (...args: unknown[]) => mockListHosts(...args),
  pairExchange: (...args: unknown[]) => mockPairExchange(...args),
}))

function renderPairPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <PairPage />
      </AuthProvider>
    </MemoryRouter>
  )
}

describe("PairPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it("renders pairing form", async () => {
    renderPairPage()
    await waitFor(() => {
      expect(screen.getByText(/enter the pairing code from your CLI/i)).toBeInTheDocument()
    })
    expect(screen.getByLabelText("Pairing Code")).toBeInTheDocument()
    expect(screen.getByLabelText("Host")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /pair device/i })).toBeInTheDocument()
  })

  it("converts input to uppercase", async () => {
    renderPairPage()
    await waitFor(() => {
      expect(screen.getByLabelText("Pairing Code")).toBeInTheDocument()
    })
    const input = screen.getByLabelText("Pairing Code")
    fireEvent.change(input, { target: { value: "abc123" } })
    expect((input as HTMLInputElement).value).toBe("ABC123")
  })

  it("shows host selection options", async () => {
    renderPairPage()
    await waitFor(() => {
      expect(screen.getByText("My Laptop (laptop.local)")).toBeInTheDocument()
    })
  })

  it("enables pair button when host is selected and code entered", async () => {
    renderPairPage()
    await waitFor(() => {
      expect(screen.getByLabelText("Host")).toBeInTheDocument()
    })

    const input = screen.getByLabelText("Pairing Code")
    fireEvent.change(input, { target: { value: "ABC123" } })

    const select = screen.getByLabelText("Host")
    fireEvent.change(select, { target: { value: "1" } })

    const button = screen.getByRole("button", { name: /pair device/i })
    expect(button).not.toBeDisabled()
  })

  it("shows success message on successful pairing", async () => {
    renderPairPage()
    await waitFor(() => {
      expect(screen.getByLabelText("Host")).toBeInTheDocument()
    })

    const input = screen.getByLabelText("Pairing Code")
    fireEvent.change(input, { target: { value: "ABC123" } })

    const select = screen.getByLabelText("Host")
    fireEvent.change(select, { target: { value: "1" } })

    fireEvent.click(screen.getByRole("button", { name: /pair device/i }))

    await waitFor(() => {
      expect(screen.getByText(/device paired successfully/i)).toBeInTheDocument()
    })
  })

  it("shows error on pairing failure", async () => {
    mockPairExchange.mockRejectedValueOnce(new Error("Invalid code"))

    renderPairPage()
    await waitFor(() => {
      expect(screen.getByLabelText("Host")).toBeInTheDocument()
    })

    const input = screen.getByLabelText("Pairing Code")
    fireEvent.change(input, { target: { value: "INVALI" } })

    const select = screen.getByLabelText("Host")
    fireEvent.change(select, { target: { value: "1" } })

    fireEvent.click(screen.getByRole("button", { name: /pair device/i }))

    await waitFor(() => {
      expect(screen.getByText("Invalid code")).toBeInTheDocument()
    })
  })

  it("shows create new host option", async () => {
    renderPairPage()
    await waitFor(() => {
      expect(screen.getByText("Create New Host")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText("Create New Host"))

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Label (e.g., My Laptop)")).toBeInTheDocument()
      expect(screen.getByPlaceholderText("Hostname (e.g., laptop.local)")).toBeInTheDocument()
    })
  })
})