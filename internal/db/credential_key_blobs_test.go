package db

import (
	"bytes"
	"testing"
)

func TestCredentialKeyBlobs(t *testing.T) {
	db := openTestDB(t)
	if _, err := RunMigrations(db); err != nil {
		t.Fatalf("migrations: %v", err)
	}
	userID, err := CreateUser(db, "blobs@example.com")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	cred := WebAuthnCredential{ID: "cred-1", UserID: userID, PublicKey: []byte{1, 2, 3}}
	if err := SaveCredential(db, cred); err != nil {
		t.Fatalf("save credential: %v", err)
	}

	// Empty to start.
	blobs, err := GetCredentialKeyBlobs(db, cred.ID)
	if err != nil {
		t.Fatalf("get blobs: %v", err)
	}
	if len(blobs) != 0 {
		t.Fatalf("expected 0 blobs, got %d", len(blobs))
	}

	blobA := []byte("device-A-wrapped-master-key")
	blobB := []byte("device-B-wrapped-master-key")

	if err := AddCredentialKeyBlob(db, cred.ID, blobA); err != nil {
		t.Fatalf("add blobA: %v", err)
	}
	if err := AddCredentialKeyBlob(db, cred.ID, blobB); err != nil {
		t.Fatalf("add blobB: %v", err)
	}
	// Dedupe: adding blobA again is a no-op.
	if err := AddCredentialKeyBlob(db, cred.ID, blobA); err != nil {
		t.Fatalf("add blobA again: %v", err)
	}

	blobs, err = GetCredentialKeyBlobs(db, cred.ID)
	if err != nil {
		t.Fatalf("get blobs: %v", err)
	}
	if len(blobs) != 2 {
		t.Fatalf("expected 2 blobs after dedupe, got %d", len(blobs))
	}
	// Newest first (blobB added last).
	if !bytes.Equal(blobs[0], blobB) || !bytes.Equal(blobs[1], blobA) {
		t.Fatalf("blobs not newest-first: %q, %q", blobs[0], blobs[1])
	}

	// Blobs are scoped to the credential.
	other := WebAuthnCredential{ID: "cred-2", UserID: userID, PublicKey: []byte{4}}
	if err := SaveCredential(db, other); err != nil {
		t.Fatalf("save other credential: %v", err)
	}
	otherBlobs, err := GetCredentialKeyBlobs(db, other.ID)
	if err != nil {
		t.Fatalf("get other blobs: %v", err)
	}
	if len(otherBlobs) != 0 {
		t.Fatalf("expected 0 blobs for other credential, got %d", len(otherBlobs))
	}
}
