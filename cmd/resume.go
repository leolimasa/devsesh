package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/leolimasa/devsesh/internal/client"
	"github.com/spf13/cobra"
)

func NewResumeCmd() *cobra.Command {
	var cmd = &cobra.Command{
		Use:   "resume [name]",
		Short: "Resume an inactive session",
		Args:  cobra.RangeArgs(0, 1),
		RunE:  runResume,
	}
	return cmd
}

func runResume(cmd *cobra.Command, args []string) error {
	cfg, err := client.LoadConfig()
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}

	sessionsDir := cfg.SessionsDir
	if sessionsDir == "" {
		homeDir, _ := os.UserHomeDir()
		sessionsDir = filepath.Join(homeDir, ".devsesh", "sessions")
	}

	var targetSession *client.SessionFile
	var targetPath string

	entries, err := os.ReadDir(sessionsDir)
	if err != nil {
		return fmt.Errorf("no sessions found")
	}

	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".yml" {
			continue
		}

		sessionFile := filepath.Join(sessionsDir, entry.Name())
		sf, err := client.ReadSessionFile(sessionFile)
		if err != nil {
			continue
		}

		if client.SessionExists(sf.SessionID) {
			continue
		}

		if len(args) > 0 && sf.Name == args[0] {
			targetSession = sf
			targetPath = sessionFile
			break
		}

		if targetSession == nil {
			targetSession = sf
			targetPath = sessionFile
		}
	}

	if targetSession == nil {
		return fmt.Errorf("no inactive sessions found")
	}

	sf := *targetSession
	sf.StartTime = time.Now()

	if err := client.WriteSessionFile(targetPath, &sf); err != nil {
		return fmt.Errorf("failed to update session file: %w", err)
	}

	fmt.Printf("Resuming session: %s\n", sf.Name)
	return nil
}
