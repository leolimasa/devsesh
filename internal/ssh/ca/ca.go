package ca

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/bytemare/frost"
	fdb "github.com/bytemare/frost/debug"
	"golang.org/x/crypto/ssh"
)

type KeyShares struct {
	PublicKey            []byte
	ServerShare          []byte
	ClientShare          []byte
	ServerVerifyingShare []byte
	ClientVerifyingShare []byte
}

// GenerateKeyShares generates the server and client shares to be used in the FROST
// signing ceremony.
//
// Uses FROST Ed25519 with a 2-of-2 threshold scheme, producing:
//   - PublicKey: the group public key (32 bytes) - used as the CA public key
//   - ServerShare: the server's secret share - stored in the database
//   - ClientShare: the client's secret share - encrypted and stored in the database
//   - ServerPublicKeyShare: the server's encoded PublicKeyShare (for FROST Configuration)
//   - ClientPublicKeyShare: the client's encoded PublicKeyShare (for FROST Configuration)
//
// The PublicKeyShare includes the participant ID, public key element, and VSS commitment.
// These are needed to set up the FROST Configuration during signing sessions.
func GenerateKeyShares() (KeyShares, error) {
	var threshold uint16 = 2
	var maxSigners uint16 = 2

	// Generates the key shares using trusted dealer (simpler than DKG for 2-of-2).
	// Note: The third return value (VSS commitment) is not used directly;
	// we extract public key shares from the key shares themselves.
	keyShares, groupVerifyingKey, _ := fdb.TrustedDealerKeygen(
		frost.Ed25519, nil, threshold, maxSigners)

	// Encode public key - use Encode() for Ed25519 format
	publicKey := groupVerifyingKey.Encode()
	// Ed25519 points are 32 bytes when compressed
	if len(publicKey) != 32 {
		return KeyShares{}, fmt.Errorf("invalid public key length: %d", len(publicKey))
	}

	// Verify we got two key shares
	if len(keyShares) != 2 {
		return KeyShares{}, fmt.Errorf("expected 2 key shares, got %d", len(keyShares))
	}

	// Extract public key shares from the key shares
	// These include the participant ID, public key, and VSS commitment
	serverPublicKeyShare := keyShares[0].Public().Encode()
	clientPublicKeyShare := keyShares[1].Public().Encode()

	return KeyShares{
		PublicKey:            publicKey,
		ServerShare:          keyShares[0].Encode(),
		ClientShare:          keyShares[1].Encode(),
		ServerVerifyingShare: serverPublicKeyShare,
		ClientVerifyingShare: clientPublicKeyShare,
	}, nil
}

// CreateTBSCertificate creates a To Be Signed certificate - an SSH certificate that will be
// signed by the client and server shares.
//
// The certificate is built with:
//   - Random nonce for signature uniqueness
//   - Type: user certificate (CertType: ssh.UserCert)
//   - Serial: monotonically increasing per user
//   - ValidPrincipals: from host config (e.g., username)
//   - ValidAfter/ValidBefore: validity window (default 60s, max 300s)
//   - Extensions: permit-pty, permit-port-forwarding
//
// Returns the certificate struct ready for FROST threshold signing.
func CreateTBSCertificate(publicKey []byte, principal string, serial uint64, validSeconds int) (*ssh.Certificate, error) {
	if validSeconds <= 0 {
		validSeconds = 60
	}

	// Validate FROST public key is 32-byte Ed25519.
	if len(publicKey) != ed25519.PublicKeySize {
		return nil, errors.New("invalid public key length")
	}

	// Create CA public key in SSH wire format
	// publicKey is the CA's public key (FROST group public key)
	caWireKey := ssh.Marshal(struct {
		Name string
		Key  []byte
	}{
		Name: "ssh-ed25519",
		Key:  publicKey,
	})

	caPubKey, err := ssh.ParsePublicKey(caWireKey)
	if err != nil {
		return nil, fmt.Errorf("failed to parse CA public key: %w", err)
	}

	// Generate a temporary user key pair for the certificate
	// In production, this would be the user's actual public key
	userPubKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to generate user key: %w", err)
	}

	userWireKey := ssh.Marshal(struct {
		Name string
		Key  []byte
	}{
		Name: "ssh-ed25519",
		Key:  userPubKey,
	})

	userSShPubKey, err := ssh.ParsePublicKey(userWireKey)
	if err != nil {
		return nil, fmt.Errorf("failed to parse user public key: %w", err)
	}

	// Calculate validity window.
	now := time.Now()
	validAfter := uint64(now.Unix())
	validBefore := uint64(now.Add(time.Duration(validSeconds) * time.Second).Unix())

	// Generate random nonce for certificate signature.
	nonce := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	cert := &ssh.Certificate{
		Nonce:           nonce,
		Key:             userSShPubKey,
		Serial:          serial,
		CertType:        ssh.UserCert,
		KeyId:           "devsesh",
		ValidPrincipals: []string{principal},
		ValidAfter:      validAfter,
		ValidBefore:     validBefore,
		SignatureKey:    caPubKey,
		Permissions: ssh.Permissions{
			Extensions: map[string]string{
				"permit-pty":             "",
				"permit-port-forwarding": "",
			},
		},
	}

	return cert, nil
}

// BuildSignedCertificate signs the cert with the AGGREGATE signature and returns
// the signed certificate in OpenSSH wire format.
func BuildSignedCertificate(cert *ssh.Certificate, signature []byte, caPublicKey []byte) ([]byte, error) {
	if cert == nil {
		return nil, errors.New("certificate is nil")
	}
	// Set the CA public key as the signature key
	caWireKey := ssh.Marshal(struct {
		Name string
		Key  []byte
	}{
		Name: "ssh-ed25519",
		Key:  caPublicKey,
	})

	caPubKey, err := ssh.ParsePublicKey(caWireKey)
	if err != nil {
		return nil, fmt.Errorf("failed to parse CA public key: %w", err)
	}
	cert.SignatureKey = caPubKey

	// Create SSH signature from raw Ed25519 signature bytes
	sig := &ssh.Signature{
		Format: "ssh-ed25519",
		Blob:   signature,
	}
	cert.Signature = sig

	return cert.Marshal(), nil
}
