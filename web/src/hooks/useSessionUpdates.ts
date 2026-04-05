import { useEffect, useRef, useCallback } from "react"
import { getWsEndpoint } from "@/lib/api"
import type { SessionUpdate } from "@/types/api"

type UpdateHandler = (update: SessionUpdate) => void

export function useSessionUpdates(onUpdate: UpdateHandler) {
  const wsRef = useRef<WebSocket | null>(null)
  const onUpdateRef = useRef(onUpdate)

  useEffect(() => {
    onUpdateRef.current = onUpdate
  }, [onUpdate])

  const connect = useCallback(() => {
    const endpoint = getWsEndpoint()
    const ws = new WebSocket(endpoint)

    ws.onopen = () => {
      console.log("WebSocket connected")
    }

    ws.onmessage = (event) => {
      try {
        const update: SessionUpdate = JSON.parse(event.data)
        onUpdateRef.current(update)
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err)
      }
    }

    ws.onclose = () => {
      console.log("WebSocket disconnected, reconnecting...")
      setTimeout(connect, 3000)
    }

    ws.onerror = (error) => {
      console.error("WebSocket error:", error)
    }

    wsRef.current = ws
  }, [])

  useEffect(() => {
    connect()

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [connect])

  const reconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
    }
    connect()
  }, [connect])

  return { reconnect }
}