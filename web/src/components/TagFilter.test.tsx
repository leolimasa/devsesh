import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TagFilter } from "@/components/TagFilter"

describe("TagFilter", () => {
  it("opens a list of tags and reports ticks (adding to the current selection)", () => {
    const onChange = vi.fn()
    render(<TagFilter tags={["home", "work"]} selected={["work"]} onChange={onChange} />)
    expect(screen.queryByTestId("tag-filter-panel")).toBeNull()

    fireEvent.click(screen.getByLabelText("Filter by tags"))
    expect(screen.getByTestId("tag-filter-option-work")).toBeChecked()
    expect(screen.getByTestId("tag-filter-option-home")).not.toBeChecked()

    fireEvent.click(screen.getByTestId("tag-filter-option-home"))
    expect(onChange).toHaveBeenCalledWith(["work", "home"])

    fireEvent.click(screen.getByTestId("tag-filter-option-work"))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it("shows how many tags are selected and can clear them", () => {
    const onChange = vi.fn()
    render(<TagFilter tags={["a", "b"]} selected={["a", "b"]} onChange={onChange} />)
    expect(screen.getByTestId("tag-filter-count")).toHaveTextContent("2")
    fireEvent.click(screen.getByLabelText("Filter by tags"))
    fireEvent.click(screen.getByTestId("tag-filter-clear"))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it("shows no count and no clear button without a selection", () => {
    render(<TagFilter tags={["a"]} selected={[]} onChange={() => {}} />)
    expect(screen.queryByTestId("tag-filter-count")).toBeNull()
    fireEvent.click(screen.getByLabelText("Filter by tags"))
    expect(screen.queryByTestId("tag-filter-clear")).toBeNull()
  })

  it("explains when no session has tags yet", () => {
    render(<TagFilter tags={[]} selected={[]} onChange={() => {}} />)
    fireEvent.click(screen.getByLabelText("Filter by tags"))
    expect(screen.getByText(/No tags yet/)).toBeInTheDocument()
  })

  it("closes on Escape and on a click outside", () => {
    render(
      <div>
        <span data-testid="outside">outside</span>
        <TagFilter tags={["a"]} selected={[]} onChange={() => {}} />
      </div>
    )
    const open = () => fireEvent.click(screen.getByLabelText("Filter by tags"))
    open()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByTestId("tag-filter-panel")).toBeNull()
    open()
    fireEvent.mouseDown(screen.getByTestId("outside"))
    expect(screen.queryByTestId("tag-filter-panel")).toBeNull()
  })
})
