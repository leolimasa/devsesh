package server

import (
	"context"
	"database/sql"
	"io/fs"
	"net/http"
	"path"
	"strconv"

	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/leolimasa/devsesh/internal/auth"
	"github.com/leolimasa/devsesh/internal/config"
	"github.com/leolimasa/devsesh/internal/sessions"
	"github.com/leolimasa/devsesh/internal/ssh"
	"github.com/leolimasa/devsesh/web"
)

type Server struct {
	cfg    config.Config
	db     *sql.DB
	wa     *webauthn.WebAuthn
	cs     *auth.ChallengeStore
	hub    *sessions.Hub
	mux    *http.ServeMux
	srv    *http.Server
}

func New(cfg config.Config, database *sql.DB, cs *auth.ChallengeStore) (*Server, error) {
	wa, err := auth.NewWebAuthn(cfg.RPID, cfg.RPOrigin)
	if err != nil {
		return nil, err
	}

	hub := sessions.NewHub()
	mux := http.NewServeMux()

	webContent, _ := fs.Sub(web.FS, ".")
	webFS := http.FileServer(http.FS(webContent))

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if path.Ext(r.URL.Path) != "" && path.Ext(r.URL.Path) != "/" {
			webFS.ServeHTTP(w, r)
			return
		}
		indexContent, _ := fs.ReadFile(web.FS, "dist/index.html")
		w.Header().Set("Content-Type", "text/html")
		w.Write(indexContent)
	})

	jwtMiddleware := RequireJWT(cfg.JWTSecret)

	mux.Handle("GET /api/v1/auth/status", auth.AuthStatusHandler(database))

	mux.Handle("POST /api/v1/auth/login/begin", auth.LoginBeginHandler(wa, database, cs))
	mux.Handle("POST /api/v1/auth/login/finish", auth.LoginFinishHandler(wa, database, cfg, cs))
	mux.Handle("POST /api/v1/auth/register/begin", auth.RegisterBeginHandler(wa, database, cfg, cs))
	mux.Handle("POST /api/v1/auth/register/finish", auth.RegisterFinishHandler(wa, database, cs))

	mux.Handle("POST /api/v1/auth/pair/start", auth.PairStartHandler(database, cfg))
	mux.Handle("POST /api/v1/auth/pair/exchange", jwtMiddleware(http.HandlerFunc(auth.PairExchangeHandler(database))))
	mux.Handle("POST /api/v1/auth/pair/complete", auth.PairCompleteHandler(database, cfg))

	mux.Handle("GET /api/v1/auth/passkeys", jwtMiddleware(http.HandlerFunc(auth.ListPasskeysHandler(database))))
	mux.Handle("POST /api/v1/auth/passkeys/begin", jwtMiddleware(http.HandlerFunc(auth.AddPasskeyBeginHandler(wa, database, cs))))
	mux.Handle("POST /api/v1/auth/passkeys/finish", jwtMiddleware(http.HandlerFunc(auth.AddPasskeyFinishHandler(wa, database, cs))))
	mux.Handle("DELETE /api/v1/auth/passkeys/{id}", jwtMiddleware(http.HandlerFunc(auth.DeletePasskeyHandler(database))))

	mux.Handle("POST /api/v1/sessions/{session_id}/start", jwtMiddleware(http.HandlerFunc(sessions.StartHandler(database, hub))))
	mux.Handle("POST /api/v1/sessions/{session_id}/ping", jwtMiddleware(RequireSessionOwner(database)(http.HandlerFunc(sessions.PingHandler(database, hub)))))
	mux.Handle("POST /api/v1/sessions/{session_id}/end", jwtMiddleware(RequireSessionOwner(database)(http.HandlerFunc(sessions.EndHandler(database, hub)))))
	mux.Handle("POST /api/v1/sessions/{session_id}/meta", jwtMiddleware(RequireSessionOwner(database)(http.HandlerFunc(sessions.MetaHandler(database, hub)))))
	mux.Handle("GET /api/v1/sessions", jwtMiddleware(http.HandlerFunc(sessions.ListHandler(database))))
	mux.Handle("GET /api/v1/sessions/{session_id}", jwtMiddleware(http.HandlerFunc(sessions.GetSessionHandler(database))))
	mux.Handle("DELETE /api/v1/sessions/stale", jwtMiddleware(http.HandlerFunc(sessions.DeleteStaleHandler(database))))
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
	addr := ":" + strconv.Itoa(s.cfg.Port)
	s.srv = &http.Server{
		Addr:    addr,
		Handler: s.mux,
	}
	return s.srv.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	if s.srv == nil {
		return nil
	}
	return s.srv.Shutdown(ctx)
}
