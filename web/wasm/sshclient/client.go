package main

import (
	"fmt"
	"net"
	"strconv"
	"sync"
	"syscall/js"

	"golang.org/x/crypto/ssh"
)

var (
	currentClient    *ssh.Client
	currentSession   *ssh.Session
	currentTransport *WSTransport
	currentStdin     chan []byte
	passwordCallback js.Value
	outputCallback   js.Value
	statusCallback   js.Value
	passwordResolver chan string
	passwordRejecter chan struct{}
	mu               sync.Mutex
	connected        bool
	sshHost          string
	sshPort          int
)

func updateStatus(status string, errorMsg ...string) {
	if !statusCallback.IsNull() && !statusCallback.IsUndefined() {
		if len(errorMsg) > 0 && errorMsg[0] != "" {
			statusCallback.Invoke(status, errorMsg[0])
		} else {
			statusCallback.Invoke(status)
		}
	}
}

func Connect(this js.Value, args []js.Value) interface{} {
	wsURL := args[0].String()
	user := args[1].String()
	token := args[2].String()

	go func() {
		updateStatus("connecting")

		transport, err := NewWSTransportWithAuth(wsURL, token)
		if err != nil {
			updateStatus("error", err.Error())
			return
		}

		host, port, err := transport.WaitForConnected()
		if err != nil {
			transport.Close()
			updateStatus("error", "failed to get connection info: "+err.Error())
			return
		}

		mu.Lock()
		sshHost = host
		sshPort = port
		currentTransport = transport
		mu.Unlock()

		addr := net.JoinHostPort(host, strconv.Itoa(port))

		updateStatus("authenticating")

		config := &ssh.ClientConfig{
			User: user,
			Auth: []ssh.AuthMethod{
				ssh.PasswordCallback(func() (string, error) {
					passwordResolver = make(chan string, 1)
					passwordRejecter = make(chan struct{}, 1)

					if !passwordCallback.IsNull() && !passwordCallback.IsUndefined() {
						passwordCallback.Invoke()
					}

					select {
					case pwd := <-passwordResolver:
						return pwd, nil
					case <-passwordRejecter:
						return "", fmt.Errorf("authentication cancelled")
					}
				}),
			},
			HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		}

		// Use ssh.NewClientConn with WebSocket transport instead of ssh.Dial
		conn, chans, reqs, err := ssh.NewClientConn(transport, addr, config)
		if err != nil {
			transport.Close()
			updateStatus("error", err.Error())
			return
		}

		client := ssh.NewClient(conn, chans, reqs)

		mu.Lock()
		currentClient = client
		connected = true
		mu.Unlock()

		updateStatus("connected")
	}()

	return nil
}

func Disconnect(this js.Value, args []js.Value) interface{} {
	mu.Lock()
	defer mu.Unlock()

	if currentStdin != nil {
		close(currentStdin)
		currentStdin = nil
	}
	if currentSession != nil {
		currentSession.Close()
		currentSession = nil
	}
	if currentClient != nil {
		currentClient.Close()
		currentClient = nil
	}
	if currentTransport != nil {
		currentTransport.Close()
		currentTransport = nil
	}
	connected = false

	updateStatus("disconnected")

	return nil
}

func Exec(this js.Value, args []js.Value) interface{} {
	command := args[0].String()

	go func() {
		mu.Lock()
		if currentClient == nil {
			mu.Unlock()
			updateStatus("error", "not connected")
			return
		}

		session, err := currentClient.NewSession()
		if err != nil {
			mu.Unlock()
			updateStatus("error", "failed to create session: "+err.Error())
			return
		}

		modes := ssh.TerminalModes{
			ssh.ECHO:          1,
			ssh.TTY_OP_ISPEED: 115200,
			ssh.TTY_OP_OSPEED: 115200,
		}

		err = session.RequestPty("xterm-256color", 24, 80, modes)
		if err != nil {
			session.Close()
			mu.Unlock()
			updateStatus("error", "failed to request PTY: "+err.Error())
			return
		}

		stdin, err := session.StdinPipe()
		if err != nil {
			session.Close()
			mu.Unlock()
			updateStatus("error", "failed to get stdin pipe: "+err.Error())
			return
		}

		currentStdin = make(chan []byte, 100)
		currentSession = session
		mu.Unlock()

		go func() {
			for data := range currentStdin {
				stdin.Write(data)
			}
		}()

		session.Stdout = &outputWriter{callback: outputCallback}
		session.Stderr = &outputWriter{callback: outputCallback}

		err = session.Start(command)
		if err != nil {
			updateStatus("error", "failed to start command: "+err.Error())
			return
		}

		err = session.Wait()
		if err != nil {
			// Don't report error for normal exit
			if _, ok := err.(*ssh.ExitError); !ok {
				updateStatus("error", "session error: "+err.Error())
			}
		}

		mu.Lock()
		if currentStdin != nil {
			close(currentStdin)
			currentStdin = nil
		}
		currentSession = nil
		mu.Unlock()
	}()

	return nil
}

type outputWriter struct {
	callback js.Value
}

func (w *outputWriter) Write(p []byte) (int, error) {
	if !w.callback.IsNull() && !w.callback.IsUndefined() {
		w.callback.Invoke(string(p))
	}
	return len(p), nil
}

func SendInput(this js.Value, args []js.Value) interface{} {
	data := args[0]

	var buf []byte
	if data.IsNull() || data.IsUndefined() {
		return nil
	}

	if data.Get("constructor").Get("name").String() == "Uint8Array" {
		length := data.Get("length").Int()
		buf = make([]byte, length)
		js.CopyBytesToGo(buf, data)
	} else {
		str := data.String()
		buf = []byte(str)
	}

	mu.Lock()
	if currentStdin != nil {
		currentStdin <- buf
	}
	mu.Unlock()

	return nil
}

func Resize(this js.Value, args []js.Value) interface{} {
	rows := args[0].Int()
	cols := args[1].Int()

	mu.Lock()
	defer mu.Unlock()

	if currentSession != nil {
		currentSession.WindowChange(rows, cols)
	}

	return nil
}

func SetPasswordCallback(this js.Value, args []js.Value) interface{} {
	passwordCallback = args[0]
	return nil
}

func SetOutputCallback(this js.Value, args []js.Value) interface{} {
	outputCallback = args[0]
	return nil
}

func SetStatusCallback(this js.Value, args []js.Value) interface{} {
	statusCallback = args[0]
	return nil
}

func ResolvePassword(this js.Value, args []js.Value) interface{} {
	password := args[0].String()
	if passwordResolver != nil {
		select {
		case passwordResolver <- password:
		default:
		}
	}
	return nil
}

func RejectPassword(this js.Value, args []js.Value) interface{} {
	if passwordRejecter != nil {
		select {
		case passwordRejecter <- struct{}{}:
		default:
		}
	}
	return nil
}
