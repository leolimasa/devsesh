package ssh

import (
	"database/sql"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/leolimasa/devsesh/internal/auth"
	"github.com/leolimasa/devsesh/internal/config"
	"github.com/leolimasa/devsesh/internal/db"
	_ "modernc.org/sqlite"
)

// limitHarness runs the real ProxyHandler against an in-memory "host" (a TCP
// listener standing in for sshd) so the per-user connection limit can be
// exercised end to end.
type limitHarness struct {
	t       *testing.T
	srv     *httptest.Server
	connMgr *ConnectionManager
	token   string
	userID  int64
	hostID  int64

	hostMu    sync.Mutex
	hostConns []net.Conn
}

func newLimitHarness(t *testing.T, maxConns int) *limitHarness {
	t.Helper()
	f, err := os.CreateTemp("", "devsesh-limit-*.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Remove(f.Name()) })
	database, err := sql.Open("sqlite", f.Name())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if _, err := db.RunMigrations(database); err != nil {
		t.Fatal(err)
	}

	h := &limitHarness{t: t}
	hostLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { hostLn.Close() })
	go func() {
		for {
			c, err := hostLn.Accept()
			if err != nil {
				return
			}
			h.hostMu.Lock()
			h.hostConns = append(h.hostConns, c)
			h.hostMu.Unlock()
		}
	}()
	t.Cleanup(func() {
		h.hostMu.Lock()
		defer h.hostMu.Unlock()
		for _, c := range h.hostConns {
			c.Close()
		}
	})

	h.userID, err = db.CreateUser(database, "limit@example.com")
	if err != nil {
		t.Fatal(err)
	}
	_, portStr, _ := net.SplitHostPort(hostLn.Addr().String())
	port, _ := strconv.Atoi(portStr)
	h.hostID, err = db.CreateHost(database, db.Host{Label: "h", Hostname: "127.0.0.1", SSHPort: port, UserID: h.userID})
	if err != nil {
		t.Fatal(err)
	}

	cfg := config.Config{JWTSecret: "secret", SSHTimeout: 2 * time.Second, SSHMaxConnections: maxConns}
	h.token, err = auth.GenerateToken(cfg.JWTSecret, h.userID, 0, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	h.connMgr = NewConnectionManager(cfg)
	mux := http.NewServeMux()
	mux.Handle("GET /api/v1/hosts/{host_id}/ssh", ProxyHandler(database, cfg, h.connMgr))
	h.srv = httptest.NewServer(mux)
	t.Cleanup(h.srv.Close)
	return h
}

func (h *limitHarness) count() int {
	h.connMgr.mu.Lock()
	defer h.connMgr.mu.Unlock()
	return h.connMgr.activeConns[h.userID]
}

func (h *limitHarness) waitCount(want int, within time.Duration) int {
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		if h.count() == want {
			return want
		}
		time.Sleep(20 * time.Millisecond)
	}
	return h.count()
}

// connect opens a proxy WebSocket the way the browser does (auth message first)
// and reports what the server answered: "connected", an error message, or "dropped"
// when the socket closed without any message.
func (h *limitHarness) connect() (*websocket.Conn, string) {
	h.t.Helper()
	url := "ws" + strings.TrimPrefix(h.srv.URL, "http") + "/api/v1/hosts/" + strconv.FormatInt(h.hostID, 10) + "/ssh"
	ws, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		h.t.Fatalf("dial: %v", err)
	}
	if err := ws.WriteMessage(websocket.TextMessage, []byte(`{"type":"auth","token":"`+h.token+`"}`)); err != nil {
		h.t.Fatalf("send auth: %v", err)
	}
	ws.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, data, err := ws.ReadMessage()
	if err != nil {
		return ws, "dropped"
	}
	var msg ControlMessage
	_ = json.Unmarshal(data, &msg)
	ws.SetReadDeadline(time.Time{})
	if msg.Type == "connected" {
		return ws, "connected"
	}
	return ws, msg.Type + ":" + msg.Message
}

func (h *limitHarness) closeHostSide() {
	h.hostMu.Lock()
	defer h.hostMu.Unlock()
	for _, c := range h.hostConns {
		c.Close()
	}
	h.hostConns = nil
}

