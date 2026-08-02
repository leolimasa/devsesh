import { getSSHWebSocketURL, getToken } from "./api"

declare global {
  interface Window {
    sshConnect: (hostKey: string, wsURL: string, user: string, token: string) => void
    sshDisconnect: (hostKey: string) => void
    sshDisconnectAll: () => void
    sshExec: (hostKey: string, command: string) => void
    sshSendInput: (data: Uint8Array | string) => void
    sshResize: (rows: number, cols: number) => void
    sshSetPasswordCallback: (callback: () => void) => void
    sshSetOutputCallback: (callback: (data: string) => void) => void
    sshSetStatusCallback: (callback: (status: string, error?: string) => void) => void
    sshSetCertificateCallback: (callback: () => void) => void
    sshSetCertAuthFailedCallback: (callback: (reason: string) => void) => void
    sshResolvePassword: (password: string) => void
    sshRejectPassword: () => void
    sshResolveCertificate: (certificate: string, privateKey: string) => void
    sshRejectCertificate: () => void
  }
}

export type ConnectionStatus = "disconnected" | "connecting" | "authenticating" | "connected" | "error"

type EventCallback = (...args: any[]) => void

class EventEmitter {
  private events: Record<string, EventCallback[]> = {}

  on(event: string, callback: EventCallback) {
    if (!this.events[event]) {
      this.events[event] = []
    }
    this.events[event].push(callback)
  }

  off(event: string, callback: EventCallback) {
    if (!this.events[event]) return
    this.events[event] = this.events[event].filter(cb => cb !== callback)
  }

  emit(event: string, ...args: any[]) {
    if (!this.events[event]) return
    this.events[event].forEach(cb => cb(...args))
  }
}

let goInstance: any = null

export class SSHClient extends EventEmitter {
  private wasmReady: boolean = false
  private status: ConnectionStatus = "disconnected"

  async init(): Promise<void> {
    if (goInstance) {
      this.wasmReady = true
      this.setupCallbacks()
      return
    }

    const script = document.createElement("script")
    script.src = "/wasm_exec.js"
    document.body.appendChild(script)

    await new Promise<void>((resolve, reject) => {
      script.onload = () => resolve()
      script.onerror = () => reject(new Error("Failed to load wasm_exec.js"))
    })

    const Go = (window as any).Go

    const script2 = document.createElement("script")
    script2.src = "/sshclient.js"
    document.body.appendChild(script2)

    await new Promise<void>((resolve, reject) => {
      script2.onload = () => resolve()
      script2.onerror = () => reject(new Error("Failed to load sshclient.js"))
    })

    goInstance = new Go()
    const response = await fetch("/sshclient.wasm")
    const buffer = await response.arrayBuffer()
    const result = await WebAssembly.instantiate(buffer, goInstance.importObject)

    // Start the Go program - this is a promise that resolves when Go exits
    const runPromise = goInstance.run(result.instance)
    runPromise.then(() => {
      console.error("[SSHClient] WASM Go program exited!")
      this.wasmReady = false
    }).catch((err: Error) => {
      console.error("[SSHClient] WASM Go program crashed:", err)
      this.wasmReady = false
    })

    // Give WASM a moment to initialize before proceeding
    await new Promise(resolve => setTimeout(resolve, 100))

    this.wasmReady = true
    this.setupCallbacks()
  }

