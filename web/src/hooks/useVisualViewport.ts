import { useState, useEffect, useCallback } from "react"

// Subscribe to window.visualViewport resize/scroll events and return the
// current viewport height. When the on-screen keyboard opens, visualViewport
// height shrinks, which is what the terminal sizing keys off of.
// Isolated so the fiddly iOS Safari behavior lives in one place.
export function useVisualViewport() {
  const [height, setHeight] = useState<number>(0)

  const update = useCallback(() => {
    const vv = window.visualViewport
    setHeight(vv ? vv.height : window.innerHeight)
  }, [])

  useEffect(() => {
    update()

    const vv = window.visualViewport
    if (!vv) return

    vv.addEventListener("resize", update)
    vv.addEventListener("scroll", update)
    return () => {
      vv.removeEventListener("resize", update)
      vv.removeEventListener("scroll", update)
    }
  }, [update])

  return { height }
}
