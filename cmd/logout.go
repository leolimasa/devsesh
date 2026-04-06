package cmd

import (
	"fmt"

	"github.com/leolimasa/devsesh/internal/client"
	"github.com/spf13/cobra"
)

func NewLogoutCmd() *cobra.Command {
	var cmd = &cobra.Command{
		Use:   "logout",
		Short: "Clear stored credentials",
		RunE:  runLogout,
	}
	return cmd
}

func runLogout(cmd *cobra.Command, args []string) error {
	if err := client.DeleteConfig(); err != nil {
		return fmt.Errorf("failed to delete config: %w", err)
	}

	fmt.Println("Logged out successfully")
	return nil
}
