import { useCallback, useMemo, useState } from "react"
import { allTags, effectiveFilter, filterByTags, loadTagFilter, saveTagFilter } from "@/lib/tags"
import type { Session } from "@/types/api"

/**
 * The session tag filter, shared by the dashboard and the session side pane.
 *
 * Pass the sessions in display order. `visible` is those that match (ANY of the
 * selected tags); `selected` only holds tags that still exist. The selection is
 * saved in the browser so it survives reloads and moving between pages.
 */
export function useTagFilter(sessions: Session[]) {
  const [stored, setStored] = useState<string[]>(loadTagFilter)
  const tags = useMemo(() => allTags(sessions), [sessions])
  const selected = useMemo(() => effectiveFilter(stored, tags), [stored, tags])
  const visible = useMemo(() => filterByTags(sessions, selected), [sessions, selected])

  const setSelected = useCallback((next: string[]) => {
    setStored(next)
    saveTagFilter(next)
  }, [])
  const clear = useCallback(() => setSelected([]), [setSelected])

  return { tags, selected, setSelected, clear, visible }
}
