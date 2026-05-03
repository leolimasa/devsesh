package ssh

import (
	"fmt"
	"time"

	"github.com/google/uuid"
)

// SigningSession represents an active SSH certificate signing session.
// Each session has a unique ID, associated user and host, the certificate
// to-be-signed data, and FROST signing state.
type SigningSession struct {
	ID           string
	UserID       int64
	HostID       int64
	TBSData      []byte
	ServerNonces []byte
	Commitment   []byte
	CreatedAt    time.Time
	ExpiresAt    time.Time
}

// IsExpired returns true if the session has passed its expiration time.
func (s *SigningSession) IsExpired() bool {
	return time.Now().After(s.ExpiresAt)
}

// sessionOp represents a typed operation for the SessionManager actor.
type sessionOp int

const (
	opCreate sessionOp = iota
	opGet
	opDelete
	opUpdate
	opCleanup
)

// sessionCmd represents a command sent to the SessionManager actor.
type sessionCmd struct {
	op           sessionOp
	id           string
	userID       int64
	hostID       int64
	tbsData      []byte
	serverNonces []byte
	commitment   []byte
	respCh       chan sessionResp
}

// sessionResp is the response from the SessionManager actor.
type sessionResp struct {
	session *SigningSession
	err     error
}

// SessionManager manages signing sessions using the actor model.
// A single goroutine owns the session map and processes commands
// sequentially via a channel, ensuring thread safety without locks.
type SessionManager struct {
	cmdCh  chan sessionCmd
	expiry time.Duration
}

// NewSessionManager creates a new SessionManager that spawns an actor
// goroutine to manage sessions. The actor processes commands from the
// command channel and runs a cleanup ticker to expire old sessions.
// Uses default 60-second session expiry.
func NewSessionManager() *SessionManager {
	return NewSessionManagerWithExpiry(60 * time.Second)
}

// NewSessionManagerWithExpiry creates a SessionManager with a custom session expiry duration.
// This is useful for testing with shorter expiry times.
func NewSessionManagerWithExpiry(expiry time.Duration) *SessionManager {
	sm := &SessionManager{
		cmdCh:  make(chan sessionCmd, 100),
		expiry: expiry,
	}
	go sm.actor()
	return sm
}

// actor is the main goroutine that owns the session state.
// It processes commands sequentially and runs periodic cleanup.
func (sm *SessionManager) actor() {
	sessions := make(map[string]*SigningSession)
	cleanupTicker := time.NewTicker(30 * time.Second)
	defer cleanupTicker.Stop()

	for {
		select {
		case cmd := <-sm.cmdCh:
			switch cmd.op {
			case opCreate:
				session := &SigningSession{
					ID:        uuid.New().String(),
					UserID:    cmd.userID,
					HostID:    cmd.hostID,
					TBSData:   cmd.tbsData,
					CreatedAt: time.Now(),
					ExpiresAt: time.Now().Add(sm.expiry),
				}
				sessions[session.ID] = session
				cmd.respCh <- sessionResp{session: session}

			case opGet:
				session, exists := sessions[cmd.id]
				if !exists {
					cmd.respCh <- sessionResp{err: fmt.Errorf("session not found: %s", cmd.id)}
					continue
				}
				if session.IsExpired() {
					delete(sessions, cmd.id)
					cmd.respCh <- sessionResp{err: fmt.Errorf("session expired: %s", cmd.id)}
					continue
				}
				cmd.respCh <- sessionResp{session: session}

			case opDelete:
				session, exists := sessions[cmd.id]
				if exists {
					// Zero out sensitive data before deletion
					for i := range session.TBSData {
						session.TBSData[i] = 0
					}
					for i := range session.ServerNonces {
						session.ServerNonces[i] = 0
					}
					for i := range session.Commitment {
						session.Commitment[i] = 0
					}
					delete(sessions, cmd.id)
				}
				cmd.respCh <- sessionResp{}

			case opUpdate:
				session, exists := sessions[cmd.id]
				if !exists {
					cmd.respCh <- sessionResp{err: fmt.Errorf("session not found: %s", cmd.id)}
					continue
				}
				if session.IsExpired() {
					delete(sessions, cmd.id)
					cmd.respCh <- sessionResp{err: fmt.Errorf("session expired: %s", cmd.id)}
					continue
				}
				session.ServerNonces = cmd.serverNonces
				session.Commitment = cmd.commitment
				cmd.respCh <- sessionResp{session: session}

			case opCleanup:
				for id, session := range sessions {
					if session.IsExpired() {
						// Zero out sensitive data
						for i := range session.TBSData {
							session.TBSData[i] = 0
						}
						for i := range session.ServerNonces {
							session.ServerNonces[i] = 0
						}
						for i := range session.Commitment {
							session.Commitment[i] = 0
						}
						delete(sessions, id)
					}
				}
			}

		case <-cleanupTicker.C:
			for id, session := range sessions {
				if session.IsExpired() {
					// Zero out sensitive data
					for i := range session.TBSData {
						session.TBSData[i] = 0
					}
					for i := range session.ServerNonces {
						session.ServerNonces[i] = 0
					}
					for i := range session.Commitment {
						session.Commitment[i] = 0
					}
					delete(sessions, id)
				}
			}
		}
	}
}

// CreateSession creates a new signing session with a unique UUID and 60-second expiry.
// It sends a create command to the actor and waits for the response.
func (sm *SessionManager) CreateSession(userID, hostID int64, tbsData []byte) (*SigningSession, error) {
	respCh := make(chan sessionResp, 1)
	sm.cmdCh <- sessionCmd{
		op:      opCreate,
		userID:  userID,
		hostID:  hostID,
		tbsData: tbsData,
		respCh:  respCh,
	}
	resp := <-respCh
	return resp.session, resp.err
}

// GetSession retrieves a session by ID. Returns an error if the session
// is not found or has expired.
func (sm *SessionManager) GetSession(sessionID string) (*SigningSession, error) {
	respCh := make(chan sessionResp, 1)
	sm.cmdCh <- sessionCmd{
		op:     opGet,
		id:     sessionID,
		respCh: respCh,
	}
	resp := <-respCh
	return resp.session, resp.err
}

// DeleteSession removes a session and zeros out all sensitive data.
// Returns an error if the session is not found.
func (sm *SessionManager) DeleteSession(sessionID string) error {
	respCh := make(chan sessionResp, 1)
	sm.cmdCh <- sessionCmd{
		op:     opDelete,
		id:     sessionID,
		respCh: respCh,
	}
	resp := <-respCh
	return resp.err
}

// UpdateSession updates the server nonces and commitment for a session.
// Returns an error if the session is not found or has expired.
func (sm *SessionManager) UpdateSession(sessionID string, serverNonces, commitment []byte) error {
	respCh := make(chan sessionResp, 1)
	sm.cmdCh <- sessionCmd{
		op:           opUpdate,
		id:           sessionID,
		serverNonces: serverNonces,
		commitment:   commitment,
		respCh:       respCh,
	}
	resp := <-respCh
	return resp.err
}
