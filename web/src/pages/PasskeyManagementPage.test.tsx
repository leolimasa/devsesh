import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { AuthProvider } from "@/contexts/AuthContext"
import PasskeyManagementPage from "@/pages/PasskeyManagementPage"
import * as api from "@/lib/api"

vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: vi.fn().mockResolvedValue({ id: "new-cred" }),
}))

vi.mock("@/lib/api", () => ({
  listPasskeys: vi.fn().mockResolvedValue([]),
  addPasskeyBegin: vi.fn().mockResolvedValue({ challenge: "abc" }),
  addPasskeyFinish: vi.fn().mockResolvedValue(undefined),
  deletePasskey: vi.fn().mockResolvedValue(undefined),
}))

function renderPasskeyPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <PasskeyManagementPage />
      </AuthProvider>
    </MemoryRouter>
  )
}

describe("PasskeyManagementPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it("renders loading state initially", () => {
    vi.mocked(api.listPasskeys).mockImplementation(() => new Promise(() => {}))

    renderPasskeyPage()
    expect(screen.getByText("Loading passkeys...")).toBeInTheDocument()
  })

  it("renders empty state when no passkeys", async () => {
    vi.mocked(api.listPasskeys).mockResolvedValue([])

    renderPasskeyPage()

    await waitFor(() => {
      expect(screen.getByText("No passkeys found")).toBeInTheDocument()
    })
  })

  it("renders passkey list when loaded", async () => {
    const passkeys = [
      { id: "cred-1", created_at: "2024-01-01T00:00:00Z" },
      { id: "cred-2", created_at: "2024-01-02T00:00:00Z" },
    ]
    vi.mocked(api.listPasskeys).mockResolvedValue(passkeys)

    renderPasskeyPage()

    await waitFor(() => {
      expect(screen.getByText("Your Passkeys")).toBeInTheDocument()
      expect(screen.getByText(/cred-1/)).toBeInTheDocument()
      expect(screen.getByText(/cred-2/)).toBeInTheDocument()
    })
  })

  it("shows Add Passkey button", async () => {
    vi.mocked(api.listPasskeys).mockResolvedValue([])

    renderPasskeyPage()

    await waitFor(() => {
      expect(screen.getByText("Add Passkey")).toBeInTheDocument()
    })
  })

  it("shows back button", async () => {
    vi.mocked(api.listPasskeys).mockResolvedValue([])

    renderPasskeyPage()

    await waitFor(() => {
      expect(screen.getByText("Back")).toBeInTheDocument()
    })
  })

  it("disables delete when only one passkey exists", async () => {
    const passkeys = [{ id: "cred-1", created_at: "2024-01-01T00:00:00Z" }]
    vi.mocked(api.listPasskeys).mockResolvedValue(passkeys)

    renderPasskeyPage()

    await waitFor(() => {
      const deleteButton = screen.getByText("Delete")
      expect(deleteButton).toBeDisabled()
    })
  })

  it("enables delete when multiple passkeys exist", async () => {
    const passkeys = [
      { id: "cred-1", created_at: "2024-01-01T00:00:00Z" },
      { id: "cred-2", created_at: "2024-01-02T00:00:00Z" },
    ]
    vi.mocked(api.listPasskeys).mockResolvedValue(passkeys)

    renderPasskeyPage()

    await waitFor(() => {
      const deleteButtons = screen.getAllByText("Delete")
      deleteButtons.forEach(btn => {
        expect(btn).not.toBeDisabled()
      })
    })
  })

  it("shows confirmation dialog when deleting", async () => {
    const passkeys = [
      { id: "cred-1", created_at: "2024-01-01T00:00:00Z" },
      { id: "cred-2", created_at: "2024-01-02T00:00:00Z" },
    ]
    vi.mocked(api.listPasskeys).mockResolvedValue(passkeys)

    renderPasskeyPage()

    await waitFor(() => {
      const deleteButtons = screen.getAllByText("Delete")
      fireEvent.click(deleteButtons[0])
    })

    await waitFor(() => {
      expect(screen.getByText("Delete Passkey")).toBeInTheDocument()
      expect(screen.getByText(/are you sure you want to delete/i)).toBeInTheDocument()
    })
  })
})
