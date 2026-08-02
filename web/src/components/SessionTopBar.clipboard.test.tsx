import { describe, it, expect, vi } from "vitest"
import { render, fireEvent } from "@testing-library/react"
import { SessionTopBar } from "./SessionTopBar"

function baseProps() {
  return {
    sessionName: "s",
    status: "connected" as const,
    pinnedKeys: [],
    onSendKey: vi.fn(),
    onOpenOverlay: vi.fn(),
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onBack: vi.fn(),
  }
}

describe("SessionTopBar clipboard pill", () => {
  it("shows the size and a Copy button, and Copy calls onCopyClipboard", () => {
    const onCopy = vi.fn()
    const { getByTestId } = render(
      <SessionTopBar
        {...baseProps()}
        clipboard={{ text: "hello", bytes: 5, status: "ready" }}
        onCopyClipboard={onCopy}
      />
    )
    const pill = getByTestId("clipboard-pill")
    expect(pill.textContent).toContain("Clipboard ready")
    expect(pill.textContent).toContain("5 B")
    fireEvent.click(getByTestId("clipboard-copy"))
    expect(onCopy).toHaveBeenCalledTimes(1)
  })

  it("shows a Copied state", () => {
    const { getByTestId } = render(
      <SessionTopBar {...baseProps()} clipboard={{ text: "x", bytes: 1, status: "copied" }} />
    )
    expect(getByTestId("clipboard-pill").textContent).toContain("Copied")
  })

  it("renders no pill when clipboard is null", () => {
    const { queryByTestId } = render(<SessionTopBar {...baseProps()} clipboard={null} />)
    expect(queryByTestId("clipboard-pill")).toBeNull()
  })
})
