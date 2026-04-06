package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/leolimasa/devsesh/internal/client"
	"github.com/spf13/cobra"
)

func NewListCmd() *cobra.Command {
	var cmd = &cobra.Command{
		Use:   "list",
		Short: "List all sessions",
		RunE:  runList,
	}
	return cmd
}

func runList(cmd *cobra.Command, args []string) error {
	cfg, err := client.LoadConfig()
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}

	sessionsDir := cfg.SessionsDir
	if sessionsDir == "" {
		homeDir, _ := os.UserHomeDir()
		sessionsDir = filepath.Join(homeDir, ".devsesh", "sessions")
	}

	entries, err := os.ReadDir(sessionsDir)
	if err != nil {
		fmt.Println("No sessions found")
		return nil
	}

	fmt.Printf("%-40s %-20s %-20s %-10s\n", "SESSION ID", "NAME", "START TIME", "STATUS")
	fmt.Println("────────────────────────────────────────────────────────────────────────────────")

	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".yml" {
			continue
		}

		sessionFile := filepath.Join(sessionsDir, entry.Name())
		sf, err := client.ReadSessionFile(sessionFile)
		if err != nil {
			continue
		}

		status := "inactive"
		if client.SessionExists(sf.SessionID) {
			status = "active"
		}

		fmt.Printf("%-40s %-20s %-20s %-10s\n",
			sf.SessionID[:min(len(sf.SessionID), 40)],
			sf.Name[:min(len(sf.Name), 20)],
			sf.StartTime.Format(time.Stamp),
			status)
	}

	return nil
}
