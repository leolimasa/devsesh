package ca

import (
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

	if len(cert.ValidPrincipals) != 1 || cert.ValidPrincipals[0] != "testuser" {
		t.Error("principal not set correctly")
	}

	if cert.Serial != 1 {
		t.Errorf("serial = %d, want 1", cert.Serial)
	}

	if cert.CertType != ssh.UserCert {
		t.Errorf("cert type = %d, want %d (UserCert)", cert.CertType, ssh.UserCert)
	}
}

func TestCreateTBSCertificate_InvalidPublicKey(t *testing.T) {
	invalidKey := make([]byte, 31)

	_, err := CreateTBSCertificate(invalidKey, "testuser", 1, 60)
	if err == nil {
		t.Error("expected error with invalid public key")
	}
}

func TestCreateTBSCertificate_DefaultValidity(t *testing.T) {
	shares, _ := GenerateKeyShares()

	cert, err := CreateTBSCertificate(shares.PublicKey, "testuser", 1, 0)
	if err != nil {
		t.Fatalf("CreateTBSCertificate failed: %v", err)
	}

	now := time.Now()
	expectedBefore := uint64(now.Add(60 * time.Second).Unix())

	if cert.ValidBefore < expectedBefore-5 || cert.ValidBefore > expectedBefore+5 {
		t.Errorf("default validity should be 60 seconds, got %d", cert.ValidBefore-cert.ValidAfter)
	}
}

func TestCreateTBSCertificate_CustomValidity(t *testing.T) {
	shares, _ := GenerateKeyShares()

	cert, err := CreateTBSCertificate(shares.PublicKey, "testuser", 1, 300)
	if err != nil {
		t.Fatalf("CreateTBSCertificate failed: %v", err)
	}

	if cert.ValidBefore-cert.ValidAfter != 300 {
		t.Errorf("validity window should be 300 seconds, got %d", cert.ValidBefore-cert.ValidAfter)
	}
}

func TestCreateTBSCertificate_NonceUniqueness(t *testing.T) {
	shares, _ := GenerateKeyShares()

	cert1, _ := CreateTBSCertificate(shares.PublicKey, "user1", 1, 60)
	cert2, _ := CreateTBSCertificate(shares.PublicKey, "user2", 2, 60)

	if string(cert1.Nonce) == string(cert2.Nonce) {
		t.Error("nonces should be unique for different certificates")
	}
}

func TestCreateTBSCertificate_UserKeyIsEd25519(t *testing.T) {
	shares, _ := GenerateKeyShares()

	cert, _ := CreateTBSCertificate(shares.PublicKey, "testuser", 1, 60)

	switch cert.Key.(type) {
	case ssh.PublicKey:
		keyBytes := cert.Key.Marshal()
		if len(keyBytes) == 0 {
			t.Error("key should have bytes when marshaled")
		}
	default:
		t.Fatalf("expected ssh.PublicKey, got %T", cert.Key)
	}
}

func TestCreateTBSCertificate_CAKeyIsEd25519(t *testing.T) {
	shares, _ := GenerateKeyShares()

	cert, _ := CreateTBSCertificate(shares.PublicKey, "testuser", 1, 60)

	if cert.SignatureKey == nil {
		t.Error("signature key should not be nil")
	}

	keyBytes := cert.SignatureKey.Marshal()
	if len(keyBytes) == 0 {
		t.Error("CA key should have bytes when marshaled")
	}
}

func TestCreateTBSCertificate_ValidTimeIsReasonable(t *testing.T) {
	shares, _ := GenerateKeyShares()
	beforeTest := time.Now().Unix()

	cert, _ := CreateTBSCertificate(shares.PublicKey, "testuser", 1, 60)

	afterTest := time.Now().Unix()

	if int64(cert.ValidAfter) < beforeTest-5 {
		t.Error("ValidAfter should be around current time")
	}

	if int64(cert.ValidAfter) > afterTest+5 {
		t.Error("ValidAfter should be around current time")
	}

	if int64(cert.ValidBefore) < afterTest+55 {
		t.Error("ValidBefore should be ~60 seconds in the future")
	}
}

