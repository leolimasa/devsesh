package db

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"
)

func StartMaintenance(ctx context.Context, db *sql.DB, interval time.Duration, logger *slog.Logger) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := DeleteExpiredPairingCodes(db); err != nil {
					logger.Error("maintenance: delete expired pairing codes", "error", err)
				}
			}
		}
	}()
}

func DeleteExpiredPairingCodes(db *sql.DB) error {
	_, err := db.Exec("DELETE FROM pairing_codes WHERE datetime(expires_at) < datetime('now')")
	if err != nil {
		return fmt.Errorf("delete expired pairing codes: %w", err)
	}
	return nil
}
