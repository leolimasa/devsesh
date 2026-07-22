package ssh

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// newProxyHarness wires a WebSocket client to a TCPProxy whose upstream "host" is
// a real TCP connection the test controls. It returns the client WebSocket, a
// channel delivering the host-side conn, and a cleanup func. pongWait/pingPeriod
// are injected so the keepalive behaviour can be exercised in milliseconds.
func newProxyHarness(t *testing.T, pongWait, pingPeriod time.Duration) (*websocket.Conn, <-chan net.Conn, func()) {
	t.Helper()

	hostLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("host listen: %v", err)
	}
	hostConnC := make(chan net.Conn, 1)
	go func() {
		c, err := hostLn.Accept()
		if err != nil {
			return
		}
		hostConnC <- c
	}()

	upgrader := websocket.Upgrader{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		tcp, err := net.Dial("tcp", hostLn.Addr().String())
		if err != nil {
			ws.Close()
			return
		}
		p := NewTCPProxy(ws, tcp)
		p.pongWait = pongWait
		p.pingPeriod = pingPeriod
		p.writeTimeout = time.Second
		p.Run()
	}))

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	client, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		srv.Close()
		hostLn.Close()
		t.Fatalf("ws dial: %v", err)
	}

	cleanup := func() {
		client.Close()
		srv.Close()
		hostLn.Close()
	}
	return client, hostConnC, cleanup
}

// An interactive terminal is idle for long stretches. The proxy must keep the
// connection alive via ping/pong rather than tearing it down on a read deadline
// (the bug that dropped mobile sessions after ~30s with "remote command exited
// without exit status or exit signal").
func TestProxyKeepsIdleConnectionAlive(t *testing.T) {
	client, hostConnC, cleanup := newProxyHarness(t, 400*time.Millisecond, 120*time.Millisecond)
	defer cleanup()

	host := <-hostConnC

	// The client must be reading for gorilla to auto-answer pings with pongs.
	readErr := make(chan error, 1)
	recv := make(chan []byte, 8)
	go func() {
		for {
			_, msg, err := client.ReadMessage()
			if err != nil {
				readErr <- err
				return
			}
			recv <- msg
		}
	}()

	// Sit idle far longer than pongWait and several ping periods.
	select {
	case err := <-readErr:
		t.Fatalf("connection closed while idle (keepalive broken): %v", err)
	case <-time.After(1500 * time.Millisecond):
	}

	// Prove it is still alive end-to-end: host output must still reach the client.
	if _, err := host.Write([]byte("alive-after-idle")); err != nil {
		t.Fatalf("host write: %v", err)
	}
	select {
	case msg := <-recv:
		if string(msg) != "alive-after-idle" {
			t.Fatalf("unexpected message after idle: %q", msg)
		}
	case err := <-readErr:
		t.Fatalf("read error after idle: %v", err)
	case <-time.After(2 * time.Second):
		t.Fatal("no data received after idle; connection was not kept alive")
	}
}

// A genuinely dead client (one that stops answering pings) must still be dropped
// within pongWait so connections don't leak.
func TestProxyDropsUnresponsiveClient(t *testing.T) {
	client, hostConnC, cleanup := newProxyHarness(t, 400*time.Millisecond, 120*time.Millisecond)
	defer cleanup()
	<-hostConnC

	// Suppress the automatic pong so the client looks dead to the server.
	client.SetPingHandler(func(string) error { return nil })

	readErr := make(chan error, 1)
	go func() {
		for {
			if _, _, err := client.ReadMessage(); err != nil {
				readErr <- err
				return
			}
		}
	}()

	select {
	case <-readErr:
		// Expected: server dropped us shortly after pongWait elapsed with no pong.
	case <-time.After(3 * time.Second):
		t.Fatal("unresponsive client was not dropped; read deadline missing")
	}
}
