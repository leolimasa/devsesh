import { useEffect, useRef, useCallback } from "react"
import { getWsEndpoint, getToken } from "@/lib/api"
import type { SessionUpdate } from "@/types/api"

type UpdateHandler = (update: SessionUpdate) => void

// STALE_MS is how long the feed may go quiet before we assume the socket is
// dead. The server emits a "heartbeat" every 15s (see pingInterval in
// internal/sessions/websocket.go), so this tolerates two missed beats plus
// slack. It MUST stay below the server's pongWait so the client gets first go
// at reconnecting gracefully.
const STALE_MS = 45000
// How often we check for staleness. Cheap: it only compares two numbers.
const STALE_CHECK_MS = 5000
// Reconnect backoff. Capped so a long outage settles into a steady retry
// rather than hammering the proxy layer.
const BACKOFF_BASE_MS = 1000
const BACKOFF_MAX_MS = 15000

export function useSessionUpdates(onUpdate: UpdateHandler) {
  const wsRef = useRef<WebSocket | null>(null)
  const onUpdateRef = useRef(onUpdate)
  // Timestamp of the last byte we heard from the server, heartbeats included.
  const lastMessageAtRef = useRef(Date.now())
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    onUpdateRef.current = onUpdate
  }, [onUpdate])

  const connect = useCallback(() => {
    if (!mountedRef.current) return
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }

    const endpoint = getWsEndpoint()
    const token = getToken()
    const ws = new WebSocket(endpoint)
    wsRef.current = ws
    // Treat the connection as fresh while it opens, so the staleness check
    // doesn't tear down a socket that simply hasn't finished handshaking.
    lastMessageAtRef.current = Date.now()

    ws.onopen = () => {
      lastMessageAtRef.current = Date.now()
      attemptRef.current = 0
      // Send the JWT token as the first message for authentication
      if (token) {
        ws.send(token)
      }
    }

    ws.onmessage = (event) => {
      // Stamp liveness BEFORE parsing: any message at all, even one we end up
      // discarding, proves the pipe is open.
      lastMessageAtRef.current = Date.now()
      try {
        // Check for error messages in the response
        const data = JSON.parse(event.data)
        if (data.error) {
          console.error("WebSocket error:", data.error)
          ws.close()
          return
        }
        // Heartbeats exist only to prove liveness (stamped above) and carry no
        // session, so they must not reach session state -- handlers read
        // update.session.id unconditionally.
        if (data.event === "heartbeat") return
        const update: SessionUpdate = data
        onUpdateRef.current(update)
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err)
      }
    }

    ws.onclose = () => {
      // Only the socket that is still the current one may schedule a retry.
      // Deliberate teardowns (unmount, forced reconnect) clear wsRef first, so
      // their close lands here with wsRef pointing elsewhere and is ignored.
      // Without that, unmounting leaks a socket: close() fires this handler,
      // which reconnects after the component is already gone.
      if (wsRef.current !== ws) return
      wsRef.current = null
      if (!mountedRef.current) return
      const delay = Math.min(BACKOFF_BASE_MS * 2 ** attemptRef.current, BACKOFF_MAX_MS)
      attemptRef.current++
      retryTimerRef.current = setTimeout(connect, delay)
    }

    ws.onerror = (error) => {
      console.error("WebSocket error:", error)
    }
  }, [])

  // Drop the current socket and reconnect immediately.
  const forceReconnect = useCallback(() => {
    if (!mountedRef.current) return
    const ws = wsRef.current
    wsRef.current = null
    // wsRef is cleared above, so this close is ignored by ws.onclose.
    ws?.close()
    attemptRef.current = 0
    connect()
  }, [connect])

  // Recover from a half-open drop: the socket is still OPEN as far as the
  // browser is concerned -- no close event, no error event -- but nothing is
  // arriving. This is the case the old onclose-only logic could never see,
  // because a peer that vanishes without a FIN or RST never produces one.
  const checkLiveness = useCallback(() => {
    if (!mountedRef.current) return
    const ws = wsRef.current
    // No socket and no retry pending means we fell through a crack; reconnect.
    if (!ws) {
      if (!retryTimerRef.current) connect()
      return
    }
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) return
    if (Date.now() - lastMessageAtRef.current > STALE_MS) {
      console.warn("Session updates went quiet; reconnecting")
      forceReconnect()
    }
  }, [connect, forceReconnect])

  useEffect(() => {
    mountedRef.current = true
    connect()

    const interval = setInterval(checkLiveness, STALE_CHECK_MS)

    // Check promptly on the events that accompany a real-world drop, instead of
    // waiting out STALE_MS: wifi/VPN returning, or the tab/PWA being resumed
    // after the device slept. SSHTerminal does the same for its own socket.
    const onOnline = () => forceReconnect()
    const onVisible = () => {
      if (document.visibilityState === "visible") checkLiveness()
    }
    window.addEventListener("online", onOnline)
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      mountedRef.current = false
      clearInterval(interval)
      window.removeEventListener("online", onOnline)
      document.removeEventListener("visibilitychange", onVisible)
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
      const ws = wsRef.current
      wsRef.current = null
      ws?.close()
    }
  }, [connect, checkLiveness, forceReconnect])

  return { reconnect: forceReconnect }
}
