package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/spf13/cobra"
)

var logger *slog.Logger

func main() {
	logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	ctx := context.WithValue(context.Background(), "logger", logger)
	rootCmd.SetContext(ctx)

	if err := rootCmd.ExecuteContext(ctx); err != nil {
		logger.Error("command failed", "error", err)
		os.Exit(1)
	}
}

var rootCmd = &cobra.Command{
	Use:   "devsesh",
	Short: "Centralized dev session management and monitoring",
}

func Execute() error {
	return rootCmd.Execute()
}
