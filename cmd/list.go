package cmd

import (
	"fmt"
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

// sessionLivenessWindow is how recently a session must have pinged the server to
// count as live. The watcher pings every 5s; a few missed pings tolerate jitter
// or a briefly-slow network without flapping the status.
const sessionLivenessWindow = 30 * time.Second

func runList(cmd *cobra.Command, args []string) error {
	cfg, err := client.LoadConfig()
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}
	if cfg.ServerURL == "" || cfg.JWTToken == "" {
		return fmt.Errorf("not logged in. Please run 'devsesh login <url>' first")
	}

	apiClient := client.NewAPIClient(cfg.ServerURL, cfg.JWTToken)
	sessions, err := apiClient.ListSessions()
	if err != nil {
		return fmt.Errorf("failed to list sessions: %w", err)
	}

	if len(sessions) == 0 {
		fmt.Println("No sessions found")
		return nil
	}

	fmt.Printf("%-40s %-20s %-16s %-20s %-10s\n", "SESSION ID", "NAME", "HOST", "START TIME", "STATUS")
	fmt.Println("──────────────────────────────────────────────────────────────────────────────────────────────────────────")

	for _, s := range sessions {
		host := ""
		if s.Host != nil {
			host = s.Host.Label
			if host == "" {
				host = s.Host.Hostname
			}
		}

		fmt.Printf("%-40s %-20s %-16s %-20s %-10s\n",
			truncate(s.ID, 40),
			truncate(s.Name, 20),
			truncate(host, 16),
			s.StartedAt.Local().Format(time.Stamp),
			sessionStatus(s))
	}

	return nil
}

// sessionStatus maps a server session to a human-readable liveness label.
func sessionStatus(s client.ServerSession) string {
	if s.EndedAt != nil {
		return "ended"
	}
	if s.LastPingAt != nil && time.Since(*s.LastPingAt) < sessionLivenessWindow {
		return "active"
	}
	return "inactive"
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
