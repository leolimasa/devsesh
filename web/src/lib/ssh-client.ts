import { getSSHWebSocketURL, getToken } from "./api"

declare global {
  interface Window {
    sshConnect: (wsURL: string, user: string, token: string) => void
    sshDisconnect: () => void
    sshExec: (command: string) => void
    sshSendInput: (data: Uint8Array | string) => void
    sshResize: (rows: number, cols: number) => void
    sshSetPasswordCallback: (callback: () => void) => void
    sshSetOutputCallback: (callback: (data: string) => void) => void
    sshSetStatusCallback: (callback: (status: string, error?: string) => void) => void
    sshResolvePassword: (password: string) => void
    sshRejectPassword: () => void
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
    goInstance.run(result.instance)

    this.wasmReady = true
    this.setupCallbacks()
  }

  private setupCallbacks(): void {
    window.sshSetPasswordCallback(() => {
      this.emit("password-request")
    })

    window.sshSetOutputCallback((data: string) => {
      this.emit("output", data)
    })

    window.sshSetStatusCallback((status: string, error?: string) => {
      this.status = status as ConnectionStatus
      this.emit("status", status, error)
    })
  }

  connect(hostId: number, user: string): void {
    if (!this.wasmReady) {
      throw new Error("WASM not initialized")
    }

    const token = getToken()
    if (!token) {
      throw new Error("Not authenticated")
    }

    this.status = "connecting"
    const wsURL = getSSHWebSocketURL(hostId)
    window.sshConnect(wsURL, user, token)
  }

  disconnect(): void {
    window.sshDisconnect()
    this.status = "disconnected"
  }

  exec(command: string): void {
    window.sshExec(command)
  }

  sendInput(data: Uint8Array | string): void {
    window.sshSendInput(data)
  }

  resize(rows: number, cols: number): void {
    window.sshResize(rows, cols)
  }

  resolvePassword(password: string): void {
    window.sshResolvePassword(password)
  }

  rejectPassword(): void {
    window.sshRejectPassword()
  }

  getStatus(): ConnectionStatus {
    return this.status
  }
}