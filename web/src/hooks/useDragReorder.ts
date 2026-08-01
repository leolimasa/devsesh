import { useCallback, useRef, useState } from "react"

/**
 * Minimal native HTML5 drag-and-drop reordering for a list keyed by string id.
 *
 * Split into a drag *handle* (what you grab) and a drop *target* (where you drop)
 * so callers can, e.g., make a small grip icon the handle while the whole row is
 * the target. For simple lists, spread both onto the same element.
 *
 * On a successful drop it calls `onReorder` with the full list of ids in their
 * new order — the caller persists that (and typically updates local state).
 *
 * Note: native HTML5 DnD is desktop/mouse only; it does not fire for touch.
 */
export interface DragReorder {
  draggingId: string | null
  overId: string | null
  dragHandleProps: (id: string) => {
    draggable: true
    onDragStart: (e: React.DragEvent) => void
    onDragEnd: () => void
  }
  dropTargetProps: (id: string) => {
    onDragEnter: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
  }
}

export function useDragReorder(
  orderedIds: string[],
  onReorder: (ids: string[]) => void
): DragReorder {
  const draggingRef = useRef<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const finish = useCallback(
    (targetId: string | null) => {
      const dragId = draggingRef.current
      if (dragId && targetId && dragId !== targetId) {
        const ids = [...orderedIds]
        const from = ids.indexOf(dragId)
        const to = ids.indexOf(targetId)
        if (from !== -1 && to !== -1) {
          ids.splice(to, 0, ids.splice(from, 1)[0])
          onReorder(ids)
        }
      }
      draggingRef.current = null
      setDraggingId(null)
      setOverId(null)
    },
    [orderedIds, onReorder]
  )

  const dragHandleProps = useCallback(
    (id: string) => ({
      draggable: true as const,
      onDragStart: (e: React.DragEvent) => {
        draggingRef.current = id
        setDraggingId(id)
        e.dataTransfer.effectAllowed = "move"
        // Firefox requires data to be set for a drag to actually start.
        e.dataTransfer.setData("text/plain", id)
      },
      onDragEnd: () => finish(null),
    }),
    [finish]
  )

  const dropTargetProps = useCallback(
    (id: string) => ({
      onDragEnter: (e: React.DragEvent) => {
        e.preventDefault()
        if (draggingRef.current && draggingRef.current !== id) setOverId(id)
      },
      onDragOver: (e: React.DragEvent) => {
        // Required so the element is a valid drop target.
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        finish(id)
      },
    }),
    [finish]
  )

  return { draggingId, overId, dragHandleProps, dropTargetProps }
}
