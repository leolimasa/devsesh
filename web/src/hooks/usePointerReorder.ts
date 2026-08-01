import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Pointer-based vertical list reordering that works for BOTH touch and mouse
 * (native HTML5 drag-and-drop does not fire for touch). Grab a handle, drag up
 * or down, and the list reflows live; on release the new order is committed via
 * `onReorder`.
 *
 * Wiring:
 *   const r = usePointerReorder(ids, onReorder)
 *   <div ref={r.containerRef}>
 *     {r.order.map(id => (
 *       <div key={id} data-reorder-id={id} data-dragging={r.draggingId === id}>
 *         <button {...r.handleProps(id)}>grip</button>
 *       </div>
 *     ))}
 *   </div>
 *
 * Render your items in `r.order` (not the raw input) so the drag preview shows.
 * Every draggable row must carry `data-reorder-id={id}` so positions can be
 * measured. The handle sets `touch-action: none` so dragging it never scrolls
 * the page.
 */
export interface PointerReorder {
  containerRef: React.RefObject<HTMLDivElement>
  order: string[]
  draggingId: string | null
  handleProps: (id: string) => {
    onPointerDown: (e: React.PointerEvent) => void
    style: { touchAction: "none" }
  }
}

export function usePointerReorder(
  ids: string[],
  onReorder: (ids: string[]) => void
): PointerReorder {
  const containerRef = useRef<HTMLDivElement>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [order, setOrder] = useState<string[]>(ids)
  // Live order + input snapshot, read synchronously inside pointer handlers.
  const orderRef = useRef<string[]>(ids)
  const idsRef = useRef<string[]>(ids)
  idsRef.current = ids

  // While NOT dragging, mirror the input order (e.g. after a websocket update or
  // a persisted reorder). During a drag we own `order` for the live preview.
  // Compare CONTENT, not array identity: callers typically pass a freshly-mapped
  // `ids` array every render, so syncing on reference would setState on every
  // render and loop ("Maximum update depth exceeded").
  const idsKey = ids.join("|")
  useEffect(() => {
    if (!draggingId && idsKey !== orderRef.current.join("|")) {
      orderRef.current = ids
      setOrder(ids)
    }
    // idsKey captures ids content; ids ref intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, draggingId])

  const onPointerDown = useCallback(
    (id: string) => (e: React.PointerEvent) => {
      // Left button for mouse; any touch/pen contact.
      if (e.pointerType === "mouse" && e.button !== 0) return
      e.preventDefault()
      const handle = e.currentTarget as Element
      try {
        handle.setPointerCapture(e.pointerId)
      } catch {
        /* not supported (e.g. jsdom) — window listeners still track the drag */
      }

      orderRef.current = [...idsRef.current]
      setOrder(orderRef.current)
      setDraggingId(id)

      const move = (ev: PointerEvent) => {
        const container = containerRef.current
        if (!container) return
        const items = Array.from(
          container.querySelectorAll<HTMLElement>("[data-reorder-id]")
        )
        if (items.length === 0) return

        // Target index = first item whose vertical midpoint is below the
        // pointer; past the last midpoint it lands at the end.
        let target = items.length - 1
        for (let i = 0; i < items.length; i++) {
          const rect = items[i].getBoundingClientRect()
          if (ev.clientY < rect.top + rect.height / 2) {
            target = i
            break
          }
        }

        const cur = [...orderRef.current]
        const from = cur.indexOf(id)
        if (from === -1 || from === target) return
        cur.splice(target, 0, cur.splice(from, 1)[0])
        orderRef.current = cur
        setOrder(cur)
      }

      const end = () => {
        window.removeEventListener("pointermove", move)
        window.removeEventListener("pointerup", end)
        window.removeEventListener("pointercancel", end)
        setDraggingId(null)
        const final = orderRef.current
        // Only persist if the order actually changed.
        if (final.join("|") !== idsRef.current.join("|")) onReorder(final)
      }

      window.addEventListener("pointermove", move)
      window.addEventListener("pointerup", end)
      window.addEventListener("pointercancel", end)
    },
    [onReorder]
  )

  const handleProps = useCallback(
    (id: string) => ({
      onPointerDown: onPointerDown(id),
      style: { touchAction: "none" as const },
    }),
    [onPointerDown]
  )

  return { containerRef, order, draggingId, handleProps }
}
