package main

import (
	"log/slog"
	"os"

	"github.com/leolimasa/devsesh/cmd"
)

var logger *slog.Logger

func main() {
	logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	if err := cmd.ExecuteWithLogger(logger); err != nil {
		logger.Error("command failed", "error", err)
		os.Exit(1)
	}
}
