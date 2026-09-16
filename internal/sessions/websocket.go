package sessions

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/leolimasa/devsesh/internal/db"
)

const (
	// pingInterval is how often the server proves the connection is still
	// alive. It sends TWO things on this tick, and both are needed:
	//
	//   - a protocol-level ping, which the browser answers automatically. The
	//     pong resets the read deadline below, so the SERVER notices a dead
	//     peer even when that peer's JS is wedged.
	//   - an application-level "heartbeat" message, which is the only one of
	//     the two the page can observe -- browsers do not surface ping/pong to
	//     script. The CLIENT measures silence against it to detect a half-open
	//     socket, which never fires a close event and so would otherwise leave
	//     the tab deaf forever.
	pingInterval = 15 * time.Second
	// pongWait bounds how long the server tolerates silence from a client
	// before treating the connection as dead. Must comfortably exceed
	// pingInterval (a single dropped ping must not kill a healthy connection)
	// and the client's own staleness threshold, so the client gets first go at
	// reconnecting gracefully.
	pongWait = 60 * time.Second
	// authWait bounds the wait for the first message (the JWT), so an
	// unauthenticated connection cannot idle forever holding resources.
	authWait = 15 * time.Second
	// writeWait bounds a single write so a wedged peer cannot block writePump
	// indefinitely.
	writeWait = 10 * time.Second
)

type SessionUpdate struct {
	Event     string     `json:"event"`
	SessionID string     `json:"session_id"`
	Session   db.Session `json:"session"`
	// Clipboard carries the copied text for "clipboard" events (from
	// `devsesh copy`). Empty for every other event; a clipboard event leaves
	// Session as its zero value and sets SessionID + Clipboard.
	Clipboard string `json:"clipboard,omitempty"`
}

// heartbeatMsg is the pre-marshalled application-level keepalive. It carries no
// session, so clients MUST filter it out before handing an update to session
// state -- see the hook's dispatch in web/src/hooks/useSessionUpdates.ts.
var heartbeatMsg = func() []byte {
	data, err := json.Marshal(SessionUpdate{Event: "heartbeat"})
	if err != nil {
		// Marshalling a constant struct cannot fail; fall back to the literal
		// rather than panic at init.
		return []byte(`{"event":"heartbeat"}`)
	}
	return data
}()

type client struct {
	conn   *websocket.Conn
	send   chan []byte
	userID int64
	// closeOnce guards close(send). Unregister is reachable from two places --
	// the slow-consumer eviction in Broadcast and UpdatesHandler's defer -- and
	// closing an already-closed channel panics.
	closeOnce sync.Once
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
	h.unregisterLocked(c)
}

// unregisterLocked drops a client and closes its send channel. The caller must
// hold h.mu for WRITING: closing send under the same lock that guards every
// send into it is what makes "send on closed channel" impossible.
func (h *Hub) unregisterLocked(c *client) {
	if clients, ok := h.clients[c.userID]; ok {
		delete(clients, c)
		if len(clients) == 0 {
			delete(h.clients, c.userID)
		}
	}
	c.closeOnce.Do(func() { close(c.send) })
}

func (h *Hub) Broadcast(userID int64, msg SessionUpdate) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	// Take the write lock for the whole fan-out. Every send is non-blocking, so
	// this cannot stall, and holding it means a concurrent Unregister can't
	// close a send channel out from under us mid-loop.
	h.mu.Lock()
	var dropped []*client
	for c := range h.clients[userID] {
		select {
		case c.send <- data:
		default:
			// Slow consumer: its buffer is full, so it is not keeping up.
			// Evicting closes the connection, which tells the client to
			// reconnect and resync.
			dropped = append(dropped, c)
		}
	}
	for _, c := range dropped {
		h.unregisterLocked(c)
	}
	h.mu.Unlock()

	// Close outside the lock: the network call has no business holding it.
	for _, c := range dropped {
		c.conn.Close()
	}
}

// writePump owns every write to the connection (gorilla/websocket allows only
// one concurrent writer). It drains the client's send queue and, on each
// pingInterval tick, emits the keepalive pair described on pingInterval.
func writePump(c *client) {
	ticker := time.NewTicker(pingInterval)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				// The hub unregistered us. Say goodbye properly so the client
				// gets a close event and reconnects promptly.
				c.conn.SetWriteDeadline(time.Now().Add(writeWait))
				c.conn.WriteMessage(websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
				return
			}
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.TextMessage, heartbeatMsg); err != nil {
				return
			}
			if err := c.conn.WriteControl(websocket.PingMessage, nil,
				time.Now().Add(writeWait)); err != nil {
				return
			}
		}
	}
}
