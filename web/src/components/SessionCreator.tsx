/**
 * SessionCreator
 *
 * Runs `devsesh start <name>` on a chosen host over the exact same SSH machinery
 * the Restart button uses (an `autoRestart` SSHTerminal), then watches the
 * session-updates stream for the session to register and reports it via
 * `onCreated`. Reused by BOTH new-session entry points so the create path stays
 * identical:
 *   - the dashboard mounts it hidden and stays put (the row arrives over the
 *     WebSocket like any other session);
 *   - NewSessionPage mounts it visible so the user lands in a live terminal.
 *
 * NOTE: the wasm SSH client is a process-wide singleton (one Go instance + global
 * callbacks), so only ONE SSHTerminal may be mounted at a time. That's why the
 * dashboard uses a hidden creator (no other terminal there) and the session page
 * navigates to a dedicated page (unmounting its live terminal first) rather than
 * overlaying a second one.
 */
import { useCallback, useEffect, useRef } from "react"
import { SSHTerminal } from "@/components/SSHTerminal"
import { useSessionUpdates } from "@/hooks/useSessionUpdates"
import { matchesNewSession } from "@/lib/session"
import { cn } from "@/lib/utils"
import type { Host, Session, SessionUpdate, ConnectionStatus } from "@/types/api"

// How long to wait for the host to report the new session before giving up. The
// `devsesh start` + register + WebSocket round-trip is normally a second or two;
// this only bounds a stuck connection (auth abandoned, host unreachable).
const CREATE_TIMEOUT_MS = 60000

interface SessionCreatorProps {
  host: Host
  name: string
  // Hidden mode parks the terminal offscreen (dashboard); the auth dialogs it
  // renders are fixed-position modals, so they still appear for the user.
  hidden?: boolean
  onCreated: (session: Session) => void
  onError?: (message: string) => void
  onStatusChange?: (status: ConnectionStatus, errorMsg?: string) => void
  topBarHeight?: number
}

export function SessionCreator({
  host,
  name,
  hidden = false,
  onCreated,
  onError,
  onStatusChange,
  topBarHeight = 0,
}: SessionCreatorProps) {
  // Fire onCreated/onError at most once, even though updates keep streaming.
  const doneRef = useRef(false)

  const handleUpdate = useCallback(
    (update: SessionUpdate) => {
      if (doneRef.current) return
      if (matchesNewSession(update, host.id, name)) {
        doneRef.current = true
        onCreated(update.session)
      }
    },
    [host.id, name, onCreated]
  )

  useSessionUpdates(handleUpdate)

  useEffect(() => {
    const timer = setTimeout(() => {
      if (doneRef.current) return
      doneRef.current = true
      onError?.("Timed out waiting for the session to start")
    }, CREATE_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [onError])

  return (
    <div
      className={cn(
        hidden
          ? // Offscreen but still laid out (xterm needs a real size to fit).
            "fixed left-[-9999px] top-0 h-[300px] w-[400px] overflow-hidden"
          : "h-full"
      )}
      aria-hidden={hidden}
      data-testid="session-creator"
    >
      <SSHTerminal
        host={host}
        sessionName={name}
        autoRestart
        onStatusChange={onStatusChange}
        topBarHeight={topBarHeight}
      />
    </div>
  )
}
