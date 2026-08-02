import { describe, it, expect, vi, afterEach } from "vitest"
import { SSHClient } from "./ssh-client"

// Regression: the terminal fits (and calls resize) as soon as the container /
// fonts settle, which can be before the wasm client has defined window.sshResize
// (or after it has exited). resize() must no-op instead of throwing
// "window.sshResize is not a function" (seen on macOS/Safari).
describe("SSHClient.resize guard", () => {
  afterEach(() => {
    delete (window as unknown as { sshResize?: unknown }).sshResize
  })

  it("does not throw when window.sshResize is undefined", () => {
    delete (window as unknown as { sshResize?: unknown }).sshResize
    const client = new SSHClient()
    expect(() => client.resize(24, 80)).not.toThrow()
  })

  it("forwards to window.sshResize when it is available", () => {
    const fn = vi.fn()
    ;(window as unknown as { sshResize: unknown }).sshResize = fn
    const client = new SSHClient()
    client.resize(30, 100)
    expect(fn).toHaveBeenCalledWith(30, 100)
  })
})
