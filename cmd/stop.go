package cmd

import (
	"fmt"
	"os"

	"github.com/leolimasa/devsesh/internal/client"
	"github.com/spf13/cobra"
)

func NewStopCmd() *cobra.Command {
	var cmd = &cobra.Command{
		Use:   "stop",
		Short: "Gracefully stop the current session",
		RunE:  runStop,
	}
	return cmd
}

func runStop(cmd *cobra.Command, args []string) error {
	sessionID := os.Getenv("DEVSESH_SESSION_ID")
	if sessionID == "" {
		return fmt.Errorf("not in an active devsesh session")
	}

	if err := client.KillSession(sessionID); err != nil {
		return fmt.Errorf("failed to stop session: %w", err)
	}

	fmt.Println("Session stopped")
	return nil
}
