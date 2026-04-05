import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { AuthProvider } from "@/contexts/AuthContext"
import LoginPage from "@/pages/LoginPage"
import RegisterPage from "@/pages/RegisterPage"
import PairPage from "@/pages/PairPage"
import DashboardPage from "@/pages/DashboardPage"
import SessionDetailPage from "@/pages/SessionDetailPage"
import PasskeyManagementPage from "@/pages/PasskeyManagementPage"

vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}))

vi.mock("@/hooks/useSessionUpdates", () => ({
  useSessionUpdates: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  checkUsersExist: vi.fn().mockResolvedValue({ exists: true }),
  loginBegin: vi.fn().mockResolvedValue({ challenge: "abc" }),
  loginFinish: vi.fn().mockResolvedValue({ token: "jwt" }),
  registerBegin: vi.fn().mockResolvedValue({ challenge: "abc" }),
  registerFinish: vi.fn().mockResolvedValue(undefined),
  pairExchange: vi.fn().mockResolvedValue({ token: "jwt" }),
  listSessions: vi.fn().mockResolvedValue([]),
  getSession: vi.fn().mockResolvedValue(null),
  deleteStaleSessions: vi.fn().mockResolvedValue({ deleted: 0 }),
  listPasskeys: vi.fn().mockResolvedValue([]),
  addPasskeyBegin: vi.fn().mockResolvedValue({ challenge: "abc" }),
  addPasskeyFinish: vi.fn().mockResolvedValue(undefined),
  deletePasskey: vi.fn().mockResolvedValue(undefined),
}))

function renderWithRouter(ui: React.ReactNode) {
  return render(
    <MemoryRouter>
      <AuthProvider>
        {ui}
      </AuthProvider>
    </MemoryRouter>
  )
}

describe("App routing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it("renders login page", () => {
    renderWithRouter(<LoginPage />)
    expect(screen.getByText("Sign In")).toBeInTheDocument()
  })

  it("renders register page", () => {
    renderWithRouter(<RegisterPage />)
    expect(screen.getByText("Create Account")).toBeInTheDocument()
  })

  it("renders pair page", () => {
    renderWithRouter(<PairPage />)
    expect(screen.getByText(/pairing code from your CLI/i)).toBeInTheDocument()
  })

  it("renders dashboard page", async () => {
    renderWithRouter(<DashboardPage />)
    expect(screen.getByText("Loading sessions...")).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText(/no sessions found/i)).toBeInTheDocument()
    })
  })

  it("renders session detail page", () => {
    renderWithRouter(<SessionDetailPage />)
    expect(screen.getByText("Loading session...")).toBeInTheDocument()
  })

  it("renders passkey management page", async () => {
    renderWithRouter(<PasskeyManagementPage />)
    expect(screen.getByText("Loading passkeys...")).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText("No passkeys found")).toBeInTheDocument()
    })
  })
})
