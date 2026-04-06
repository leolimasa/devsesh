package cmd

import (
	"fmt"

	"github.com/leolimasa/devsesh/internal/client"
	"github.com/spf13/cobra"
)

func NewAttachCmd() *cobra.Command {
	var cmd = &cobra.Command{
		Use:   "attach [name]",
		Short: "Attach to an existing session",
		Args:  cobra.RangeArgs(0, 1),
		RunE:  runAttach,
	}
	return cmd
}

func runAttach(cmd *cobra.Command, args []string) error {
	var sessionID string

	if len(args) > 0 {
		sessionID = args[0]
	} else {
		sessions, err := client.ListSessions()
		if err != nil {
			return fmt.Errorf("failed to list sessions: %w", err)
		}
		if len(sessions) == 0 {
			return fmt.Errorf("no sessions available")
		}
		fmt.Println("Available sessions:")
		for i, s := range sessions {
			fmt.Printf("%d. %s\n", i+1, s)
		}
		return nil
	}

	if err := client.AttachSession(sessionID); err != nil {
		return fmt.Errorf("failed to attach to session: %w", err)
	}

	return nil
}
