import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { AuthProvider } from "@/contexts/AuthContext"
import PairPage from "@/pages/PairPage"

vi.mock("@/lib/api", () => ({
  pairExchange: vi.fn().mockResolvedValue({ token: "jwt-token" }),
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

  it("renders pairing form", () => {
    renderPairPage()
    expect(screen.getByText(/enter the pairing code from your CLI/i)).toBeInTheDocument()
    expect(screen.getByLabelText("Pairing Code")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /pair device/i })).toBeInTheDocument()
  })

  it("converts input to uppercase", () => {
    renderPairPage()
    const input = screen.getByLabelText("Pairing Code")
    fireEvent.change(input, { target: { value: "abc123" } })
    expect((input as HTMLInputElement).value).toBe("ABC123")
  })

  it("shows success message on successful pairing", async () => {
    renderPairPage()

    const input = screen.getByLabelText("Pairing Code")
    fireEvent.change(input, { target: { value: "ABC123" } })
    fireEvent.click(screen.getByRole("button", { name: /pair device/i }))

    await waitFor(() => {
      expect(screen.getByText(/device paired successfully/i)).toBeInTheDocument()
    })
  })

  it("shows error on pairing failure", async () => {
    const { pairExchange } = await import("@/lib/api")
    vi.mocked(pairExchange).mockRejectedValue(new Error("Invalid code"))

    renderPairPage()

    const input = screen.getByLabelText("Pairing Code")
    fireEvent.change(input, { target: { value: "INVALID" } })
    fireEvent.click(screen.getByRole("button", { name: /pair device/i }))

    await waitFor(() => {
      expect(screen.getByText("Invalid code")).toBeInTheDocument()
    })
  })
})
