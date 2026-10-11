import { useEffect, useRef, useState } from "react"
import { Filter } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * A funnel button that opens a dropdown of every tag in use; ticking tags
 * filters the session list to sessions that have ANY of them. A count shows on
 * the button while a filter is active. Closes on Escape or a click outside.
 */
export function TagFilter({
  tags,
  selected,
  onChange,
  className,
}: {
  tags: string[]
  selected: string[]
  onChange: (selected: string[]) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const isOn = (tag: string) => selected.some((s) => s.toLowerCase() === tag.toLowerCase())
  const toggle = (tag: string) =>
    onChange(isOn(tag) ? selected.filter((s) => s.toLowerCase() !== tag.toLowerCase()) : [...selected, tag])

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Filter by tags"
        title="Filter by tags"
        aria-haspopup="true"
        aria-expanded={open}
        data-testid="tag-filter-button"
        onClick={() => setOpen((o) => !o)}
        className={selected.length > 0 ? "border-primary text-primary" : undefined}
      >
        <Filter className="h-4 w-4" />
        {selected.length > 0 && (
          <span
            data-testid="tag-filter-count"
            className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
          >
            {selected.length}
          </span>
        )}
      </Button>
      {open && (
        <div
          role="group"
          aria-label="Filter sessions by tag"
          data-ui="tag-filter-panel"
          data-testid="tag-filter-panel"
          className="absolute left-0 top-full z-50 mt-1 w-52 rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
        >
          {tags.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">
              No tags yet. Add tags in a session&apos;s Details.
            </p>
          ) : (
            <ul className="max-h-64 space-y-0.5 overflow-y-auto">
              {tags.map((tag) => (
                <li key={tag}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground">
                    <input
                      type="checkbox"
                      checked={isOn(tag)}
                      onChange={() => toggle(tag)}
                      data-testid={`tag-filter-option-${tag}`}
                      className="h-4 w-4 accent-[hsl(var(--primary))]"
                    />
                    <span className="truncate">{tag}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {selected.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1 w-full"
              data-testid="tag-filter-clear"
              onClick={() => onChange([])}
            >
              Clear filter
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
