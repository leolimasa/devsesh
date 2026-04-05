package cmd

import (
	"context"
	"log/slog"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "devsesh",
	Short: "Centralized dev session management and monitoring",
}

func Execute() error {
	return rootCmd.Execute()
}

func ExecuteWithLogger(logger *slog.Logger) error {
	ctx := context.WithValue(context.Background(), "logger", logger)
	return rootCmd.ExecuteContext(ctx)
}
