package server

import (
	"database/sql"
	"io/fs"
	"net/http"

	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/leobeosab/devsesh/internal/auth"
	"github.com/leobeosab/devsesh/internal/config"
	"github.com/leobeosab/devsesh/internal/sessions"
	"github.com/leobeosab/devsesh/internal/ssh"
	"github.com/leobeosab/devsesh/web"
)

type Server struct {
	cfg    config.Config
	db     *sql.DB
	wa     *webauthn.WebAuthn
	cs     *auth.ChallengeStore
	hub    *sessions.Hub
	mux    *http.ServeMux
}

func New(cfg config.Config, database *sql.DB, cs *auth.ChallengeStore) (*Server, error) {
	wa, err := auth.NewWebAuthn("localhost", "http://localhost:8080")
	if err != nil {
		return nil, err
	}

	hub := sessions.NewHub()
	mux := http.NewServeMux()

	webContent, _ := fs.Sub(web.FS, ".")
	mux.Handle("GET /", http.FileServer(http.FS(webContent)))

	jwtMiddleware := RequireJWT(cfg.JWTSecret)

	mux.Handle("POST /api/v1/auth/login/begin", auth.LoginBeginHandler(wa, database, cs))
	mux.Handle("POST /api/v1/auth/login/finish", auth.LoginFinishHandler(wa, database, cfg, cs))
	mux.Handle("POST /api/v1/auth/register/begin", auth.RegisterBeginHandler(wa, database, cfg, cs))
	mux.Handle("POST /api/v1/auth/register/finish", auth.RegisterFinishHandler(wa, database, cs))

	mux.Handle("POST /api/v1/auth/pair/start", auth.PairStartHandler(database, cfg))
	mux.Handle("POST /api/v1/auth/pair/exchange", jwtMiddleware(http.HandlerFunc(auth.PairExchangeHandler(database))))
	mux.Handle("POST /api/v1/auth/pair/complete", auth.PairCompleteHandler(database, cfg))

	mux.Handle("POST /api/v1/sessions/{session_id}/start", jwtMiddleware(http.HandlerFunc(sessions.StartHandler(database, hub))))
	mux.Handle("POST /api/v1/sessions/{session_id}/ping", jwtMiddleware(RequireSessionOwner(database)(http.HandlerFunc(sessions.PingHandler(database, hub)))))
	mux.Handle("POST /api/v1/sessions/{session_id}/end", jwtMiddleware(RequireSessionOwner(database)(http.HandlerFunc(sessions.EndHandler(database, hub)))))
	mux.Handle("POST /api/v1/sessions/{session_id}/meta", jwtMiddleware(RequireSessionOwner(database)(http.HandlerFunc(sessions.MetaHandler(database, hub)))))
	mux.Handle("GET /api/v1/sessions", jwtMiddleware(http.HandlerFunc(sessions.ListHandler(database))))
	mux.Handle("GET /api/v1/sessions/updates", jwtMiddleware(http.HandlerFunc(sessions.UpdatesHandler(hub))))

	ssh.RegisterRoutes(mux, database, jwtMiddleware)

	return &Server{
		cfg: cfg,
		db:  database,
		wa:  wa,
		cs:  cs,
		hub: hub,
		mux: mux,
	}, nil
}

func (s *Server) Start() error {
	addr := ":" + itoa(s.cfg.Port)
	return http.ListenAndServe(addr, s.mux)
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var buf [20]byte
	n := len(buf)
	for i > 0 {
		n--
		buf[n] = byte('0' + i%10)
		i /= 10
	}
	return string(buf[n:])
}
