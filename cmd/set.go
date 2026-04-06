package cmd

import (
	"fmt"
	"os"

	"github.com/leolimasa/devsesh/internal/client"
	"github.com/spf13/cobra"
)

func NewSetCmd() *cobra.Command {
	var cmd = &cobra.Command{
		Use:   "set [key] [value]",
		Short: "Set a key-value pair in the session file",
		Args:  cobra.ExactArgs(2),
		RunE:  runSet,
	}
	return cmd
}

func runSet(cmd *cobra.Command, args []string) error {
	sessionID := os.Getenv("DEVSESH_SESSION_ID")
	if sessionID == "" {
		return fmt.Errorf("not in an active devsesh session")
	}

	sessionFile := os.Getenv("DEVSESH_SESSION_FILE")
	if sessionFile == "" {
		return fmt.Errorf("session file not found")
	}

	key := args[0]
	value := args[1]

	if err := client.UpdateSessionFile(sessionFile, key, value); err != nil {
		return fmt.Errorf("failed to update session file: %w", err)
	}

	fmt.Printf("Set %s = %s\n", key, value)
	return nil
}
