package main

import "syscall/js"

func main() {
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

	<-make(chan struct{})
}