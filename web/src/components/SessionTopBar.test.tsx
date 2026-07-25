import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { SessionTopBar } from "@/components/SessionTopBar"
import type { QuickKeyStep } from "@/types/api"

function renderTopBar(pinnedKeys: Array<{ display_token: string; spec: QuickKeyStep[] }> = []) {
  return render(
    <SessionTopBar
      sessionName="Test Session"
      status="connected"
      pinnedKeys={pinnedKeys}
      onSendKey={vi.fn()}
      onOpenOverlay={vi.fn()}
      onConnect={vi.fn()}
      onDisconnect={vi.fn()}
      onBack={vi.fn()}
    />
  )
}

describe("SessionTopBar (mobile touch sizing)", () => {
  it("uses a taller bar with a top-facing border on mobile", () => {
    renderTopBar()
    const bar = screen.getByTestId("session-top-bar")
    // Mobile: taller and border on top (it lives at the bottom of the screen);
    // desktop reverts to a compact bar with a bottom border.
    expect(bar).toHaveClass("h-14", "min-h-14", "border-t")
    expect(bar).toHaveClass("md:h-10", "md:min-h-10", "md:border-b")
  })

  it("sizes the back button to the 44px touch standard on mobile", () => {
    renderTopBar()
    const back = screen.getByRole("button", { name: "Back to dashboard" })
    // h-11/w-11 == 44px on mobile, reverting to h-8/w-8 on desktop.
    expect(back).toHaveClass("h-11", "w-11", "md:h-8", "md:w-8")
  })

  it("sizes the quick-keys button to the 44px touch standard on mobile", () => {
    renderTopBar()
    const kbd = screen.getByTitle("Quick Keys")
    expect(kbd).toHaveClass("h-11", "w-11", "md:h-8", "md:w-8")
  })

  it("gives pinned quick-key pills a 44px minimum touch height on mobile", () => {
    const { container } = renderTopBar([{ display_token: "^C", spec: [] }])
    const pill = container.querySelector("[data-pill]")
    expect(pill).not.toBeNull()
    expect(pill).toHaveClass("min-h-11", "md:min-h-0")
  })
})