func TestConnectionSlotsAreReleased(t *testing.T) {
	t.Run("client closes the socket cleanly", func(t *testing.T) {
		h := newLimitHarness(t, 5)
		ws, res := h.connect()
		if res != "connected" {
			t.Fatalf("got %q", res)
		}
		ws.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(time.Second))
		ws.Close()
		if got := h.waitCount(0, 3*time.Second); got != 0 {
			t.Fatalf("slot not released after a clean close: count=%d", got)
		}
	})

	t.Run("client vanishes without a close frame", func(t *testing.T) {
		h := newLimitHarness(t, 5)
		ws, res := h.connect()
		if res != "connected" {
			t.Fatalf("got %q", res)
		}
		ws.UnderlyingConn().Close()
		if got := h.waitCount(0, 3*time.Second); got != 0 {
			t.Fatalf("slot not released after an abrupt drop: count=%d", got)
		}
	})

	t.Run("host closes its side first", func(t *testing.T) {
		h := newLimitHarness(t, 5)
		ws, res := h.connect()
		if res != "connected" {
			t.Fatalf("got %q", res)
		}
		defer ws.Close()
		h.closeHostSide()
		if got := h.waitCount(0, 3*time.Second); got != 0 {
			t.Fatalf("slot not released after the host dropped: count=%d", got)
		}
	})

	t.Run("client closes while the server is still dialing", func(t *testing.T) {
		h := newLimitHarness(t, 5)
		for i := 0; i < 30; i++ {
			url := "ws" + strings.TrimPrefix(h.srv.URL, "http") + "/api/v1/hosts/" + strconv.FormatInt(h.hostID, 10) + "/ssh"
			ws, _, err := websocket.DefaultDialer.Dial(url, nil)
			if err != nil {
				t.Fatal(err)
			}
			ws.WriteMessage(websocket.TextMessage, []byte(`{"type":"auth","token":"`+h.token+`"}`))
			ws.UnderlyingConn().Close() // gone before reading "connected"
		}
		if got := h.waitCount(0, 5*time.Second); got != 0 {
			t.Fatalf("slots leaked by clients that left mid-handshake: count=%d", got)
		}
	})

	t.Run("a refused attempt does not consume or leak a slot", func(t *testing.T) {
		h := newLimitHarness(t, 2)
		var held []*websocket.Conn
		for i := 0; i < 2; i++ {
			ws, res := h.connect()
			if res != "connected" {
				t.Fatalf("attempt %d: %q", i, res)
			}
			held = append(held, ws)
		}
		for i := 0; i < 5; i++ {
			ws, res := h.connect()
			if res == "connected" {
				t.Fatalf("attempt over the limit was accepted")
			}
			ws.Close()
		}
		if got := h.count(); got != 2 {
			t.Fatalf("refused attempts changed the count: %d", got)
		}
		for _, ws := range held {
			ws.Close()
		}
		if got := h.waitCount(0, 3*time.Second); got != 0 {
			t.Fatalf("slots not released after closing everything: count=%d", got)
		}
		// And the user can connect again.
		ws, res := h.connect()
		if res != "connected" {
			t.Fatalf("could not reconnect after releasing everything: %q", res)
		}
		ws.Close()
	})
}

// A refused connection must tell the browser why. Today the server writes the
// "too many connections" error with http.Error AFTER the WebSocket upgrade, so it
// goes nowhere: the log shows "response.WriteHeader on hijacked connection" and the
// browser only sees the socket drop. It cannot tell a full connection limit from a
// network blip, so it shows Error and retries over and over (re-asking for the SSH
// unlock each time). See integration_tests/tests/ssh-connection-limit.spec.ts.
func TestRefusalIsExplainedToTheClient(t *testing.T) {
	t.Skip("known bug: an over-limit attempt is dropped without a message; enable once the handler sends a control message instead of http.Error")
	h := newLimitHarness(t, 1)
	held, res := h.connect()
	if res != "connected" {
		t.Fatalf("first attempt: %q", res)
	}
	defer held.Close()

	ws, res := h.connect()
	defer ws.Close()
	if res == "connected" {
		t.Fatal("attempt over the limit was accepted")
	}
	if !strings.HasPrefix(res, "error:") || !strings.Contains(res, "too many") {
		t.Fatalf("expected an explicit \"error: too many connections\" message, got %q", res)
	}
}
