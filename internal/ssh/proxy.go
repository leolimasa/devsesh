package ssh

import (
	"encoding/json"
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

type TCPProxy struct {
	ws    *websocket.Conn
	tcp   net.Conn
	done  chan struct{}
	mu    sync.Mutex
}

func NewTCPProxy(ws *websocket.Conn, tcp net.Conn) *TCPProxy {
	return &TCPProxy{
		ws:   ws,
		tcp:  tcp,
		done: make(chan struct{}),
	}
}

func (p *TCPProxy) Run() error {
	go p.proxyWebSocketToTCP()
	go p.proxyTCPToWebSocket()

	<-p.done
	return nil
}

func (p *TCPProxy) proxyWebSocketToTCP() {
	buf := make([]byte, 4096)
	for {
		select {
		case <-p.done:
			p.cleanup()
			return
		default:
		}

		p.ws.SetReadDeadline(time.Now().Add(30 * time.Second))
		msgType, reader, err := p.ws.NextReader()
		if err != nil {
			slog.Debug("WebSocketToTCP read error", "error", err)
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

		p.tcp.SetReadDeadline(time.Now().Add(30 * time.Second))
		n, err := p.tcp.Read(buf)
		if err != nil {
			slog.Debug("TCPToWebSocket read error", "error", err)
			p.cleanup()
			return
		}

		slog.Debug("TCPToWebSocket forwarding", "bytes", n)

		err = p.ws.WriteMessage(websocket.BinaryMessage, buf[:n])
		if err != nil {
			slog.Debug("TCPToWebSocket write error", "error", err)
			p.cleanup()
			return
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