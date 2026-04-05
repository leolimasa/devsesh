import { describe, it, expect, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { AuthProvider, useAuth } from "@/contexts/AuthContext"

function TestComponent() {
  const { user, token, login, logout, isAuthenticated } = useAuth()
  return (
    <div>
      <span data-testid="token">{token || "none"}</span>
      <span data-testid="user">{user ? user.email : "none"}</span>
      <span data-testid="authenticated">{isAuthenticated ? "true" : "false"}</span>
      <button onClick={() => login("test-token", { id: 1, email: "test@example.com", token: "test-token" })}>
        Login
      </button>
      <button onClick={logout}>Logout</button>
    </div>
  )
}

describe("AuthContext", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("starts with no user and no token", () => {
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    )

    expect(screen.getByTestId("token").textContent).toBe("none")
    expect(screen.getByTestId("user").textContent).toBe("none")
    expect(screen.getByTestId("authenticated").textContent).toBe("false")
  })

  it("logs in and stores user and token", () => {
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    )

    fireEvent.click(screen.getByText("Login"))

    expect(screen.getByTestId("token").textContent).toBe("test-token")
    expect(screen.getByTestId("user").textContent).toBe("test@example.com")
    expect(screen.getByTestId("authenticated").textContent).toBe("true")
    expect(localStorage.getItem("token")).toBe("test-token")
    expect(JSON.parse(localStorage.getItem("user")!)).toEqual({
      id: 1,
      email: "test@example.com",
      token: "test-token",
    })
  })

  it("logs out and clears storage", () => {
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    )

    fireEvent.click(screen.getByText("Login"))
    fireEvent.click(screen.getByText("Logout"))

    expect(screen.getByTestId("token").textContent).toBe("none")
    expect(screen.getByTestId("user").textContent).toBe("none")
    expect(screen.getByTestId("authenticated").textContent).toBe("false")
    expect(localStorage.getItem("token")).toBeNull()
    expect(localStorage.getItem("user")).toBeNull()
  })

  it("restores auth state from localStorage on mount", () => {
    localStorage.setItem("token", "stored-token")
    localStorage.setItem("user", JSON.stringify({ id: 2, email: "stored@example.com", token: "stored-token" }))

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    )

    expect(screen.getByTestId("token").textContent).toBe("stored-token")
    expect(screen.getByTestId("user").textContent).toBe("stored@example.com")
    expect(screen.getByTestId("authenticated").textContent).toBe("true")
  })
})
