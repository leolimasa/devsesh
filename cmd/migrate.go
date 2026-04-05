package cmd

import (
	"fmt"

	"github.com/spf13/cobra"

	"github.com/leolimasa/devsesh/internal/config"
	"github.com/leolimasa/devsesh/internal/db"
)

func NewMigrateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "migrate",
		Short: "Run database migrations",
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
				fmt.Println(name)
			}

			return nil
		},
	}

	return cmd
}

func init() {
	rootCmd.AddCommand(NewMigrateCmd())
}
