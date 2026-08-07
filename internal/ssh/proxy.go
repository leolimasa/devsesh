package ssh

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"sync"
	"time"

	"github.com/leolimasa/devsesh/internal/config"
	"github.com/leolimasa/devsesh/internal/db"
	"github.com/gorilla/websocket"
)

type ControlMessage struct {
	Type    string `json:"type"`
	Message string `json:"message,omitempty"`
	Host    string `json:"host,omitempty"`
	Port    int    `json:"port,omitempty"`
}

const (
	// An interactive terminal is legitimately idle for long stretches (the user is
	// reading, the remote shell produces no output). We must NOT tear the session
	// down on idle. Instead we keep it alive with WebSocket ping/pong: the server
	// pings every pingPeriod, the browser auto-replies with a pong, and each pong
	// pushes the read deadline forward. A truly dead client stops ponging and is
	// dropped within pongWait.
	defaultPongWait     = 90 * time.Second
	defaultPingPeriod   = 30 * time.Second
	defaultWriteTimeout = 10 * time.Second
)

type TCPProxy struct {
	ws      *websocket.Conn
	tcp     net.Conn
	done    chan struct{}
	mu      sync.Mutex
	writeMu sync.Mutex // serializes all writes to ws (gorilla forbids concurrent writes)

	// Keepalive timings; overridable in tests.
	pongWait     time.Duration
	pingPeriod   time.Duration
	writeTimeout time.Duration
}

// isTimeout reports whether err is an i/o timeout (e.g. the websocket read
// deadline expiring because pongs stopped) — the signature of an idle client
// drop rather than a normal close.
func isTimeout(err error) bool {
	var ne net.Error
	return errors.As(err, &ne) && ne.Timeout()
}

func NewTCPProxy(ws *websocket.Conn, tcp net.Conn) *TCPProxy {
	return &TCPProxy{
		ws:           ws,
		tcp:          tcp,
		done:         make(chan struct{}),
		pongWait:     defaultPongWait,
		pingPeriod:   defaultPingPeriod,
		writeTimeout: defaultWriteTimeout,
	}
}

func (p *TCPProxy) Run() error {
	go p.proxyWebSocketToTCP()
	go p.proxyTCPToWebSocket()
	go p.pingLoop()

	<-p.done
	return nil
}

func (p *TCPProxy) proxyWebSocketToTCP() {
	buf := make([]byte, 4096)

	// Keep the connection alive while idle by extending the read deadline on every
	// pong (see pingLoop). Without this, an idle terminal is killed after pongWait.
	p.ws.SetReadDeadline(time.Now().Add(p.pongWait))
	p.ws.SetPongHandler(func(string) error {
		p.ws.SetReadDeadline(time.Now().Add(p.pongWait))
		return nil
	})

	for {
		select {
		case <-p.done:
			p.cleanup()
			return
		default:
		}

		msgType, reader, err := p.ws.NextReader()
		if err != nil {
			// Log at INFO so idle drops are diagnosable from the journal. The
			// common idle cause is a read-deadline timeout: the client (often a
			// backgrounded/suspended tab) stopped answering pings, so no pong
			// pushed the deadline forward within pongWait.
			slog.Info("SSH proxy websocket closed", "reason", err.Error(),
				"idle_timeout", isTimeout(err))
			p.cleanup()
			return
		}

		if msgType == websocket.TextMessage {
			slog.Debug("WebSocketToTCP skipping text message")
			continue
		}

		for {
			n, err := reader.Read(buf)
			if n > 0 {
				slog.Debug("WebSocketToTCP forwarding", "bytes", n)
				_, writeErr := p.tcp.Write(buf[:n])
				if writeErr != nil {
					slog.Error("failed to write to TCP", "error", writeErr)
					p.cleanup()
					return
				}
			}
			if err != nil {
				if err == io.EOF {
					// End of this WebSocket message, continue to next
					break
				}
				slog.Error("failed to read from WebSocket", "error", err)
				p.cleanup()
				return
			}
		}
	}
}

func (p *TCPProxy) proxyTCPToWebSocket() {
	buf := make([]byte, 4096)
	for {
		select {
		case <-p.done:
			p.cleanup()
			return
		default:
		}

		// No read deadline here: an interactive remote shell is legitimately idle
		// for long stretches. A dead upstream surfaces as a read error, and
		// cleanup() closes p.tcp to unblock this read when the other side goes away.
		n, err := p.tcp.Read(buf)
		if err != nil {
			slog.Debug("TCPToWebSocket read error", "error", err)
			p.cleanup()
			return
		}

		slog.Debug("TCPToWebSocket forwarding", "bytes", n)

		p.writeMu.Lock()
		p.ws.SetWriteDeadline(time.Now().Add(p.writeTimeout))
		err = p.ws.WriteMessage(websocket.BinaryMessage, buf[:n])
		p.writeMu.Unlock()
		if err != nil {
			slog.Debug("TCPToWebSocket write error", "error", err)
			p.cleanup()
			return
		}
	}
}

// pingLoop keeps the WebSocket alive during idle periods. The browser answers
// each ping with a pong, which the pong handler uses to push the read deadline
// forward; a client that stops responding is dropped within pongWait.
func (p *TCPProxy) pingLoop() {
	ticker := time.NewTicker(p.pingPeriod)
	defer ticker.Stop()
	for {
		select {
		case <-p.done:
			return
		case <-ticker.C:
			p.writeMu.Lock()
			p.ws.SetWriteDeadline(time.Now().Add(p.writeTimeout))
			err := p.ws.WriteMessage(websocket.PingMessage, nil)
			p.writeMu.Unlock()
			if err != nil {
				slog.Debug("ping write error", "error", err)
				p.cleanup()
				return
			}
		}
	}
}

func (p *TCPProxy) cleanup() {
	p.mu.Lock()
	defer p.mu.Unlock()

	select {
	case <-p.done:
		return
	default:
		close(p.done)
	}

	if p.tcp != nil {
		p.tcp.Close()
	}
	if p.ws != nil {
		p.ws.Close()
	}
}

func (p *TCPProxy) sendControlMessage(msg ControlMessage) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	p.ws.SetWriteDeadline(time.Now().Add(p.writeTimeout))
	return p.ws.WriteMessage(websocket.TextMessage, data)
}

type ConnectionManager struct {
	mu           sync.Mutex
	activeConns  map[int64]int
	maxConns     int
}

func NewConnectionManager(cfg config.Config) *ConnectionManager {
	return &ConnectionManager{
		activeConns: make(map[int64]int),
		maxConns:    cfg.SSHMaxConnections,
	}
}

func (cm *ConnectionManager) CanConnect(userID int64) bool {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	count := cm.activeConns[userID]
	return count < cm.maxConns
}

func (cm *ConnectionManager) AddConnection(userID int64) {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	cm.activeConns[userID]++
}

func (cm *ConnectionManager) RemoveConnection(userID int64) {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	if cm.activeConns[userID] > 0 {
		cm.activeConns[userID]--
	}
}

func LogConnectionAttempt(userID int64, hostID int64, success bool) {
	status := "success"
	if !success {
		status = "failure"
	}
	slog.Info("SSH proxy connection attempt", "user_id", userID, "host_id", hostID, "status", status)
}

func ValidateHostOwnership(host *db.Host, userID int64) bool {
	return host != nil && host.UserID == userID
}