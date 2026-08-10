package server

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"

	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/leolimasa/devsesh/internal/auth"
	"github.com/leolimasa/devsesh/internal/config"
	"github.com/leolimasa/devsesh/internal/hosts"
	"github.com/leolimasa/devsesh/internal/quickkeys"
	"github.com/leolimasa/devsesh/internal/settings"
	"github.com/leolimasa/devsesh/internal/sessions"
	"github.com/leolimasa/devsesh/internal/ssh"
	"github.com/leolimasa/devsesh/internal/ssh/ca"
	"github.com/leolimasa/devsesh/web"
)

type Server struct {
	cfg           config.Config
	db            *sql.DB
	wa            *webauthn.WebAuthn
	cs            *auth.ChallengeStore
	hub           *sessions.Hub
	enrollmentHub *auth.EnrollmentHub
	mux           *http.ServeMux
	srv           *http.Server
}

// staticETag is a single validator for all embedded web assets; it changes only
// when the embedded bundle changes (a new build/deploy). It lets browsers
// revalidate cheaply (304 Not Modified) instead of re-downloading multi-MB
// assets like sshclient.wasm on every load. Computed once at process start.
var staticETag = computeStaticETag()

func computeStaticETag() string {
	h := sha256.New()
	_ = fs.WalkDir(web.FS, "dist", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, rerr := fs.ReadFile(web.FS, p)
		if rerr != nil {
			return rerr
		}
		h.Write([]byte(p))
		h.Write(b)
		return nil
	})
	return `"` + hex.EncodeToString(h.Sum(nil)[:16]) + `"`
}

