package ca

import (
	"crypto/ed25519"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func TestGenerateKeyShares(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	if len(shares.PublicKey) != 32 {
		t.Errorf("PublicKey length = %d, want 32", len(shares.PublicKey))
	}

	if len(shares.ServerShare) == 0 {
		t.Error("ServerShare is empty")
	}

	if len(shares.ClientShare) == 0 {
		t.Error("ClientShare is empty")
	}

	if string(shares.ServerShare) == string(shares.ClientShare) {
		t.Error("ServerShare and ClientShare are identical - shares should be different")
	}

	// Verify public key shares are present and valid [req.v8k2fs]
	// Public key shares are encoded PublicKeyShare structs (~103 bytes each)
	if len(shares.ServerVerifyingShare) == 0 {
		t.Error("ServerVerifyingShare is empty")
	}

	if len(shares.ClientVerifyingShare) == 0 {
		t.Error("ClientVerifyingShare is empty")
	}

	if string(shares.ServerVerifyingShare) == string(shares.ClientVerifyingShare) {
		t.Error("ServerVerifyingShare and ClientVerifyingShare are identical - should be different")
	}
}

func TestGenerateKeyShares_UniquePublicKeys(t *testing.T) {
	shares1, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	shares2, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	if string(shares1.PublicKey) == string(shares2.PublicKey) {
		t.Error("Two calls to GenerateKeyShares produced the same public key")
	}
}

func TestCreateTBSCertificate(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	cert, err := CreateTBSCertificate(shares.PublicKey, "testuser", 1, 60)
	if err != nil {
		t.Fatalf("CreateTBSCertificate failed: %v", err)
	}

	if cert == nil {
		t.Fatal("Certificate is nil")
	}

	if cert.CertType != ssh.UserCert {
		t.Errorf("CertType = %d, want %d", cert.CertType, ssh.UserCert)
	}

	if len(cert.ValidPrincipals) != 1 || cert.ValidPrincipals[0] != "testuser" {
		t.Errorf("ValidPrincipals = %v, want [testuser]", cert.ValidPrincipals)
	}

	if cert.Serial != 1 {
		t.Errorf("Serial = %d, want 1", cert.Serial)
	}

	if cert.KeyId != "devsesh" {
		t.Errorf("KeyId = %s, want devsesh", cert.KeyId)
	}

	if _, ok := cert.Extensions["permit-pty"]; !ok {
		t.Error("Missing permit-pty extension")
	}

	if _, ok := cert.Extensions["permit-port-forwarding"]; !ok {
		t.Error("Missing permit-port-forwarding extension")
	}

	if cert.SignatureKey == nil {
		t.Error("SignatureKey is nil")
	}

	if len(cert.Nonce) != 32 {
		t.Errorf("Nonce length = %d, want 32", len(cert.Nonce))
	}

	marshaled := cert.Marshal()
	if len(marshaled) == 0 {
		t.Error("Marshaled certificate is empty")
	}
}

func TestCreateTBSCertificate_InvalidPublicKey(t *testing.T) {
	_, err := CreateTBSCertificate([]byte{1, 2, 3}, "testuser", 1, 60)
	if err == nil {
		t.Error("CreateTBSCertificate should fail with invalid public key")
	}
}

func TestCreateTBSCertificate_DefaultValidity(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	cert, err := CreateTBSCertificate(shares.PublicKey, "testuser", 1, 0)
	if err != nil {
		t.Fatalf("CreateTBSCertificate failed: %v", err)
	}

	if cert == nil {
		t.Fatal("Certificate is nil")
	}

	validBefore := time.Unix(int64(cert.ValidBefore), 0)
	validAfter := time.Unix(int64(cert.ValidAfter), 0)
	duration := validBefore.Sub(validAfter)

	if duration < 55*time.Second || duration > 65*time.Second {
		t.Errorf("Validity duration = %v, want approximately 60s", duration)
	}
}

func TestCreateTBSCertificate_CustomValidity(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	cert, err := CreateTBSCertificate(shares.PublicKey, "testuser", 1, 120)
	if err != nil {
		t.Fatalf("CreateTBSCertificate failed: %v", err)
	}

	validBefore := time.Unix(int64(cert.ValidBefore), 0)
	validAfter := time.Unix(int64(cert.ValidAfter), 0)
	duration := validBefore.Sub(validAfter)

	if duration < 115*time.Second || duration > 125*time.Second {
		t.Errorf("Validity duration = %v, want approximately 120s", duration)
	}
}

func TestCreateTBSCertificate_NonceUniqueness(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	cert1, err := CreateTBSCertificate(shares.PublicKey, "testuser", 1, 60)
	if err != nil {
		t.Fatalf("CreateTBSCertificate failed: %v", err)
	}

	cert2, err := CreateTBSCertificate(shares.PublicKey, "testuser", 1, 60)
	if err != nil {
		t.Fatalf("CreateTBSCertificate failed: %v", err)
	}

	if string(cert1.Nonce) == string(cert2.Nonce) {
		t.Error("Two certificates have the same nonce")
	}
}

func TestBuildSignedCertificate(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	cert, err := CreateTBSCertificate(shares.PublicKey, "testuser", 1, 60)
	if err != nil {
		t.Fatalf("CreateTBSCertificate failed: %v", err)
	}

	signature := make([]byte, 64)
	signedBytes, err := BuildSignedCertificate(cert, signature, shares.PublicKey)
	if err != nil {
		t.Fatalf("BuildSignedCertificate failed: %v", err)
	}

	if len(signedBytes) == 0 {
		t.Error("Signed certificate is empty")
	}

	parsedKey, err := ssh.ParsePublicKey(signedBytes)
	if err != nil {
		t.Fatalf("Failed to parse signed certificate: %v", err)
	}

	parsedCert, ok := parsedKey.(*ssh.Certificate)
	if !ok {
		t.Fatal("Parsed key is not a certificate")
	}

	if parsedCert.Serial != 1 {
		t.Errorf("Parsed cert Serial = %d, want 1", parsedCert.Serial)
	}

	if len(parsedCert.ValidPrincipals) != 1 || parsedCert.ValidPrincipals[0] != "testuser" {
		t.Errorf("Parsed cert ValidPrincipals = %v, want [testuser]", parsedCert.ValidPrincipals)
	}

	if parsedCert.Signature == nil {
		t.Error("Parsed cert Signature is nil")
	}

	if parsedCert.Signature.Format != "ssh-ed25519" {
		t.Errorf("Signature Format = %s, want ssh-ed25519", parsedCert.Signature.Format)
	}

	if len(parsedCert.Signature.Blob) != 64 {
		t.Errorf("Signature Blob length = %d, want 64", len(parsedCert.Signature.Blob))
	}
}

func TestBuildSignedCertificate_NilCert(t *testing.T) {
	signature := make([]byte, 64)
	_, err := BuildSignedCertificate(nil, signature, []byte("dummy"))
	if err == nil {
		t.Error("BuildSignedCertificate should fail with nil certificate")
	}
}

func TestBuildSignedCertificate_InvalidCAPublicKey(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	cert, err := CreateTBSCertificate(shares.PublicKey, "testuser", 1, 60)
	if err != nil {
		t.Fatalf("CreateTBSCertificate failed: %v", err)
	}

	signature := make([]byte, 64)
	_, err = BuildSignedCertificate(cert, signature, []byte{1, 2, 3})
	if err == nil {
		t.Error("BuildSignedCertificate should fail with invalid CA public key")
	}
}

func TestBuildSignedCertificate_EmptySignature(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	cert, err := CreateTBSCertificate(shares.PublicKey, "testuser", 1, 60)
	if err != nil {
		t.Fatalf("CreateTBSCertificate failed: %v", err)
	}

	signedBytes, err := BuildSignedCertificate(cert, []byte{}, shares.PublicKey)
	if err != nil {
		t.Fatalf("BuildSignedCertificate failed with empty signature: %v", err)
	}

	parsedKey, err := ssh.ParsePublicKey(signedBytes)
	if err != nil {
		t.Fatalf("Failed to parse signed certificate: %v", err)
	}

	parsedCert, ok := parsedKey.(*ssh.Certificate)
	if !ok {
		t.Fatal("Parsed key is not a certificate")
	}

	if len(parsedCert.Signature.Blob) != 0 {
		t.Errorf("Signature Blob should be empty, got length %d", len(parsedCert.Signature.Blob))
	}
}

func TestCreateTBSCertificate_UserKeyIsEd25519(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	cert, err := CreateTBSCertificate(shares.PublicKey, "testuser", 1, 60)
	if err != nil {
		t.Fatalf("CreateTBSCertificate failed: %v", err)
	}

	if cert.Key.Type() != "ssh-ed25519" {
		t.Errorf("User key type = %s, want ssh-ed25519", cert.Key.Type())
	}
}

func TestCreateTBSCertificate_CAKeyIsEd25519(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	cert, err := CreateTBSCertificate(shares.PublicKey, "testuser", 1, 60)
	if err != nil {
		t.Fatalf("CreateTBSCertificate failed: %v", err)
	}

	if cert.SignatureKey.Type() != "ssh-ed25519" {
		t.Errorf("CA key type = %s, want ssh-ed25519", cert.SignatureKey.Type())
	}
}

func TestCreateTBSCertificate_ValidTimeIsReasonable(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	cert, err := CreateTBSCertificate(shares.PublicKey, "testuser", 1, 60)
	if err != nil {
		t.Fatalf("CreateTBSCertificate failed: %v", err)
	}

	now := time.Now().Unix()
	validAfter := int64(cert.ValidAfter)
	validBefore := int64(cert.ValidBefore)

	if validAfter < now-5 || validAfter > now+5 {
		t.Errorf("ValidAfter = %d, should be close to now (%d)", validAfter, now)
	}

	if validBefore < validAfter+55 || validBefore > validAfter+65 {
		t.Errorf("ValidBefore = %d, should be ~60s after ValidAfter (%d)", validBefore, validAfter)
	}
}

func TestFullCertificateRoundTrip(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	cert, err := CreateTBSCertificate(shares.PublicKey, "admin", 42, 300)
	if err != nil {
		t.Fatalf("CreateTBSCertificate failed: %v", err)
	}

	signature := make([]byte, ed25519.SignatureSize)
	signedBytes, err := BuildSignedCertificate(cert, signature, shares.PublicKey)
	if err != nil {
		t.Fatalf("BuildSignedCertificate failed: %v", err)
	}

	parsedKey, err := ssh.ParsePublicKey(signedBytes)
	if err != nil {
		t.Fatalf("ParsePublicKey failed: %v", err)
	}

	parsedCert, ok := parsedKey.(*ssh.Certificate)
	if !ok {
		t.Fatal("Parsed key is not a certificate")
	}

	if parsedCert.Serial != 42 {
		t.Errorf("Serial = %d, want 42", parsedCert.Serial)
	}

	if len(parsedCert.ValidPrincipals) != 1 || parsedCert.ValidPrincipals[0] != "admin" {
		t.Errorf("ValidPrincipals = %v, want [admin]", parsedCert.ValidPrincipals)
	}

	if parsedCert.CertType != ssh.UserCert {
		t.Errorf("CertType = %d, want %d", parsedCert.CertType, ssh.UserCert)
	}

	if parsedCert.KeyId != "devsesh" {
		t.Errorf("KeyId = %s, want devsesh", parsedCert.KeyId)
	}
}
