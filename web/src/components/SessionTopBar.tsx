// Shared top bar for session detail: session name, connection status,
// pinned quick-key pills, keyboard icon (opens QuickKeysOverlay),
// and connect/disconnect button.
// On mobile it also hosts the hamburger (details).
import { useRef, useState, useEffect, useCallback } from "react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Keyboard, ArrowLeft } from "lucide-react"
import type { QuickKeyStep, ConnectionStatus } from "@/types/api"

type Status = ConnectionStatus

interface SessionTopBarProps {
  sessionName: string
  status: Status
  // Detail behind an "error" status (e.g. "connection lost (keepalive failed)").
  // Shown when the user taps the "Error" label.
  statusError?: string
  pinnedKeys: Array<{ display_token: string; spec: QuickKeyStep[] }>
  onSendKey: (spec: QuickKeyStep[]) => void
  onOpenOverlay: () => void
  onConnect: () => void
  onDisconnect: () => void
  onBack: () => void
  hamburger?: ReactNode
  // Pending clipboard buffer pushed from `devsesh copy` for this session, awaiting
  // a user gesture to commit to the OS clipboard. Null when nothing is pending.
  clipboard?: { text: string; bytes: number; status: "ready" | "copied" | "error" } | null
  onCopyClipboard?: () => void
  onDismissClipboard?: () => void
}

// formatBytes renders a byte count compactly for the clipboard pill.
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// ClipboardPill shows the pending `devsesh copy` buffer and commits it to the OS
// clipboard on click (the required user gesture). Purely presentational — the
// buffer + status are owned by the parent.
function ClipboardPill({
  clipboard,
  onCopy,
  onDismiss,
}: {
  clipboard: { text: string; bytes: number; status: "ready" | "copied" | "error" }
  onCopy?: () => void
  onDismiss?: () => void
}) {
  return (
    <div
      data-testid="clipboard-pill"
      className="flex items-center gap-2 shrink-0 rounded-full border bg-muted px-2 py-0.5 text-xs"
    >
      {clipboard.status === "copied" ? (
        <span className="font-medium text-green-600">Copied ✓</span>
      ) : clipboard.status === "error" ? (
        <>
          <span className="text-destructive">Copy failed</span>
          <button type="button" className="font-medium underline" onClick={onCopy}>
            Retry
          </button>
        </>
      ) : (
        <>
          <span className="text-muted-foreground">Clipboard ready · {formatBytes(clipboard.bytes)}</span>
          <button type="button" data-testid="clipboard-copy" className="font-medium underline" onClick={onCopy}>
            Copy
          </button>
        </>
      )}
      <button
        type="button"
        aria-label="Dismiss clipboard"
        className="text-muted-foreground hover:text-foreground"
        onClick={onDismiss}
      >
        ✕
      </button>
    </div>
  )
}

const STATUS_LABELS: Record<Status, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting...",
  authenticating: "Authenticating...",
  connected: "Connected",
  error: "Error",
}

const STATUS_COLORS: Record<Status, string> = {
  disconnected: "bg-red-500",
  connecting: "bg-yellow-500",
  authenticating: "bg-yellow-500",
  connected: "bg-green-500",
  error: "bg-red-500",
}

