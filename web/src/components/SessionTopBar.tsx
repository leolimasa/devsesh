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
  pinnedKeys: Array<{ display_token: string; spec: QuickKeyStep[] }>
  onSendKey: (spec: QuickKeyStep[]) => void
  onOpenOverlay: () => void
  onConnect: () => void
  onDisconnect: () => void
  onBack: () => void
  hamburger?: ReactNode
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
  pinnedKeys,
  onSendKey,
  onOpenOverlay,
  onConnect,
  onDisconnect,
  onBack,
  hamburger,
}: SessionTopBarProps) {
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
      if (pill.getBoundingClientRect().right <= availRight) {
        count++
      } else {
        break
      }
    }
    setVisibleCount(count)
  }, [])

  useEffect(() => {
    measureOverflow()
    if (typeof ResizeObserver === "undefined") return
    const obs = new ResizeObserver(measureOverflow)
    if (regionRef.current) obs.observe(regionRef.current)
    return () => obs.disconnect()
  }, [measureOverflow, pinnedKeys])

  return (
    <div className="flex items-center gap-2 px-2 py-1 bg-muted border-b h-10 min-h-10 flex-shrink-0">
      {/* Back to dashboard */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={onBack}
        title="Back to dashboard"
        aria-label="Back to dashboard"
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>

      {/* Mobile hamburger */}
      {hamburger}

      {/* Session name (far left) */}
      <span className="font-medium text-sm truncate min-w-0 max-w-[200px]">
        {sessionName}
      </span>

      {/* Connection status */}
      <div className="flex items-center gap-1 text-xs shrink-0">
        <span className={`inline-block w-2 h-2 rounded-full ${STATUS_COLORS[status]}`} />
        <span className="text-muted-foreground">{STATUS_LABELS[status]}</span>
      </div>

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
              onClick={() => onSendKey(key.spec)}
              className="px-2 py-0.5 text-xs bg-background border rounded hover:bg-accent whitespace-nowrap"
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
          className="px-1.5 py-0.5 text-xs bg-background border rounded text-muted-foreground hover:bg-accent shrink-0"
          title={`${pinnedKeys.length - visibleCount} more`}
        >
          +{pinnedKeys.length - visibleCount}
        </button>
      )}

      {/* Keyboard icon (opens QuickKeysOverlay) */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={onOpenOverlay}
        title="Quick Keys"
      >
        <Keyboard className="h-4 w-4" />
      </Button>

      {/* Connect / Disconnect button (far right) */}
      {status === "disconnected" || status === "error" ? (
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0"
          onClick={onConnect}
        >
          Connect
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 text-destructive"
          onClick={onDisconnect}
        >
          Disconnect
        </Button>
      )}
    </div>
  )
}
