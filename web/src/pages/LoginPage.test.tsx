import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { AuthProvider } from "@/contexts/AuthContext"
import LoginPage from "@/pages/LoginPage"

vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: vi.fn().mockResolvedValue({ id: "cred-123" }),
  browserSupportsWebAuthn: vi.fn().mockReturnValue(true),
}))

vi.mock("@/lib/api", () => ({
  checkUsersExist: vi.fn().mockResolvedValue({ exists: true }),
  loginBegin: vi.fn().mockResolvedValue({ challenge: "abc123" }),
  loginFinish: vi.fn().mockResolvedValue({ token: "jwt-token" }),
}))

function renderLoginPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>
  )
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it("renders sign in form", () => {
    renderLoginPage()
    expect(screen.getByText("Sign In")).toBeInTheDocument()
    expect(screen.getByLabelText("Email")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /sign in with passkey/i })).toBeInTheDocument()
  })

  it("shows registration link when no users exist", async () => {
    const { checkUsersExist } = await import("@/lib/api")
    vi.mocked(checkUsersExist).mockResolvedValue({ exists: false })

    renderLoginPage()

    await waitFor(() => {
      expect(screen.getByText("Create an account")).toBeInTheDocument()
    })
  })

  it("does not show registration link when users exist", async () => {
    renderLoginPage()

    await waitFor(() => {
      expect(screen.queryByText("Create an account")).not.toBeInTheDocument()
    })
  })

  it("shows error on login failure", async () => {
    const { loginBegin } = await import("@/lib/api")
    vi.mocked(loginBegin).mockRejectedValue(new Error("Invalid email"))

    renderLoginPage()

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "test@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: /sign in with passkey/i }))

    await waitFor(() => {
      expect(screen.getByText("Invalid email")).toBeInTheDocument()
    })
  })

  it("shows warning and disables button when WebAuthn is not supported", async () => {
    const { browserSupportsWebAuthn } = await import("@simplewebauthn/browser")
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(false)

    renderLoginPage()

    await waitFor(() => {
      expect(screen.getByText("WebAuthn is not supported")).toBeInTheDocument()
      expect(screen.getByText(/Passkeys require a secure context/)).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /sign in with passkey/i })).toBeDisabled()
    })
  })
})
