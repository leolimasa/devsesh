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
	rootCmd.AddCommand(NewLoginCmd())
	rootCmd.AddCommand(NewStartCmd())
	rootCmd.AddCommand(NewSetCmd())
	rootCmd.AddCommand(NewStopCmd())
	rootCmd.AddCommand(NewListCmd())
	rootCmd.AddCommand(NewAttachCmd())
	rootCmd.AddCommand(NewResumeCmd())
	rootCmd.AddCommand(NewDeleteCmd())
	rootCmd.AddCommand(NewLogoutCmd())
	return rootCmd.ExecuteContext(ctx)
}

func GetLogger(ctx context.Context) *slog.Logger {
	if logger, ok := ctx.Value("logger").(*slog.Logger); ok && logger != nil {
		return logger
	}
	return slog.Default()
}
