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

  it("lists every theme and marks the active one", () => {
    renderPage()
    expect(screen.getByTestId("theme-option-dark-blue")).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByTestId("theme-option-one-dark")).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByTestId("theme-option-scifi-rts")).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByText("SciFi RTS")).toBeInTheDocument()
  })

  it("switching theme applies the CSS vars and persists to the server", async () => {
    renderPage()
    fireEvent.click(screen.getByTestId("theme-option-one-dark"))

    // Applied: One Dark background CSS variable is now on :root.
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--background").trim()).toBe("220 13% 18%")
    )
    // PWA title-bar color (meta theme-color) tracks the theme.
    expect(
      document.querySelector('meta[name="theme-color"]')?.getAttribute("content")
    ).toBe("#282c34")
    // Persisted to the backend and cached locally.
    expect(mockUpdateSettings).toHaveBeenCalledWith({ theme: "one-dark" })
    expect(localStorage.getItem("theme")).toBe("one-dark")
    expect(screen.getByTestId("theme-option-one-dark")).toHaveAttribute("aria-pressed", "true")
  })

  it("switching to SciFi RTS applies its skin and switching back removes it", async () => {
    renderPage()
    fireEvent.click(screen.getByTestId("theme-option-scifi-rts"))

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("scifi-rts"))
    expect(document.documentElement.style.getPropertyValue("--glow")).not.toBe("")
    expect(document.documentElement.style.getPropertyValue("--radius")).toBe("0.25rem")
    expect(
      document.querySelector('meta[name="theme-color"]')?.getAttribute("content")
    ).toBe("#050a14")
    expect(mockUpdateSettings).toHaveBeenCalledWith({ theme: "scifi-rts" })
    expect(localStorage.getItem("theme")).toBe("scifi-rts")

    // Switching back must not leave SciFi RTS-only variables behind.
    fireEvent.click(screen.getByTestId("theme-option-dark-blue"))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark-blue"))
    expect(document.documentElement.style.getPropertyValue("--glow")).toBe("")
    expect(document.documentElement.style.getPropertyValue("--radius")).toBe("")
  })
})
