import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

const { mockGetSettings, mockUpdateSettings } = vi.hoisted(() => ({
  mockGetSettings: vi.fn().mockResolvedValue({ user_id: 1, theme: "dark-blue" }),
  mockUpdateSettings: vi.fn().mockResolvedValue({ user_id: 1, theme: "one-dark" }),
}))
vi.mock("@/lib/api", () => ({
  getSettings: mockGetSettings,
  updateSettings: mockUpdateSettings,
}))

import { ThemeProvider } from "@/contexts/ThemeContext"
import SettingsPage from "@/pages/SettingsPage"

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <SettingsPage />
      </ThemeProvider>
    </MemoryRouter>
  )
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    document.documentElement.removeAttribute("style")
  })

  it("lists both themes and marks the active one", () => {
    renderPage()
    expect(screen.getByTestId("theme-option-dark-blue")).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByTestId("theme-option-one-dark")).toHaveAttribute("aria-pressed", "false")
  })

  it("switching theme applies the CSS vars and persists to the server", async () => {
    renderPage()
    fireEvent.click(screen.getByTestId("theme-option-one-dark"))

    // Applied: One Dark background CSS variable is now on :root.
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--background").trim()).toBe("220 13% 18%")
    )
    // Persisted to the backend and cached locally.
    expect(mockUpdateSettings).toHaveBeenCalledWith({ theme: "one-dark" })
    expect(localStorage.getItem("theme")).toBe("one-dark")
    expect(screen.getByTestId("theme-option-one-dark")).toHaveAttribute("aria-pressed", "true")
  })
})