export function SessionTopBar({
  sessionName,
  status,
  statusError,
  pinnedKeys,
  onSendKey,
  onOpenOverlay,
  onConnect,
  onDisconnect,
  onBack,
  hamburger,
  clipboard,
  onCopyClipboard,
  onDismissClipboard,
}: SessionTopBarProps) {
  const [showError, setShowError] = useState(false)
  const regionRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(pinnedKeys.length)

  // Measure overflow against the pills region's own available width.
  //
  // The region is a flex-1 slot whose width is stable regardless of how many
  // pills are currently shown, so we can measure a hidden, always-full row of
  // pills (measureRef) and count how many fit within the region's right edge.
  // Pills beyond that are collapsed into the overlay via the "+N" indicator.
  const measureOverflow = useCallback(() => {
    const region = regionRef.current
    const measure = measureRef.current
    if (!region || !measure) return

    const availRight = region.getBoundingClientRect().left + region.clientWidth
    const pills = measure.querySelectorAll<HTMLElement>("[data-measure-pill]")

    let count = 0
    for (const pill of pills) {
      // Allow a sub-pixel tolerance so a pill sitting exactly on the boundary
      // isn't wrongly excluded by fractional getBoundingClientRect rounding.
      if (pill.getBoundingClientRect().right <= availRight + 0.5) {
        count++
      } else {
        break
      }
    }
    setVisibleCount(count)
  }, [])

  useEffect(() => {
    measureOverflow()

    // Re-measure once web fonts are ready. Color-emoji glyphs commonly load
    // after first paint and reflow a pill wider than its fallback width; the
    // initial measurement is against the fallback, so without this a wider
    // emoji pill silently overflows the clipped region (no "+N", just gone).
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(measureOverflow).catch(() => {})
    }

    if (typeof ResizeObserver === "undefined") return
    const obs = new ResizeObserver(measureOverflow)
    if (regionRef.current) obs.observe(regionRef.current)
    // Observe the hidden measure row too: a glyph reflow (e.g. emoji font
    // finishing loading) changes its content width even when the region's own
    // box stays the same size — which a region-only observer would miss.
    if (measureRef.current) obs.observe(measureRef.current)
    return () => obs.disconnect()
  }, [measureOverflow, pinnedKeys])

  return (
    // On mobile the bar is taller and sits at the bottom of the screen (see the
    // `order-last` on its wrapper in SessionDetailPage), so its border faces up
    // and its controls are sized for touch. On desktop it reverts to a compact
    // top bar with a bottom border.
    <div
      data-testid="session-top-bar"
      className="flex items-center gap-2 px-2 py-1 bg-muted border-t md:border-t-0 md:border-b h-14 min-h-14 md:h-10 md:min-h-10 flex-shrink-0"
    >
      {/* Back to dashboard */}
      <Button
        variant="ghost"
        size="icon"
        className="h-11 w-11 md:h-8 md:w-8 shrink-0"
        onClick={onBack}
        title="Back to dashboard"
        aria-label="Back to dashboard"
      >
        <ArrowLeft className="h-5 w-5 md:h-4 md:w-4" />
      </Button>

      {/* Mobile hamburger */}
      {hamburger}

      {/* Session name (far left) — hidden on mobile to save space */}
      <span className="hidden md:inline font-medium text-sm truncate min-w-0 max-w-[200px]">
        {sessionName}
      </span>

      {/* Connection status. When connected on mobile, show only the dot
          (the green dot alone conveys "connected"); the label still shows
          on desktop and for every other status. */}
      <div className="relative flex items-center gap-1 text-xs shrink-0">
        <span className={`inline-block w-2 h-2 rounded-full ${STATUS_COLORS[status]}`} />
        {status === "error" ? (
          // Tap to reveal the underlying error (keepalive/idle drop, auth, etc.)
          // instead of a bare "Error". title= gives desktop a hover tooltip too.
          <button
            type="button"
            data-testid="status-error-button"
            className="text-muted-foreground underline decoration-dotted"
            title={statusError || "Connection error"}
            onClick={() => setShowError((v) => !v)}
          >
            {STATUS_LABELS[status]}
          </button>
        ) : (
          <span className={`text-muted-foreground ${status === "connected" ? "hidden md:inline" : ""}`}>
            {STATUS_LABELS[status]}
          </span>
        )}
        {status === "error" && showError && (
          <div
            data-testid="status-error-popover"
            // Mobile: the bar is pinned to the bottom of the screen, so anchor
            // the popover to the viewport and open it UPWARD (fixed, above the
            // bar) to stay on-screen. Desktop: the bar is at the top, so anchor
            // it under the pill and open downward. Either way it never runs off
            // an edge (the pill sits on the left, so a right-aligned/downward
            // popover clipped off-screen).
            className="fixed inset-x-2 bottom-16 z-50 md:absolute md:inset-x-auto md:left-0 md:bottom-auto md:top-full md:mt-1 md:w-72 md:max-w-[80vw] rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-md"
          >
            <div className="mb-1 font-medium">Connection error</div>
            <div className="break-words text-muted-foreground">{statusError || "Connection error"}</div>
            <button
              type="button"
              className="mt-2 font-medium underline"
              onClick={() => setShowError(false)}
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Pending clipboard buffer from `devsesh copy`, awaiting a user gesture. */}
      {clipboard && (
        <ClipboardPill clipboard={clipboard} onCopy={onCopyClipboard} onDismiss={onDismissClipboard} />
      )}

      {/* Pinned quick-key pills region (flex-1: stable width for measurement) */}
      <div ref={regionRef} className="relative flex-1 min-w-0 flex items-center overflow-hidden">
        {/* Hidden always-full row used only to measure natural pill widths. */}
        <div
          ref={measureRef}
          aria-hidden="true"
          className="absolute left-0 top-0 flex items-center gap-1 invisible pointer-events-none"
        >
          {pinnedKeys.map((key, i) => (
            <span
              key={i}
              data-measure-pill
              className="px-2 py-0.5 text-xs border rounded whitespace-nowrap"
            >
              {key.display_token}
            </span>
          ))}
        </div>

        {/* Visible pills: only those that fit. */}
        <div className="flex items-center gap-1">
          {pinnedKeys.slice(0, visibleCount).map((key, i) => (
            <button
              key={i}
              data-pill
              // Don't let the pill steal focus: a focused terminal stays focused
              // (its keyboard stays up) and an unfocused one stays unfocused
              // (no keyboard summoned). We preserve the terminal's focus state
              // rather than forcing it.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSendKey(key.spec)}
              className="px-2 min-h-11 md:min-h-0 inline-flex items-center py-0.5 text-xs bg-background border rounded hover:bg-accent whitespace-nowrap"
              title={key.display_token}
            >
              {key.display_token}
            </button>
          ))}
        </div>
      </div>

      {/* +N overflow indicator */}
      {pinnedKeys.length > visibleCount && (
        <button
          onClick={onOpenOverlay}
          className="px-1.5 min-h-11 md:min-h-0 inline-flex items-center py-0.5 text-xs bg-background border rounded text-muted-foreground hover:bg-accent shrink-0"
          title={`${pinnedKeys.length - visibleCount} more`}
        >
          +{pinnedKeys.length - visibleCount}
        </button>
      )}

      {/* Keyboard icon (opens QuickKeysOverlay) */}
      <Button
        variant="ghost"
        size="icon"
        className="h-11 w-11 md:h-8 md:w-8 shrink-0"
        onClick={onOpenOverlay}
        title="Quick Keys"
      >
        <Keyboard className="h-5 w-5 md:h-4 md:w-4" />
      </Button>

      {/* Connect / Disconnect button (far right). Hidden on mobile, where it
          lives in the details panel instead. */}
      {status === "disconnected" || status === "error" ? (
        <Button
          variant="outline"
          size="sm"
          className="hidden md:inline-flex h-8 shrink-0"
          onClick={onConnect}
        >
          Connect
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="hidden md:inline-flex h-8 shrink-0 text-destructive"
          onClick={onDisconnect}
        >
          Disconnect
        </Button>
      )}
    </div>
  )
}
