import { describe, it, expect, vi } from "vitest"
import { render, fireEvent } from "@testing-library/react"
import { useDragReorder } from "./useDragReorder"

// A tiny list component wired to the hook so we can drive real drag events.
function List({
  ids,
  onReorder,
}: {
  ids: string[]
  onReorder: (ids: string[]) => void
}) {
  const dnd = useDragReorder(ids, onReorder)
  return (
    <ul>
      {ids.map((id) => (
        <li key={id} data-testid={id} {...dnd.dragHandleProps(id)} {...dnd.dropTargetProps(id)}>
          {id}
        </li>
      ))}
    </ul>
  )
}

function dt() {
  return { setData: vi.fn(), getData: vi.fn(), effectAllowed: "", dropEffect: "" }
}

describe("useDragReorder", () => {
  it("moves the dragged item to the drop target's position", () => {
    const onReorder = vi.fn()
    const { getByTestId } = render(<List ids={["a", "b", "c"]} onReorder={onReorder} />)

    const dataTransfer = dt()
    fireEvent.dragStart(getByTestId("a"), { dataTransfer })
    fireEvent.dragEnter(getByTestId("c"), { dataTransfer })
    fireEvent.drop(getByTestId("c"), { dataTransfer })

    // 'a' moves to where 'c' was: [a,b,c] -> [b,c,a]
    expect(onReorder).toHaveBeenCalledTimes(1)
    expect(onReorder).toHaveBeenCalledWith(["b", "c", "a"])
  })

  it("moving up reorders correctly", () => {
    const onReorder = vi.fn()
    const { getByTestId } = render(<List ids={["a", "b", "c"]} onReorder={onReorder} />)

    const dataTransfer = dt()
    fireEvent.dragStart(getByTestId("c"), { dataTransfer })
    fireEvent.drop(getByTestId("a"), { dataTransfer })

    // 'c' moves to index 0: [a,b,c] -> [c,a,b]
    expect(onReorder).toHaveBeenCalledWith(["c", "a", "b"])
  })

  it("does not reorder when dropped on itself", () => {
    const onReorder = vi.fn()
    const { getByTestId } = render(<List ids={["a", "b", "c"]} onReorder={onReorder} />)

    const dataTransfer = dt()
    fireEvent.dragStart(getByTestId("b"), { dataTransfer })
    fireEvent.drop(getByTestId("b"), { dataTransfer })

    expect(onReorder).not.toHaveBeenCalled()
  })
})
