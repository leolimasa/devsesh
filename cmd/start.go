package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"syscall"

	"github.com/google/uuid"
	"github.com/leolimasa/devsesh/internal/client"
	"github.com/spf13/cobra"
)

func NewStartCmd() *cobra.Command {
	var cmd = &cobra.Command{
		Use:   "start [name]",
		Short: "Start a new devsesh session",
		Args:  cobra.RangeArgs(0, 1),
		RunE:  runStart,
	}
	return cmd
}

func runStart(cmd *cobra.Command, args []string) error {
	if os.Getenv("DEVSESH_SESSION_ID") != "" {
		return fmt.Errorf("already inside a devsesh session")
	}

	if _, err := exec.LookPath("tmux"); err != nil {
		return fmt.Errorf("tmux is required but not installed")
	}

	cfg, err := client.LoadConfig()
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}

	if cfg.ServerURL == "" || cfg.JWTToken == "" {
		return fmt.Errorf("not logged in. Please run 'devsesh login <url>' first")
	}

	sessionName := "Unnamed Session"
	if len(args) > 0 {
		sessionName = args[0]
	}

	sessionsDir := resolveSessionsDir(cfg)
	if err := os.MkdirAll(sessionsDir, 0700); err != nil {
		return fmt.Errorf("failed to create sessions directory: %w", err)
	}

	// If a tmux session with this name already exists, attach to it -- but first
	// make sure it has a live watcher. The previous watcher may have died (crash,
	// reboot) or the session may have been created outside devsesh and never
	// watched at all; either way it would otherwise show as offline. The watcher
	// self-dedupes via an flock, so this is a no-op when one is already running.
	if client.SessionExists(sessionName) {
		ensureWatcher(sessionsDir, sessionName)
		return client.AttachSession(sessionName)
	}

	sessionID := uuid.New().String()

	sessionFile := filepath.Join(sessionsDir, sessionID+".yml")

	sf, err := client.NewSessionFile(sessionID, sessionName)
	if err != nil {
		return fmt.Errorf("failed to create session file: %w", err)
	}
	if err := client.WriteSessionFile(sessionFile, sf); err != nil {
		return fmt.Errorf("failed to write session file: %w", err)
	}

	// Create the tmux session detached. It lives in the tmux server daemon, so
	// it survives this process (and the SSH connection that launched it). The
	// DEVSESH_* env is injected so `devsesh set` works inside the session.
	env := map[string]string{
		"DEVSESH_SESSION_ID":   sessionID,
		"DEVSESH_SESSION_FILE": sessionFile,
		"DEVSESH_SESSION_NAME": sessionName,
	}
	if err := client.NewSessionDetached(sessionName, env); err != nil {
		return fmt.Errorf("failed to start tmux session: %w", err)
	}

	// Spawn the watcher: a detached (setsid) process whose lifetime tracks the
	// tmux session's, independent of this foreground process. It owns the ping
	// heartbeat, the activity signal, and the end notification. If it fails to
	// spawn we still attach -- the session just won't be monitored.
	if err := spawnWatcher(sessionID, sessionName, sessionsDir); err != nil {
		fmt.Fprintf(os.Stderr, "warning: failed to start session watcher: %v\n", err)
	}

	// Replace this process with an interactive attach. When the user detaches
	// or the SSH connection drops, only this attach dies; the tmux session and
	// its watcher keep running.
	return client.AttachSession(sessionName)
}

func resolveSessionsDir(cfg *client.ClientConfig) string {
	if cfg.SessionsDir != "" {
		return cfg.SessionsDir
	}
	if u, err := user.Current(); err == nil {
		return filepath.Join(u.HomeDir, ".devsesh", "sessions")
	}
	return ""
}

// ensureWatcher (re)starts the watcher for an already-running tmux session. It
// reuses the session's recorded DEVSESH_SESSION_ID so a revived watcher reports
// the same server-side session rather than registering a duplicate; if the
// session was created outside devsesh (no recorded ID) it mints one, writes the
// session file, and injects the DEVSESH_* env. The spawned watcher self-dedupes
// via its flock, so calling this when a watcher is already alive does nothing.
func ensureWatcher(sessionsDir, sessionName string) {
	sessionID := client.GetSessionEnv(sessionName, "DEVSESH_SESSION_ID")
	if sessionID == "" {
		sessionID = uuid.New().String()
		sessionFile := filepath.Join(sessionsDir, sessionID+".yml")
		if sf, err := client.NewSessionFile(sessionID, sessionName); err == nil {
			if err := client.WriteSessionFile(sessionFile, sf); err != nil {
				fmt.Fprintf(os.Stderr, "warning: failed to write session file: %v\n", err)
			}
		}
		client.SetSessionEnv(sessionName, "DEVSESH_SESSION_ID", sessionID)
		client.SetSessionEnv(sessionName, "DEVSESH_SESSION_FILE", sessionFile)
		client.SetSessionEnv(sessionName, "DEVSESH_SESSION_NAME", sessionName)
	}
	if err := spawnWatcher(sessionID, sessionName, sessionsDir); err != nil {
		fmt.Fprintf(os.Stderr, "warning: failed to start session watcher: %v\n", err)
	}
}

// spawnWatcher launches `devsesh watch` as a detached background process. It is
// placed in its own session (Setsid) so a SIGHUP delivered to the launching
// terminal's process group when the SSH connection closes cannot reach it. Its
// output is redirected to the session log file.
func spawnWatcher(sessionID, sessionName, sessionsDir string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}

	logPath := filepath.Join(sessionsDir, sessionID+".log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return err
	}
	defer logFile.Close()

	c := exec.Command(exe, "watch", sessionName, "--id", sessionID)
	c.Env = os.Environ()
	c.Stdin = nil // /dev/null
	c.Stdout = logFile
	c.Stderr = logFile
	c.SysProcAttr = &syscall.SysProcAttr{Setsid: true}

	if err := c.Start(); err != nil {
		return err
	}
	// Detach: do not wait on the watcher; it runs for the life of the session.
	return c.Process.Release()
}
