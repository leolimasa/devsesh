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

			slog.Info("starting server", "port", cfg.Port)
			return srv.Start()
		},
	}

	return cmd
}

func init() {
	rootCmd.AddCommand(NewServerCmd())
}
