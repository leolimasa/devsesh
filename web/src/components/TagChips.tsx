import { cn } from "@/lib/utils"

// Read-only tag chips, used in the session lists. Renders nothing for no tags.
export function TagChips({ tags, className }: { tags?: string[]; className?: string }) {
  if (!tags || tags.length === 0) return null
  return (
    <span className={cn("flex flex-wrap gap-1", className)} data-testid="tag-chips">
      {tags.map((tag) => (
        <span
          key={tag}
          data-ui="tag"
          title={tag}
          className="inline-flex max-w-full items-center rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
        >
          <span className="truncate">{tag}</span>
        </span>
      ))}
    </span>
  )
}
