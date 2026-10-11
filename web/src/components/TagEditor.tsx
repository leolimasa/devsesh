import { useId, useState } from "react"
import { X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { checkNewTag, MAX_TAG_LENGTH } from "@/lib/tags"

/**
 * Edit one session's tags: a chip per tag with a remove button, and a field to
 * add more (Enter adds). Tags may be any text, including emoji. `suggestions`
 * (tags used on other sessions) are offered as you type.
 *
 * `onChange` receives the complete new list and may return a promise; if it
 * rejects the editor shows an error and the parent is expected to have kept its
 * previous value.
 */
export function TagEditor({
  tags,
  suggestions = [],
  onChange,
}: {
  tags: string[]
  suggestions?: string[]
  onChange: (tags: string[]) => void | Promise<void>
}) {
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  const listId = useId()

  const commit = async (next: string[]) => {
    setError(null)
    try {
      await onChange(next)
    } catch {
      setError("Could not save tags. Try again.")
    }
  }

  const add = async () => {
    const check = checkNewTag(draft, tags)
    if (!check.ok) {
      setError(check.error)
      return
    }
    setDraft("")
    await commit([...tags, check.tag])
  }

  const remove = (tag: string) => commit(tags.filter((t) => t !== tag))

  const unused = suggestions.filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()))

  return (
    <div className="space-y-2" data-testid="tag-editor">
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Session tags">
          {tags.map((tag) => (
            <li
              key={tag}
              data-ui="tag"
              data-testid={`tag-chip-${tag}`}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-secondary py-0.5 pl-2 pr-1 text-xs text-secondary-foreground"
            >
              <span className="truncate">{tag}</span>
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                onClick={() => remove(tag)}
                className="rounded-full p-0.5 hover:bg-background/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        data-testid="tag-input"
        value={draft}
        list={listId}
        maxLength={MAX_TAG_LENGTH * 2}
        placeholder="Add a tag, press Enter"
        aria-label="Add tag"
        aria-invalid={error ? true : undefined}
        className="h-8 text-xs"
        onChange={(e) => {
          setDraft(e.target.value)
          if (error) setError(null)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            void add()
          }
        }}
      />
      <datalist id={listId}>
        {unused.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {error && (
        <p role="alert" data-testid="tag-error" className="text-xs text-destructive-foreground/90 rounded bg-destructive/60 px-2 py-1">
          {error}
        </p>
      )}
    </div>
  )
}
