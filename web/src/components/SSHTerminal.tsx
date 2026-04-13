import { useEffect, useRef, useState } from "react"
import { Terminal as XTerm } from "xterm"
import { FitAddon } from "xterm-addon-fit"
import "xterm/css/xterm.css"
import { SSHClient } from "@/lib/ssh-client"
import { PasswordDialog } from "@/components/PasswordDialog"
import type { Host } from "@/types/api"

interface SSHTerminalProps {
  host: Host
  sessionName: string
  onDisconnect?: () => void
}

type Status = "disconnected" | "connecting" | "authenticating" | "connected" | "error"

export function SSHTerminal({ host, sessionName, onDisconnect }: SSHTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sshClientRef = useRef<SSHClient | null>(null)
  const [status, setStatus] = useState<Status>("disconnected")
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!terminalRef.current) return

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "monospace",
      theme: {
        background: "#1a1a1a",
        foreground: "#ffffff",
        cursor: "#ffffff",
      },
      rows: 24,
      cols: 80,
    })
    xtermRef.current = term

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    fitAddonRef.current = fitAddon

    term.open(terminalRef.current)
    fitAddon.fit()

    // WebGL addon can cause issues on cleanup, so we skip it for stability
    // The canvas renderer works fine for our use case

    const client = new SSHClient()
    sshClientRef.current = client

    client.on("output", (data: string) => {
      term.write(data)
    })

    client.on("status", (newStatus: string, err?: string) => {
      setStatus(newStatus as Status)
      if (err) {
        setError(err)
      } else {
        setError(null)
      }
    })

    client.on("password-request", () => {
      setStatus("authenticating")
      setShowPasswordDialog(true)
    })

    client.init()
      .then(() => {
        setLoading(false)
        const sshUser = host.ssh_user || "root"
        client.connect(host.id, sshUser)
        setStatus("connecting")
      })
      .catch((err) => {
        setLoading(false)
        setError(err.message)
        setStatus("error")
      })

    const handleResize = () => {
      fitAddon.fit()
      if (sshClientRef.current) {
        const { rows, cols } = term
        sshClientRef.current.resize(rows, cols)
      }
    }

    window.addEventListener("resize", handleResize)

    term.onData((data) => {
      if (sshClientRef.current) {
        sshClientRef.current.sendInput(data)
      }
    })

    return () => {
      window.removeEventListener("resize", handleResize)
      // Wrap cleanup in try-catch to prevent crashes
      try {
        client.disconnect()
      } catch (e) {
        console.error("Error disconnecting SSH client:", e)
      }
      try {
        term.dispose()
      } catch (e) {
        console.error("Error disposing terminal:", e)
      }
    }
  }, [host.id, host.ssh_user])

  const handlePasswordSubmit = (password: string) => {
    if (sshClientRef.current) {
      sshClientRef.current.resolvePassword(password)
      setShowPasswordDialog(false)
      setStatus("connecting")
    }
  }

  const handlePasswordCancel = () => {
    if (sshClientRef.current) {
      sshClientRef.current.rejectPassword()
      sshClientRef.current.disconnect()
      setShowPasswordDialog(false)
      setStatus("disconnected")
    }
  }

  useEffect(() => {
    if (status === "connected" && sshClientRef.current) {
      sshClientRef.current.exec(`tmux attach -t ${sessionName}`)
    }
  }, [status, sessionName])

  const handleDisconnect = () => {
    if (sshClientRef.current) {
      sshClientRef.current.disconnect()
    }
    setStatus("disconnected")
    onDisconnect?.()
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-2 bg-muted">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {status === "connected" && "🟢 Connected"}
            {status === "connecting" && "🟡 Connecting..."}
            {status === "authenticating" && "🟡 Authenticating..."}
            {status === "error" && "🔴 Error"}
            {status === "disconnected" && "🔴 Disconnected"}
          </span>
          {error && <span className="text-sm text-destructive">{error}</span>}
        </div>
        {status !== "disconnected" && (
          <button
            onClick={handleDisconnect}
            className="px-3 py-1 text-sm bg-destructive text-white rounded hover:bg-destructive/90"
          >
            Disconnect
          </button>
        )}
      </div>
      {loading && (
        <div className="flex items-center justify-center h-full">
          <span>Loading SSH client...</span>
        </div>
      )}
      <div ref={terminalRef} className={loading ? "hidden" : "flex-1"} />
      <PasswordDialog
        isOpen={showPasswordDialog}
        username={host.ssh_user || "root"}
        onSubmit={handlePasswordSubmit}
        onCancel={handlePasswordCancel}
      />
    </div>
  )
}