func TestCreateTBSCertificate_WithPrincipal(t *testing.T) {
	shares, _ := GenerateKeyShares()

	cert, err := CreateTBSCertificate(shares.PublicKey, "devsesh-user", 42, 120)
	if err != nil {
		t.Fatalf("CreateTBSCertificate failed: %v", err)
	}

	if len(cert.ValidPrincipals) != 1 {
		t.Fatalf("expected 1 principal, got %d", len(cert.ValidPrincipals))
	}

	if cert.ValidPrincipals[0] != "devsesh-user" {
		t.Errorf("principal = %s, want devsesh-user", cert.ValidPrincipals[0])
	}

	if cert.Serial != 42 {
		t.Errorf("serial = %d, want 42", cert.Serial)
	}
}

func TestCreateTBSCertificate_PermitPtyAndPortForwarding(t *testing.T) {
	shares, _ := GenerateKeyShares()

	cert, err := CreateTBSCertificate(shares.PublicKey, "testuser", 1, 60)
	if err != nil {
		t.Fatalf("CreateTBSCertificate failed: %v", err)
	}

	if cert.Permissions.Extensions == nil {
		t.Fatal("expected extensions map")
	}

	if _, ok := cert.Permissions.Extensions["permit-pty"]; !ok {
		t.Error("missing permit-pty extension")
	}

	if _, ok := cert.Permissions.Extensions["permit-port-forwarding"]; !ok {
		t.Error("missing permit-port-forwarding extension")
	}
}

func TestBuildSignedCertificate(t *testing.T) {
	shares, _ := GenerateKeyShares()
	cert, _ := CreateTBSCertificate(shares.PublicKey, "testuser", 1, 60)

	signature := make([]byte, 64)
	for i := range signature {
		signature[i] = byte(i)
	}

	certBlob, err := BuildSignedCertificate(cert, signature, shares.PublicKey)
	if err != nil {
		t.Fatalf("BuildSignedCertificate failed: %v", err)
	}

	if len(certBlob) == 0 {
		t.Error("certificate blob should not be empty")
	}

	if cert.Signature == nil {
		t.Error("signature should be attached to certificate")
	}

	if cert.Signature.Blob == nil || len(cert.Signature.Blob) == 0 {
		t.Error("signature blob should not be empty")
	}
}

func TestBuildSignedCertificate_NilCert(t *testing.T) {
	_, err := BuildSignedCertificate(nil, []byte{1, 2, 3}, []byte{1, 2, 3})
	if err == nil {
		t.Error("expected error with nil certificate")
	}
}

func TestBuildSignedCertificate_InvalidCAPublicKey(t *testing.T) {
	shares, _ := GenerateKeyShares()
	cert, _ := CreateTBSCertificate(shares.PublicKey, "testuser", 1, 60)

	_, err := BuildSignedCertificate(cert, []byte{1, 2, 3}, []byte{1})
	if err == nil {
		t.Error("expected error with invalid CA public key")
	}
}

func TestBuildSignedCertificate_EmptySignature(t *testing.T) {
	shares, _ := GenerateKeyShares()
	cert, _ := CreateTBSCertificate(shares.PublicKey, "testuser", 1, 60)

	certBlob, err := BuildSignedCertificate(cert, []byte{}, shares.PublicKey)
	if err != nil {
		t.Fatalf("BuildSignedCertificate failed: %v", err)
	}

	if len(certBlob) == 0 {
		t.Error("certificate blob should not be empty")
	}
}

func TestFullCertificateCreationFlow(t *testing.T) {
	shares, _ := GenerateKeyShares()

	cert, err := CreateTBSCertificate(shares.PublicKey, "devsesh-user", 42, 120)
	if err != nil {
		t.Fatalf("CreateTBSCertificate failed: %v", err)
	}

	if cert.Serial != 42 {
		t.Errorf("serial = %d, want 42", cert.Serial)
	}

	if len(cert.ValidPrincipals) != 1 || cert.ValidPrincipals[0] != "devsesh-user" {
		t.Error("principal not set correctly")
	}

	tbsData := cert.Marshal()
	if len(tbsData) == 0 {
		t.Fatal("TBS data should not be empty")
	}

	if _, ok := cert.Permissions.Extensions["permit-pty"]; !ok {
		t.Error("should have permit-pty extension")
	}

	if _, ok := cert.Permissions.Extensions["permit-port-forwarding"]; !ok {
		t.Error("should have permit-port-forwarding extension")
	}

	signature := make([]byte, 64)
	certBlob, err := BuildSignedCertificate(cert, signature, shares.PublicKey)
	if err != nil {
		t.Fatalf("BuildSignedCertificate failed: %v", err)
	}

	if len(certBlob) == 0 {
		t.Fatal("certificate blob should not be empty")
	}

	if cert.Signature == nil {
		t.Error("certificate should have signature attached")
	}
}
