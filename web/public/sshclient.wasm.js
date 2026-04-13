// This file loads and initializes the Go WASM SSH client

import { Go } from "./wasm_exec"

export async function initSSHClient(): Promise<Go> {
  const go = new Go()

  const wasmResponse = await fetch("/sshclient.wasm")
  const wasmBuffer = await wasmResponse.arrayBuffer()
  
  const result = await WebAssembly.instantiate(wasmBuffer, go.importObject)
  
  go.run(result.instance)
  
  return go
}

export { Go }