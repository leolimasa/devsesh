package db

import (
	"database/sql"
	"fmt"
	"sort"
	"strings"

	"github.com/leolimasa/devsesh/sql"
)

func RunMigrations(db *sql.DB) ([]string, error) {
	if err := ensureMigrationsTable(db); err != nil {
		return nil, fmt.Errorf("ensure migrations table: %w", err)
	}

	entries, err := sqlmigrations.FS.ReadDir(".")
	if err != nil {
		return nil, fmt.Errorf("read migration directory: %w", err)
	}

	var files []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".sql") {
			files = append(files, e.Name())
		}
	}
	sort.Strings(files)

	applied, err := getAppliedMigrations(db)
	if err != nil {
		return nil, fmt.Errorf("get applied migrations: %w", err)
	}

	appliedSet := make(map[string]bool)
	for _, name := range applied {
		appliedSet[name] = true
	}

	var appliedNow []string
	for _, f := range files {
		if appliedSet[f] {
			continue
		}

		content, err := sqlmigrations.FS.ReadFile(f)
		if err != nil {
			return nil, fmt.Errorf("read migration file %s: %w", f, err)
		}

		tx, err := db.Begin()
		if err != nil {
			return nil, fmt.Errorf("begin transaction for %s: %w", f, err)
		}

		if _, err := tx.Exec(string(content)); err != nil {
			tx.Rollback()
			return nil, fmt.Errorf("execute migration %s: %w", f, err)
		}

		if _, err := tx.Exec("INSERT INTO migrations (name) VALUES (?)", f); err != nil {
			tx.Rollback()
			return nil, fmt.Errorf("record migration %s: %w", f, err)
		}

		if err := tx.Commit(); err != nil {
			return nil, fmt.Errorf("commit migration %s: %w", f, err)
		}

		appliedNow = append(appliedNow, f)
	}

	return appliedNow, nil
}

func ensureMigrationsTable(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS migrations (
			id INTEGER PRIMARY KEY,
			name TEXT NOT NULL UNIQUE,
			applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	return err
}

func getAppliedMigrations(db *sql.DB) ([]string, error) {
	rows, err := db.Query("SELECT name FROM migrations ORDER BY name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, rows.Err()
}
