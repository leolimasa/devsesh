package cmd

import (
	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "devsesh",
	Short: "Centralized dev session management and monitoring",
}

func Execute() error {
	return rootCmd.Execute()
}
