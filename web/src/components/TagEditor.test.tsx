import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { TagEditor } from "@/components/TagEditor"

describe("TagEditor", () => {
  it("adds a trimmed tag on Enter, emoji included, and clears the field", async () => {
    const onChange = vi.fn()
    render(<TagEditor tags={["work"]} onChange={onChange} />)
    const input = screen.getByTestId("tag-input")
    fireEvent.change(input, { target: { value: "  🔥 urgent " } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["work", "🔥 urgent"]))
    expect(input).toHaveValue("")
  })

  it("removes a tag with its x button", async () => {
    const onChange = vi.fn()
    render(<TagEditor tags={["a", "b"]} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText("Remove tag a"))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["b"]))
  })

  it("rejects bad input with a message and does not save", async () => {
    const onChange = vi.fn()
    render(<TagEditor tags={["work"]} onChange={onChange} />)
    const input = screen.getByTestId("tag-input")
    for (const bad of ["a,b", "WORK", "   "]) {
      fireEvent.change(input, { target: { value: bad } })
      fireEvent.keyDown(input, { key: "Enter" })
      expect(await screen.findByTestId("tag-error")).toBeInTheDocument()
    }
    expect(onChange).not.toHaveBeenCalled()
  })

  it("clears the error once the user types again", async () => {
    render(<TagEditor tags={[]} onChange={() => {}} />)
    const input = screen.getByTestId("tag-input")
    fireEvent.change(input, { target: { value: "a,b" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await screen.findByTestId("tag-error")
    fireEvent.change(input, { target: { value: "ab" } })
    expect(screen.queryByTestId("tag-error")).toBeNull()
  })

  it("shows an error when saving fails", async () => {
    const onChange = vi.fn().mockRejectedValue(new Error("boom"))
    render(<TagEditor tags={[]} onChange={onChange} />)
    const input = screen.getByTestId("tag-input")
    fireEvent.change(input, { target: { value: "x" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(await screen.findByTestId("tag-error")).toHaveTextContent(/Could not save/)
  })

  it("offers tags from other sessions that this one does not have yet", () => {
    const { container } = render(
      <TagEditor tags={["work"]} suggestions={["work", "home", "ops"]} onChange={() => {}} />
    )
    const options = [...container.querySelectorAll("datalist option")].map((o) => o.getAttribute("value"))
    expect(options).toEqual(["home", "ops"])
  })
})
