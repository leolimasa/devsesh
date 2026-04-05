package sessions

import (
	"encoding/json"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/leolimasa/devsesh/internal/db"
)

type SessionUpdate struct {
	Event     string     `json:"event"`
	SessionID string     `json:"session_id"`
	Session   db.Session `json:"session"`
}

type client struct {
	conn   *websocket.Conn
	send   chan []byte
	userID int64
}

type Hub struct {
	clients map[int64]map[*client]bool
	mu      sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		clients: make(map[int64]map[*client]bool),
	}
}

func (h *Hub) Register(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.clients[c.userID] == nil {
		h.clients[c.userID] = make(map[*client]bool)
	}
	h.clients[c.userID][c] = true
}

func (h *Hub) Unregister(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if clients, ok := h.clients[c.userID]; ok {
		delete(clients, c)
		if len(clients) == 0 {
			delete(h.clients, c.userID)
		}
	}
	close(c.send)
}

func (h *Hub) Broadcast(userID int64, msg SessionUpdate) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	h.mu.RLock()
	clients := h.clients[userID]
	h.mu.RUnlock()

	for c := range clients {
		select {
		case c.send <- data:
		default:
			h.Unregister(c)
			c.conn.Close()
		}
	}
}

func writePump(c *client) {
	defer c.conn.Close()
	for msg := range c.send {
		if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			return
		}
	}
}