// serveCached attaches cache headers and the build ETag to an embedded-asset
// response, answering 304 when the client already holds the current build. Vite
// content-hashes files under /assets, so those are immutable; everything else
// (the service worker, /sshclient.wasm) must revalidate so a redeploy is picked
// up. Always writes a response.
func serveCached(w http.ResponseWriter, r *http.Request, next http.Handler) {
	if strings.HasPrefix(r.URL.Path, "/assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	w.Header().Set("ETag", staticETag)
	if r.Header.Get("If-None-Match") == staticETag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	next.ServeHTTP(w, r)
}

func New(cfg config.Config, database *sql.DB, cs *auth.ChallengeStore) (*Server, error) {
	wa, err := auth.NewWebAuthn(cfg.RPID, cfg.RPOrigin)
	if err != nil {
		return nil, err
	}

	hub := sessions.NewHub()
	enrollmentHub := auth.NewEnrollmentHub()
	mux := http.NewServeMux()

	// Serve the PWA manifest with the correct MIME type (Go's mime package
	// doesn't know .webmanifest by default).
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")

	webContent, _ := fs.Sub(web.FS, "dist")
	webFS := http.FileServer(http.FS(webContent))

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if path.Ext(r.URL.Path) != "" && path.Ext(r.URL.Path) != "/" {
			// The embedded FS has no modtime, so net/http emits no cache
			// validators — the browser re-downloads every asset (e.g. the ~7MB
			// sshclient.wasm) on every load. Attach cache headers + a build ETag
			// so it can revalidate cheaply (304) or skip revalidation entirely
			// for content-hashed bundles.
			serveCached(w, r, webFS)
			return
		}
		// index.html: always revalidate so a redeploy is picked up.
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("ETag", staticETag)
		if r.Header.Get("If-None-Match") == staticETag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		indexContent, _ := fs.ReadFile(web.FS, "dist/index.html")
		w.Header().Set("Content-Type", "text/html")
		w.Write(indexContent)
	})

	jwtMiddleware := RequireJWT(cfg.JWTSecret)

	mux.Handle("GET /api/v1/auth/status", auth.AuthStatusHandler(database))

	// Debug endpoint: the frontend POSTs client-side errors here (e.g. iOS Safari
	// WebAuthn failures that are otherwise invisible without devtools) so they
	// land in the server journal. Unauthenticated and best-effort by design.
	mux.HandleFunc("POST /api/v1/client-log", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(io.LimitReader(r.Body, 8192))
		slog.Warn("client log", "ua", r.Header.Get("User-Agent"), "body", string(body))
		w.WriteHeader(http.StatusNoContent)
	})

	mux.Handle("POST /api/v1/auth/login/begin", auth.LoginBeginHandler(wa, database, cs))
	mux.Handle("POST /api/v1/auth/login/finish", auth.LoginFinishHandler(wa, database, cfg, cs))
	mux.Handle("POST /api/v1/auth/register/begin", auth.RegisterBeginHandler(wa, database, cfg, cs))
	mux.Handle("POST /api/v1/auth/register/finish", auth.RegisterFinishHandler(wa, database, cfg, cs))

	mux.Handle("POST /api/v1/auth/pair/start", auth.PairStartHandler(database, cfg))
	mux.Handle("POST /api/v1/auth/pair/exchange", jwtMiddleware(http.HandlerFunc(auth.PairExchangeHandler(database))))
	mux.Handle("POST /api/v1/auth/pair/complete", auth.PairCompleteHandler(database, cfg))

	mux.Handle("GET /api/v1/auth/passkeys", jwtMiddleware(http.HandlerFunc(auth.ListPasskeysHandler(database))))
	mux.Handle("POST /api/v1/auth/passkeys/begin", jwtMiddleware(http.HandlerFunc(auth.AddPasskeyBeginHandler(wa, database, cs))))
	mux.Handle("POST /api/v1/auth/passkeys/finish", jwtMiddleware(http.HandlerFunc(auth.AddPasskeyFinishHandler(wa, database, cs))))
	mux.Handle("DELETE /api/v1/auth/passkeys/{id}", jwtMiddleware(http.HandlerFunc(auth.DeletePasskeyHandler(database))))

	mux.Handle("POST /api/v1/auth/passkeys/enrollment", auth.CreateEnrollmentHandler(database))
	mux.Handle("GET /api/v1/auth/passkeys/enrollment/{code}", auth.EnrollmentWebSocketHandler(database, enrollmentHub, cfg))
	mux.Handle("POST /api/v1/auth/passkeys/enrollment/{code}/begin", auth.EnrollmentBeginHandler(wa, database, cs))
	mux.Handle("POST /api/v1/auth/passkeys/enrollment/{code}/complete", auth.EnrollmentCompleteHandler(wa, database, cs))
	mux.Handle("GET /api/v1/auth/master-key", jwtMiddleware(http.HandlerFunc(auth.GetMasterKeyHandler(database))))
	mux.Handle("POST /api/v1/auth/master-key", jwtMiddleware(http.HandlerFunc(auth.AddMasterKeyBlobHandler(database))))
	mux.Handle("POST /api/v1/auth/passkeys/auth-begin", jwtMiddleware(http.HandlerFunc(auth.AuthBeginWithJWTHandler(wa, database, cs))))
	mux.Handle("POST /api/v1/auth/passkeys/auth-finish", jwtMiddleware(http.HandlerFunc(auth.AuthFinishWithJWTHandler(wa, database, cs, cfg))))

	mux.Handle("POST /api/v1/sessions/{session_id}/start", jwtMiddleware(RequireValidHost(database)(http.HandlerFunc(sessions.StartHandler(database, hub)))))
	mux.Handle("POST /api/v1/sessions/{session_id}/ping", jwtMiddleware(RequireSessionOwner(database)(http.HandlerFunc(sessions.PingHandler(database, hub)))))
	mux.Handle("POST /api/v1/sessions/{session_id}/activity", jwtMiddleware(RequireSessionOwner(database)(http.HandlerFunc(sessions.ActivityHandler(database, hub)))))
	mux.Handle("POST /api/v1/sessions/{session_id}/end", jwtMiddleware(RequireSessionOwner(database)(http.HandlerFunc(sessions.EndHandler(database, hub)))))
	mux.Handle("POST /api/v1/sessions/{session_id}/meta", jwtMiddleware(RequireSessionOwner(database)(http.HandlerFunc(sessions.MetaHandler(database, hub)))))
	mux.Handle("GET /api/v1/sessions", jwtMiddleware(http.HandlerFunc(sessions.ListHandler(database))))
	mux.Handle("POST /api/v1/sessions/reorder", jwtMiddleware(http.HandlerFunc(sessions.ReorderHandler(database))))
	mux.Handle("POST /api/v1/sessions/{session_id}/clipboard", jwtMiddleware(RequireSessionOwner(database)(http.HandlerFunc(sessions.ClipboardHandler(database, hub)))))
	mux.Handle("GET /api/v1/sessions/{session_id}", jwtMiddleware(http.HandlerFunc(sessions.GetSessionHandler(database))))
	mux.Handle("DELETE /api/v1/sessions/{session_id}", jwtMiddleware(RequireSessionOwner(database)(http.HandlerFunc(sessions.DeleteSessionHandler(database, hub)))))
	mux.Handle("DELETE /api/v1/sessions/stale", jwtMiddleware(http.HandlerFunc(sessions.DeleteStaleHandler(database))))
	mux.Handle("GET /api/v1/sessions/updates", http.HandlerFunc(sessions.UpdatesHandler(database, hub, cfg.JWTSecret, cfg.RPOrigin)))

	mux.Handle("GET /api/v1/hosts", jwtMiddleware(http.HandlerFunc(hosts.ListHandler(database))))
	mux.Handle("POST /api/v1/hosts", jwtMiddleware(http.HandlerFunc(hosts.CreateHandler(database))))
	mux.Handle("GET /api/v1/hosts/{host_id}", jwtMiddleware(http.HandlerFunc(hosts.GetHandler(database))))
	mux.Handle("PUT /api/v1/hosts/{host_id}", jwtMiddleware(http.HandlerFunc(hosts.UpdateHandler(database))))
	mux.Handle("DELETE /api/v1/hosts/{host_id}", jwtMiddleware(http.HandlerFunc(hosts.DeleteHandler(database))))

	mux.Handle("GET /api/v1/quick-keys", jwtMiddleware(http.HandlerFunc(quickkeys.ListHandler(database))))
	mux.Handle("GET /api/v1/quick-keys/{id}", jwtMiddleware(http.HandlerFunc(quickkeys.GetHandler(database))))
	mux.Handle("POST /api/v1/quick-keys", jwtMiddleware(http.HandlerFunc(quickkeys.CreateHandler(database))))
	mux.Handle("PUT /api/v1/quick-keys/{id}", jwtMiddleware(http.HandlerFunc(quickkeys.UpdateHandler(database))))
	mux.Handle("DELETE /api/v1/quick-keys/{id}", jwtMiddleware(http.HandlerFunc(quickkeys.DeleteHandler(database))))

	mux.Handle("GET /api/v1/settings", jwtMiddleware(http.HandlerFunc(settings.GetHandler(database))))
	mux.Handle("PUT /api/v1/settings", jwtMiddleware(http.HandlerFunc(settings.UpdateHandler(database))))

	ssh.RegisterRoutes(mux, database, jwtMiddleware, cfg)

	sshCAHandler := ca.NewHandler(database, cfg.SSHCA, cfg.RPOrigin)
	mux.Handle("GET /api/v1/sshca/public-key", jwtMiddleware(http.HandlerFunc(sshCAHandler.PublicKeyHandler())))
	mux.Handle("GET /api/v1/sshca/client-share", jwtMiddleware(http.HandlerFunc(sshCAHandler.ClientShareHandler())))
	mux.Handle("PUT /api/v1/sshca/client-share", jwtMiddleware(http.HandlerFunc(sshCAHandler.UpdateClientShareHandler())))
	mux.Handle("GET /api/v1/sshca/config", jwtMiddleware(http.HandlerFunc(sshCAHandler.ConfigHandler())))
	mux.Handle("GET /api/v1/sshca/sign", jwtMiddleware(http.HandlerFunc(sshCAHandler.SigningWebSocketHandler())))

	return &Server{
		cfg:           cfg,
		db:            database,
		wa:            wa,
		cs:            cs,
		hub:           hub,
		enrollmentHub: enrollmentHub,
		mux:           mux,
	}, nil
}

func (s *Server) Start() error {
	host := s.cfg.Host
	if host == "" {
		host = "localhost"
	}
	addr := host + ":" + strconv.Itoa(s.cfg.Port)
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
