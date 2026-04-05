package cmd

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/leolimasa/devsesh/internal/auth"
	"github.com/leolimasa/devsesh/internal/config"
	"github.com/leolimasa/devsesh/internal/db"
	"github.com/leolimasa/devsesh/internal/server"
)

func NewServerCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "server",
		Short: "Start the devsesh HTTP server",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg := config.LoadFromEnv()

			database, err := db.Open(cfg)
			if err != nil {
				return fmt.Errorf("open database: %w", err)
			}
			defer database.Close()

			applied, err := db.RunMigrations(database)
			if err != nil {
				return fmt.Errorf("run migrations: %w", err)
			}
			for _, name := range applied {
				slog.Info("applied migration", "name", name)
			}

			secret, err := db.ResolveJWTSecret(database, cfg.JWTSecret)
			if err != nil {
				return fmt.Errorf("resolve jwt secret: %w", err)
			}
			cfg.JWTSecret = secret

			challengeStore := auth.NewChallengeStore(5 * time.Minute)

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			sigCh := make(chan os.Signal, 1)
			signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
			go func() {
				<-sigCh
				slog.Info("shutting down...")
				cancel()
			}()

			db.StartMaintenance(ctx, database, cfg.MaintenanceInterval, cmd.Context().Value("logger").(*slog.Logger))

			srv, err := server.New(cfg, database, challengeStore)
			if err != nil {
				return fmt.Errorf("create server: %w", err)
			}

			errCh := make(chan error, 1)
			go func() {
				slog.Info("starting server", "port", cfg.Port)
				errCh <- srv.Start()
			}()

			select {
			case <-ctx.Done():
				shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer shutdownCancel()
				slog.Info("shutting down server...")
				if err := srv.Shutdown(shutdownCtx); err != nil {
					return fmt.Errorf("server shutdown: %w", err)
				}
				return nil
			case err := <-errCh:
				return fmt.Errorf("server error: %w", err)
			}
		},
	}

	return cmd
}

func init() {
	rootCmd.AddCommand(NewServerCmd())
}
