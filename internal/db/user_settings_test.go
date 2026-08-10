package db

import "testing"

func TestUserSettingsDefaultsAndUpsert(t *testing.T) {
	db := openTestDB(t)
	if _, err := RunMigrations(db); err != nil {
		t.Fatalf("migrations: %v", err)
	}
	userID, err := CreateUser(db, "settings@example.com")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	// No row yet → default theme, no error.
	s, err := GetUserSettings(db, userID)
	if err != nil {
		t.Fatalf("get default settings: %v", err)
	}
	if s.Theme != DefaultTheme {
		t.Errorf("default theme = %q, want %q", s.Theme, DefaultTheme)
	}

	// Upsert (insert) then read back.
	if _, err := UpsertUserSettings(db, UserSettings{UserID: userID, Theme: "one-dark"}); err != nil {
		t.Fatalf("upsert insert: %v", err)
	}
	s, _ = GetUserSettings(db, userID)
	if s.Theme != "one-dark" {
		t.Errorf("after insert theme = %q, want one-dark", s.Theme)
	}

	// Upsert (update) the existing row.
	if _, err := UpsertUserSettings(db, UserSettings{UserID: userID, Theme: "dark-blue"}); err != nil {
		t.Fatalf("upsert update: %v", err)
	}
	s, _ = GetUserSettings(db, userID)
	if s.Theme != "dark-blue" {
		t.Errorf("after update theme = %q, want dark-blue", s.Theme)
	}
}
