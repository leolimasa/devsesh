package cmd

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"os/user"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/leolimasa/devsesh/internal/client"
	"github.com/leolimasa/devsesh/internal/util"
	"github.com/spf13/cobra"
)

func NewWatchCmd() *cobra.Command {
	var idFlag string
	var cmd = &cobra.Command{
		Use:   "watch <name>",
		Short: "Watch an existing tmux session and report its liveness and activity",
		Long: "Watch binds a session's heartbeat and activity signal to the lifetime " +
			"of a tmux session rather than to the shell that launched it. It attaches " +
			"to the tmux session in control mode, pings the server while the session " +
			"is alive, reports terminal output as activity, and marks the session " +
			"ended when the tmux session truly ends.",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runWatch(args[0], idFlag)
		},
	}
	cmd.Flags().StringVar(&idFlag, "id", "", "session UUID to report as (generated if omitted)")
	return cmd
}

func runWatch(sessionName, sessionID string) error {
	cfg, err := client.LoadConfig()
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}
	if cfg.ServerURL == "" || cfg.JWTToken == "" {
		return fmt.Errorf("not logged in. Please run 'devsesh login <url>' first")
	}

	if !client.SessionExists(sessionName) {
		return fmt.Errorf("tmux session %q does not exist", sessionName)
	}

	sessionsDir := cfg.SessionsDir
	if sessionsDir == "" {
		if u, err := user.Current(); err == nil {
			sessionsDir = filepath.Join(u.HomeDir, ".devsesh", "sessions")
		}
	}
	if err := os.MkdirAll(sessionsDir, 0700); err != nil {
		return fmt.Errorf("failed to create sessions directory: %w", err)
	}

	// A caller (devsesh start) may have already generated the ID and written
	// the session file. When invoked standalone, generate our own ID, create
	// the session file, and inject the DEVSESH_* env into the tmux session so
	// `devsesh set` works in any panes opened afterwards.
	generated := false
	if sessionID == "" {
		sessionID = uuid.New().String()
		generated = true
	}
	sessionFile := filepath.Join(sessionsDir, sessionID+".yml")

	// A caller (devsesh start) may have already written the session file; reuse
	// it when present, otherwise create one. Stat first so the expected-miss
	// path doesn't emit a spurious error log.
	var sf *client.SessionFile
	if _, statErr := os.Stat(sessionFile); statErr == nil {
		existing, err := client.ReadSessionFile(sessionFile)
		if err != nil {
			return fmt.Errorf("failed to read session file: %w", err)
		}
		sf = existing
	} else {
		sf, err = client.NewSessionFile(sessionID, sessionName)
		if err != nil {
			return fmt.Errorf("failed to create session file: %w", err)
		}
		if err := client.WriteSessionFile(sessionFile, sf); err != nil {
			return fmt.Errorf("failed to write session file: %w", err)
		}
	}

	if generated {
		client.SetSessionEnv(sessionName, "DEVSESH_SESSION_ID", sessionID)
		client.SetSessionEnv(sessionName, "DEVSESH_SESSION_FILE", sessionFile)
		client.SetSessionEnv(sessionName, "DEVSESH_SESSION_NAME", sessionName)
	}

	apiClient := client.NewAPIClient(cfg.ServerURL, cfg.JWTToken)
	if err := apiClient.NotifySessionStart(sessionID, *sf); err != nil {
		// Non-fatal: keep monitoring even if the initial registration failed;
		// pings may still bring the session online.
		fmt.Fprintf(os.Stderr, "failed to notify session start: %v\n", err)
	}

	// sigCtx is cancelled on SIGINT/SIGTERM (watch is being torn down) -- in
	// that case we exit WITHOUT ending the session, because the tmux session
	// may still be alive. The session is only ended when the tmux session
	// itself is gone (checked below). ctx additionally lets us stop the
	// background workers once the watch loop exits.
	sigCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithCancel(sigCtx)
	defer cancel()

	var wg sync.WaitGroup

	// Watch the session file for metadata changes (e.g. `devsesh set`).
	if err := client.WatchSessionFile(ctx, &wg, sessionFile, 500*time.Millisecond, func(updated client.SessionFile) {
		meta := map[string]any{
			"name":       updated.Name,
			"start_time": updated.StartTime,
			"hostname":   updated.Hostname,
			"cwd":        updated.Cwd,
		}
		for k, v := range updated.Extra {
			meta[k] = v
		}
		if err := apiClient.UpdateSessionMeta(sessionID, meta); err != nil {
			fmt.Fprintf(os.Stderr, "failed to update session meta: %v\n", err)
		}
	}); err != nil {
		fmt.Fprintf(os.Stderr, "failed to watch session file: %v\n", err)
	}

	// Activity signal: throttled to at most once per second, fed by pane output
	// observed over control mode.
	throttle := util.NewThrottle(1*time.Second, func() {
		if err := apiClient.SendActivity(sessionID); err != nil {
			fmt.Fprintf(os.Stderr, "failed to send activity: %v\n", err)
		}
	})

	// Ping heartbeat: fires every 5 seconds for as long as the tmux session is
	// alive (i.e. until ctx is cancelled when the watch loop exits below).
	wg.Add(1)
	go func() {
		defer wg.Done()
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := apiClient.PingSession(sessionID); err != nil {
					fmt.Fprintf(os.Stderr, "failed to ping session: %v\n", err)
				}
			}
		}
	}()

	// Observe the session over control mode until it ends. Reconnect on a
	// transient control-client drop as long as the tmux session still exists,
	// so a hiccup doesn't stop monitoring a live session.
	for ctx.Err() == nil {
		if !client.SessionExists(sessionName) {
			break
		}
		client.WatchControlMode(ctx, sessionName, throttle.Call)
		if !client.SessionExists(sessionName) {
			break
		}
		select {
		case <-ctx.Done():
		case <-time.After(1 * time.Second):
		}
	}

	// Stop background workers.
	cancel()
	throttle.Stop()
	wg.Wait()

	// Only end the session if it truly ended (the tmux session is gone) and we
	// were not signalled to shut down while the session is still alive.
	if sigCtx.Err() == nil && !client.SessionExists(sessionName) {
		if err := apiClient.NotifySessionEnd(sessionID); err != nil {
			fmt.Fprintf(os.Stderr, "failed to notify session end: %v\n", err)
		}
		os.Remove(sessionFile)
		os.Remove(filepath.Join(sessionsDir, sessionID+".log"))
	}

	return nil
}
