import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import RegisterPage from "@/pages/RegisterPage"

vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: vi.fn().mockResolvedValue({ id: "cred-123" }),
}))

vi.mock("@/lib/api", () => ({
  registerBegin: vi.fn().mockResolvedValue({ challenge: "abc123" }),
  registerFinish: vi.fn().mockResolvedValue(undefined),
}))

function renderRegisterPage() {
  return render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>
  )
}

describe("RegisterPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders registration form", () => {
    renderRegisterPage()
    expect(screen.getByText("Create Account")).toBeInTheDocument()
    expect(screen.getByLabelText("Email")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /create account with passkey/i })).toBeInTheDocument()
  })

  it("shows link to sign in", () => {
    renderRegisterPage()
    expect(screen.getByText("Sign in")).toBeInTheDocument()
  })

  it("shows error on registration failure", async () => {
    const { registerBegin } = await import("@/lib/api")
    vi.mocked(registerBegin).mockRejectedValue(new Error("Registration failed"))

    renderRegisterPage()

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "test@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: /create account with passkey/i }))

    await waitFor(() => {
      expect(screen.getByText("Registration failed")).toBeInTheDocument()
    })
  })
})