  private setupCallbacks(): void {
    // IMPORTANT: All callbacks MUST be wrapped in try-catch.
    // Uncaught exceptions in callbacks invoked from Go WASM will crash the WASM runtime.

    window.sshSetPasswordCallback(() => {
      try {
        this.emit("password-request")
      } catch (e) {
        console.error("[SSHClient] Error in password callback:", e)
      }
    })

    window.sshSetOutputCallback((data: string) => {
      try {
        // Use setTimeout to defer the actual work, allowing Go WASM to regain control immediately.
        // This prevents issues with Go WASM's scheduler when JS does complex work in callbacks.
        setTimeout(() => {
          try {
            this.emit("output", data)
          } catch (e) {
            console.error("[SSHClient] Error emitting output:", e)
          }
        }, 0)
      } catch (e) {
        console.error("[SSHClient] Error in output callback:", e)
      }
    })

    window.sshSetStatusCallback((status: string, error?: string) => {
      try {
        this.status = status as ConnectionStatus
        this.emit("status", status, error)
      } catch (e) {
        console.error("[SSHClient] Error in status callback:", e)
      }
    })

    window.sshSetCertificateCallback(() => {
      try {
        // Emit certificate-request event. The SSHTerminal component should handle this
        // by checking the FROST worker status and either requesting a certificate
        // or rejecting to fall back to password auth.
        this.emit("certificate-request")
      } catch (e) {
        console.error("[SSHClient] Error in certificate callback:", e)
      }
    })

    window.sshSetCertAuthFailedCallback((reason: string) => {
      try {
        // Emit certificate-auth-failed event when the server rejects certificate auth
        this.emit("certificate-auth-failed", reason)
      } catch (e) {
        console.error("[SSHClient] Error in cert auth failed callback:", e)
      }
    })
  }

  // Activate (or establish) the pooled connection for a host. hostKey uniquely
  // identifies the host so the wasm client can reuse an existing connection —
  // switching sessions on the same host does NOT reconnect or re-authenticate.
  connect(hostKey: string, hostId: number, user: string): void {
    if (!this.wasmReady) {
      throw new Error("WASM not initialized")
    }

    const token = getToken()
    if (!token) {
      throw new Error("Not authenticated")
    }

    this.status = "connecting"
    const wsURL = getSSHWebSocketURL(hostId)
    window.sshConnect(hostKey, wsURL, user, token)
  }

  // Tear down one host's pooled connection.
  disconnect(hostKey: string): void {
    window.sshDisconnect(hostKey)
    this.status = "disconnected"
  }

  // Tear down every pooled connection (e.g. when leaving the terminal).
  disconnectAll(): void {
    window.sshDisconnectAll()
    this.status = "disconnected"
  }

  // Run a command (a tmux attach) on a host's pooled connection.
  exec(hostKey: string, command: string): void {
    window.sshExec(hostKey, command)
  }

  sendInput(data: Uint8Array | string): void {
    if (typeof window.sshSendInput !== 'function') {
      return
    }
    try {
      window.sshSendInput(data)
    } catch (e) {
      console.error("[SSHClient] Error calling sshSendInput:", e)
    }
  }

  resize(rows: number, cols: number): void {
    // Guard like sendInput: the terminal fits (and calls resize) as soon as the
    // container/fonts settle, which can be BEFORE the wasm client finishes
    // loading (or after it has exited) — at which point window.sshResize is not
    // yet/no longer a function. On macOS/Safari the wasm init + font timing
    // makes this race routine, throwing "window.sshResize is not a function".
    if (typeof window.sshResize !== "function") {
      return
    }
    try {
      window.sshResize(rows, cols)
    } catch (e) {
      console.error("[SSHClient] Error calling sshResize:", e)
    }
  }

  resolvePassword(password: string): void {
    window.sshResolvePassword(password)
  }

  rejectPassword(): void {
    window.sshRejectPassword()
  }

  /**
   * Provides a certificate and private key for SSH authentication.
   * @param certificate - Base64-encoded SSH certificate (wire format)
   * @param privateKey - Base64-encoded Ed25519 private key seed (32 bytes)
   */
  resolveCertificate(certificate: string, privateKey: string): void {
    window.sshResolveCertificate(certificate, privateKey)
  }

  /**
   * Rejects certificate authentication, causing the SSH client to fall back
   * to password authentication.
   */
  rejectCertificate(): void {
    const stack = new Error().stack
    console.log('[SSHClient] rejectCertificate called from:', stack)
    window.sshRejectCertificate()
  }

  getStatus(): ConnectionStatus {
    return this.status
  }
}