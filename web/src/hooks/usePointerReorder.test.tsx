import { describe, it, expect, vi } from "vitest"
import { render, fireEvent } from "@testing-library/react"
import { usePointerReorder } from "./usePointerReorder"

function List({
  ids,
  onReorder,
}: {
  ids: string[]
  onReorder: (ids: string[]) => void
}) {
  const r = usePointerReorder(ids, onReorder)
  return (
    <div ref={r.containerRef}>
      {r.order.map((id) => (
        <div key={id} data-reorder-id={id} data-testid={`row-${id}`}>
          <button data-testid={`handle-${id}`} {...r.handleProps(id)}>
            grip {id}
          </button>
        </div>
      ))}
    </div>
  )
}

// Give each row a fixed vertical slot: a=[0,50), b=[50,100), c=[100,150).
function mockRects(container: HTMLElement) {
  const slots: Record<string, { top: number; height: number }> = {
    a: { top: 0, height: 50 },
    b: { top: 50, height: 50 },
    c: { top: 100, height: 50 },
  }
  container.querySelectorAll<HTMLElement>("[data-reorder-id]").forEach((el) => {
    const id = el.getAttribute("data-reorder-id") as string
    el.getBoundingClientRect = () =>
      ({ top: slots[id].top, height: slots[id].height, bottom: slots[id].top + slots[id].height, left: 0, right: 0, width: 0, x: 0, y: slots[id].top, toJSON: () => {} }) as DOMRect
  })
}

describe("usePointerReorder", () => {
  it("commits a new order after a touch drag down", () => {
    const onReorder = vi.fn()
    const { getByTestId, container } = render(<List ids={["a", "b", "c"]} onReorder={onReorder} />)
    mockRects(container)

    fireEvent.pointerDown(getByTestId("handle-a"), { pointerId: 1, pointerType: "touch", button: 0 })
    // Drag well past c's midpoint (125) -> 'a' lands last.
    window.dispatchEvent(new MouseEvent("pointermove", { clientY: 130 }))
    window.dispatchEvent(new MouseEvent("pointerup", {}))

    expect(onReorder).toHaveBeenCalledTimes(1)
    expect(onReorder).toHaveBeenCalledWith(["b", "c", "a"])
  })

  it("is stable when given a fresh ids array every render", () => {
    // Callers typically pass `list.map(x => x.id)` — a new array reference each
    // render. The hook must sync on content, not identity; otherwise it setStates
    // on every render and throws "Maximum update depth exceeded". Rendering (and
    // a forced re-render) without crashing proves the guard works.
    function FreshArrayList({ tick }: { tick: number }) {
      const ids = ["a", "b", "c"].slice() // new array each render
      const r = usePointerReorder(ids, () => {})
      return <div data-testid={`tick-${tick}`}>{r.order.join(",")}</div>
    }
    const { rerender, getByTestId } = render(<FreshArrayList tick={0} />)
    expect(getByTestId("tick-0").textContent).toBe("a,b,c")
    rerender(<FreshArrayList tick={1} />)
    expect(getByTestId("tick-1").textContent).toBe("a,b,c")
  })

  it("does not commit when the order is unchanged", () => {
    const onReorder = vi.fn()
    const { getByTestId, container } = render(<List ids={["a", "b", "c"]} onReorder={onReorder} />)
    mockRects(container)

    fireEvent.pointerDown(getByTestId("handle-b"), { pointerId: 1, pointerType: "touch", button: 0 })
    // Stay within b's own slot -> no reorder.
    window.dispatchEvent(new MouseEvent("pointermove", { clientY: 70 }))
    window.dispatchEvent(new MouseEvent("pointerup", {}))

    expect(onReorder).not.toHaveBeenCalled()
  })
})
