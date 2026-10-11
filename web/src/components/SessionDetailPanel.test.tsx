import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react"
import { SessionDetailPanel } from "@/components/SessionDetailPanel"
import type { Session } from "@/types/api"

const make = (id: string, tags: string[] = []): Session => ({
  id,
  user_id: 1,
  host_id: 1,
  name: `name-${id}`,
  started_at: "2026-01-01T00:00:00Z",
  last_ping_at: null,
  last_activity_at: null,
  ended_at: null,
  metadata: null,
  tags,
})

function setup(overrides: Partial<React.ComponentProps<typeof SessionDetailPanel>> = {}) {
  const all = [make("a", ["work"]), make("b", ["home"]), make("c", ["work", "home"]), make("d")]
  const props = {
    session: all[0],
    sessions: all,
    currentId: "a",
    onSelectSession: vi.fn(),
    onReorderSessions: vi.fn(),
    onNewSession: vi.fn(),
    totalCount: all.length,
    availableTags: ["home", "work"],
    selectedTags: [] as string[],
    onTagFilterChange: vi.fn(),
    onTagsChange: vi.fn(),
    ...overrides,
  }
  render(<SessionDetailPanel {...props} />)
  return props
}

const openSessionsTab = () => fireEvent.click(screen.getByRole("tab", { name: "Sessions" }))

describe("SessionDetailPanel toolbar", () => {
  it("has the new-session + and the filter funnel on one line in the Sessions tab only", () => {
    setup()
    // Details tab is the default: no toolbar, and no New session button above the tabs.
    expect(screen.queryByLabelText("New session")).toBeNull()
    expect(screen.queryByTestId("sessions-toolbar")).toBeNull()

    openSessionsTab()
    const toolbar = screen.getByTestId("sessions-toolbar")
    const plus = within(toolbar).getByLabelText("New session")
    expect(plus).toHaveTextContent("")
    expect(within(toolbar).getByLabelText("Filter by tags")).toBeInTheDocument()
  })
})

describe("SessionDetailPanel list", () => {
  it("shows each session's tags", () => {
    setup()
    openSessionsTab()
    const row = screen.getByTestId("session-item-c")
    expect(within(row).getByText("work")).toBeInTheDocument()
    expect(within(row).getByText("home")).toBeInTheDocument()
    expect(within(screen.getByTestId("session-item-d")).queryByTestId("tag-chips")).toBeNull()
  })

  it("numbers the listed sessions 1..n with no gaps when filtered", () => {
    const all = [make("a", ["work"]), make("b", ["home"]), make("c", ["work", "home"]), make("d")]
    // The page passes only the sessions that match the filter ("home": b and c).
    setup({ sessions: [all[1], all[2]], selectedTags: ["home"], totalCount: 4 })
    openSessionsTab()
    expect(within(screen.getByTestId("session-item-b")).getByText("1")).toBeInTheDocument()
    expect(within(screen.getByTestId("session-item-c")).getByText("2")).toBeInTheDocument()
    expect(screen.queryByTestId("session-item-a")).toBeNull()
    expect(screen.getByTestId("filter-summary")).toHaveTextContent("2 of 4")
  })

  it("does not show the summary without a filter", () => {
    setup()
    openSessionsTab()
    expect(screen.queryByTestId("filter-summary")).toBeNull()
  })

  it("passes filter changes up", () => {
    const props = setup()
    openSessionsTab()
    fireEvent.click(screen.getByLabelText("Filter by tags"))
    fireEvent.click(screen.getByTestId("tag-filter-option-home"))
    expect(props.onTagFilterChange).toHaveBeenCalledWith(["home"])
  })
})

describe("SessionDetailPanel tag editing", () => {
  it("edits the current session's tags in the Details tab", async () => {
    const props = setup()
    expect(screen.getByTestId("tag-chip-work")).toBeInTheDocument()
    const input = screen.getByTestId("tag-input")
    fireEvent.change(input, { target: { value: "🚀" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(props.onTagsChange).toHaveBeenCalledWith(["work", "🚀"]))

    fireEvent.click(screen.getByLabelText("Remove tag work"))
    await waitFor(() => expect(props.onTagsChange).toHaveBeenLastCalledWith([]))
  })
})
