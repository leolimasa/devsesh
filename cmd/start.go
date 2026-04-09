package cmd

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"sync"
	"time"

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
	ctx := context.Background()

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

	sessionID := uuid.New().String()
	sessionName := "Unnamed Session"
	if len(args) > 0 {
		sessionName = args[0]
	}

	sessionsDir := cfg.SessionsDir
	if sessionsDir == "" {
		homeDir, _ := user.Current()
		sessionsDir = filepath.Join(homeDir.HomeDir, ".devsesh", "sessions")
	}

	if err := os.MkdirAll(sessionsDir, 0700); err != nil {
		return fmt.Errorf("failed to create sessions directory: %w", err)
	}

	sessionFile := filepath.Join(sessionsDir, sessionID+".yml")

	sessionLogger, err := client.NewSessionLogger(sessionID, sessionsDir)
	if err != nil {
		return fmt.Errorf("failed to create session logger: %w", err)
	}
	defer sessionLogger.Close()

	sf, err := client.NewSessionFile(sessionID, sessionName)
	if err != nil {
		sessionLogger.Logger().Error("failed to create session file", "error", err)
		return fmt.Errorf("failed to create session file: %w", err)
	}

	if err := client.WriteSessionFile(sessionFile, sf); err != nil {
		sessionLogger.Logger().Error("failed to write session file", "error", err)
		return fmt.Errorf("failed to write session file: %w", err)
	}

	apiClient := client.NewAPIClient(cfg.ServerURL, cfg.JWTToken)

	if err := apiClient.NotifySessionStart(sessionID, *sf); err != nil {
		sessionLogger.Logger().Error("failed to notify session start", "error", err)
	}

	os.Setenv("DEVSESH_SESSION_ID", sessionID)
	os.Setenv("DEVSESH_SESSION_FILE", sessionFile)
	os.Setenv("DEVSESH_SESSION_NAME", sessionName)

	signalCtx, cancelSignal := context.WithCancel(ctx)

	var wg sync.WaitGroup

	// Start file watcher BEFORE starting the tmux session
	// This ensures we don't miss any file changes
	if err := client.WatchSessionFile(signalCtx, &wg, sessionFile, 500*time.Millisecond, func(sf client.SessionFile) {
		sessionLogger.Logger().Debug("file watcher callback triggered", "extra", sf.Extra)
		meta := map[string]any{
			"name":      sf.Name,
			"start_time": sf.StartTime,
			"hostname":  sf.Hostname,
			"cwd":       sf.Cwd,
		}
		for k, v := range sf.Extra {
			meta[k] = v
		}
		sessionLogger.Logger().Debug("updating session metadata", "meta", meta)
		if err := apiClient.UpdateSessionMeta(sessionID, meta); err != nil {
			sessionLogger.Logger().Error("failed to update session meta", "error", err)
		}
	}); err != nil {
		sessionLogger.Logger().Error("failed to watch session file", "error", err)
	}

	onOutput := func() {
		if err := apiClient.PingSession(sessionID); err != nil {
			sessionLogger.Logger().Error("failed to ping session", "error", err)
		}
	}

	tmuxCmd, err := client.StartSession(signalCtx, &wg, sessionID, map[string]string{
		"DEVSESH_SESSION_ID":   sessionID,
		"DEVSESH_SESSION_FILE": sessionFile,
		"DEVSESH_SESSION_NAME": sessionName,
	}, onOutput)
	if err != nil {
		sessionLogger.Logger().Error("failed to start tmux session", "error", err)
		return fmt.Errorf("failed to start tmux session: %w", err)
	}

	err = tmuxCmd.Wait()
	cancelSignal()
	wg.Wait()

	if err := apiClient.NotifySessionEnd(sessionID); err != nil {
		sessionLogger.Logger().Error("failed to notify session end", "error", err)
	}

	logFile := filepath.Join(sessionsDir, sessionID+".log")
	os.Remove(sessionFile)
	os.Remove(logFile)

	os.Unsetenv("DEVSESH_SESSION_ID")
	os.Unsetenv("DEVSESH_SESSION_FILE")
	os.Unsetenv("DEVSESH_SESSION_NAME")

	return nil
}
