package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"sync"
	"syscall/js"
	"time"
)

type WSTransport struct {
	ws       js.Value
	readBuf  *bytes.Buffer
	readCh   chan []byte
	closed   bool
	mu       sync.Mutex
	// opened is signaled exactly once: nil when the socket opens, or an error
	// if it errors/closes before opening. This ensures a (re)connect while the
	// network is down fails fast instead of blocking forever.
	opened    chan error
	closeOnce sync.Once
	readCond  *sync.Cond
}

type AuthMessage struct {
	Type  string `json:"type"`
	Token string `json:"token"`
}

type ConnectedMessage struct {
	Type    string `json:"type"`
	Host    string `json:"host"`
	Port    int    `json:"port"`
	Message string `json:"message,omitempty"`
}

// Ensure WSTransport implements net.Conn
var _ net.Conn = (*WSTransport)(nil)

func NewWSTransportWithAuth(wsURL string, token string) (*WSTransport, error) {
	t := &WSTransport{
		readBuf: bytes.NewBuffer(nil),
		readCh:  make(chan []byte, 100),
		opened:  make(chan error, 1),
	}
	t.readCond = sync.NewCond(&t.mu)

	// signalOpened delivers the open result exactly once (later calls are no-ops).
	signalOpened := func(err error) {
		select {
		case t.opened <- err:
		default:
		}
	}

	ws := js.Global().Get("WebSocket").New(wsURL)
	t.ws = ws

	ws.Set("binaryType", "arraybuffer")

	ws.Set("onopen", js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		authMsg := AuthMessage{Type: "auth", Token: token}
		authJSON, _ := json.Marshal(authMsg)
		ws.Call("send", string(authJSON))
		signalOpened(nil)
		return nil
	}))

	ws.Set("onmessage", js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		event := args[0]
		data := event.Get("data")

		if data.Type() == js.TypeString {
			// Text message - control message, put in channel as JSON
			str := data.String()
			js.Global().Get("console").Call("log", "[SSH Transport] Received text message:", str[:min(len(str), 100)])
			t.readCh <- []byte(str)
		} else if data.Get("constructor").Get("name").String() == "ArrayBuffer" {
			// Binary data
			jsData := js.Global().Get("Uint8Array").New(data)
			length := jsData.Get("length").Int()
			buf := make([]byte, length)
			js.CopyBytesToGo(buf, jsData)

			js.Global().Get("console").Call("log", "[SSH Transport] Received binary data:", length, "bytes")

			t.mu.Lock()
			t.readBuf.Write(buf)
			t.readCond.Signal()
			t.mu.Unlock()
		} else {
			js.Global().Get("console").Call("log", "[SSH Transport] Received unknown message type")
		}
		return nil
	}))

	ws.Set("onerror", js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		t.mu.Lock()
		t.closed = true
		t.readCond.Broadcast()
		t.mu.Unlock()
		signalOpened(fmt.Errorf("websocket error"))
		return nil
	}))

	ws.Set("onclose", js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		t.mu.Lock()
		t.closed = true
		t.readCond.Broadcast()
		t.mu.Unlock()
		t.closeOnce.Do(func() { close(t.readCh) })
		signalOpened(fmt.Errorf("websocket closed"))
		return nil
	}))

	// Wait for the socket to open, fail, or time out — never block forever. A
	// reconnect attempted while the network is down errors here so the caller
	// can retry, instead of wedging the connection at "connecting".
	select {
	case err := <-t.opened:
		if err != nil {
			ws.Call("close")
			return nil, err
		}
	case <-time.After(15 * time.Second):
		ws.Call("close")
		return nil, fmt.Errorf("websocket open timed out")
	}
	return t, nil
}

func (t *WSTransport) WaitForConnected() (string, int, error) {
	for {
		select {
		case data, ok := <-t.readCh:
			if !ok {
				return "", 0, fmt.Errorf("connection closed")
			}

			var msg ConnectedMessage
			if err := json.Unmarshal(data, &msg); err != nil {
				continue
			}

			if msg.Type == "connected" {
				return msg.Host, msg.Port, nil
			}
			if msg.Type == "error" {
				return "", 0, fmt.Errorf("server error: %s", msg.Message)
			}
		}
	}
}

// Read implements net.Conn
func (t *WSTransport) Read(b []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()

	for t.readBuf.Len() == 0 && !t.closed {
		t.readCond.Wait()
	}

	if t.closed && t.readBuf.Len() == 0 {
		return 0, io.EOF
	}

	return t.readBuf.Read(b)
}

// Write implements net.Conn
func (t *WSTransport) Write(b []byte) (int, error) {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return 0, io.ErrClosedPipe
	}
	t.mu.Unlock()

	// Send as binary WebSocket message
	jsArray := js.Global().Get("Uint8Array").New(len(b))
	js.CopyBytesToJS(jsArray, b)
	t.ws.Call("send", jsArray.Get("buffer"))

	return len(b), nil
}

// Close implements net.Conn
func (t *WSTransport) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.closed {
		return nil
	}

	t.closed = true
	t.ws.Call("close")
	t.readCond.Broadcast()
	return nil
}

// LocalAddr implements net.Conn
func (t *WSTransport) LocalAddr() net.Addr {
	return &wsAddr{s: "local"}
}

// RemoteAddr implements net.Conn
func (t *WSTransport) RemoteAddr() net.Addr {
	return &wsAddr{s: "remote"}
}

// SetDeadline implements net.Conn
func (t *WSTransport) SetDeadline(deadline time.Time) error {
	return nil
}

// SetReadDeadline implements net.Conn
func (t *WSTransport) SetReadDeadline(deadline time.Time) error {
	return nil
}

// SetWriteDeadline implements net.Conn
func (t *WSTransport) SetWriteDeadline(deadline time.Time) error {
	return nil
}

type wsAddr struct {
	s string
}

func (a *wsAddr) Network() string { return "websocket" }
func (a *wsAddr) String() string  { return a.s }
