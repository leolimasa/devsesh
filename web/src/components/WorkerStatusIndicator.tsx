/**
 * Worker Status Indicator Component
 *
 * Displays the current status of the FROST web worker.
 * Shows active/inactive state with a pulsing indicator and countdown timer.
 * [req.35jehk]
 */

import { Badge } from '@/components/ui/badge'
import { useFROST } from '@/contexts/FROSTContext'

/**
 * Formats seconds into a human-readable MM:SS format.
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function WorkerStatusIndicator() {
  const { isActive, remainingTime } = useFROST()

  if (!isActive) {
    return (
      <Badge variant="outline" className="gap-1.5">
        <span className="h-2 w-2 rounded-full bg-muted-foreground" />
        <span>Worker Inactive</span>
      </Badge>
    )
  }

  return (
    <Badge variant="success" className="gap-1.5">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
      </span>
      <span>Worker Active - {formatTime(remainingTime)}</span>
    </Badge>
  )
}
