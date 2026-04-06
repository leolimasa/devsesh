package cmd

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/leolimasa/devsesh/internal/client"
	"github.com/spf13/cobra"
)

func NewDeleteCmd() *cobra.Command {
	var cmd = &cobra.Command{
		Use:   "delete [name]",
		Short: "Delete a session",
		Args:  cobra.RangeArgs(0, 1),
		RunE:  runDelete,
	}
	return cmd
}

func runDelete(cmd *cobra.Command, args []string) error {
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
		return fmt.Errorf("no sessions found")
	}

	if client.SessionExists(targetSession.SessionID) {
		return fmt.Errorf("cannot delete active session, use 'devsesh stop' first")
	}

	if err := os.Remove(targetPath); err != nil {
		return fmt.Errorf("failed to delete session: %w", err)
	}

	fmt.Printf("Deleted session: %s\n", targetSession.Name)
	return nil
}
