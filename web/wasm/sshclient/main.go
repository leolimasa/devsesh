package main

import (
	"fmt"
	"syscall/js"
)

func main() {
	defer func() {
		if r := recover(); r != nil {
			js.Global().Get("console").Call("error", "[SSH WASM] FATAL PANIC in main:", fmt.Sprint(r))
		}
	}()

	js.Global().Get("console").Call("log", "[SSH WASM] Starting SSH WASM module...")

	js.Global().Set("sshConnect", js.FuncOf(Connect))
	js.Global().Set("sshDisconnect", js.FuncOf(Disconnect))
	js.Global().Set("sshExec", js.FuncOf(Exec))
	js.Global().Set("sshSendInput", js.FuncOf(SendInput))
	js.Global().Set("sshResize", js.FuncOf(Resize))
	js.Global().Set("sshSetPasswordCallback", js.FuncOf(SetPasswordCallback))
	js.Global().Set("sshSetOutputCallback", js.FuncOf(SetOutputCallback))
	js.Global().Set("sshSetStatusCallback", js.FuncOf(SetStatusCallback))
	js.Global().Set("sshResolvePassword", js.FuncOf(ResolvePassword))
	js.Global().Set("sshRejectPassword", js.FuncOf(RejectPassword))

	js.Global().Get("console").Call("log", "[SSH WASM] All functions registered, entering wait loop...")

	// Block forever - the WASM module stays alive to handle JS calls
	select {}
}