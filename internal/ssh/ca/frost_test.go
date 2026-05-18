package ca

import (
	"crypto/ed25519"
	"crypto/rand"
	"testing"

	"github.com/bytemare/frost"
)

// TestServerRound1_GeneratesValidCommitment verifies that ServerRound1 produces
// a valid commitment from the server's key share.
func TestServerRound1_GeneratesValidCommitment(t *testing.T) {
	// Generate key shares
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	// Create a test message (simulating TBS certificate data)
	message := make([]byte, 100)
	if _, err := rand.Read(message); err != nil {
		t.Fatalf("failed to generate random message: %v", err)
	}

	// Execute Round 1
	commitment, state, err := ServerRound1(
		shares.ServerShare,
		shares.ServerVerifyingShare,
		shares.ClientVerifyingShare,
		shares.PublicKey,
		message,
	)
	if err != nil {
		t.Fatalf("ServerRound1 failed: %v", err)
	}

	// Verify commitment is not empty
	if len(commitment) == 0 {
		t.Error("commitment is empty")
	}

	// Verify state is populated
	if state == nil {
		t.Fatal("state is nil")
	}
	if state.Signer == nil {
		t.Error("state.Signer is nil")
	}
	if state.ServerCommitment == nil {
		t.Error("state.ServerCommitment is nil")
	}
	if state.Configuration == nil {
		t.Error("state.Configuration is nil")
	}

	// Verify commitment can be decoded
	decodedComm, err := DecodeCommitment(commitment)
	if err != nil {
		t.Fatalf("failed to decode commitment: %v", err)
	}
	if decodedComm.SignerID != 1 {
		t.Errorf("expected signer ID 1, got %d", decodedComm.SignerID)
	}
}

// TestServerRound1_InvalidInputs tests that ServerRound1 properly rejects invalid inputs.
func TestServerRound1_InvalidInputs(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	message := []byte("test message")

	tests := []struct {
		name                 string
		serverShare          []byte
		serverPublicKeyShare []byte
		clientPublicKeyShare []byte
		publicKey            []byte
		expectError          bool
	}{
		{
			name:                 "empty server share",
			serverShare:          []byte{},
			serverPublicKeyShare: shares.ServerVerifyingShare,
			clientPublicKeyShare: shares.ClientVerifyingShare,
			publicKey:            shares.PublicKey,
			expectError:          true,
		},
		{
			name:                 "empty server public key share",
			serverShare:          shares.ServerShare,
			serverPublicKeyShare: []byte{},
			clientPublicKeyShare: shares.ClientVerifyingShare,
			publicKey:            shares.PublicKey,
			expectError:          true,
		},
		{
			name:                 "empty client public key share",
			serverShare:          shares.ServerShare,
			serverPublicKeyShare: shares.ServerVerifyingShare,
			clientPublicKeyShare: []byte{},
			publicKey:            shares.PublicKey,
			expectError:          true,
		},
		{
			name:                 "invalid public key length",
			serverShare:          shares.ServerShare,
			serverPublicKeyShare: shares.ServerVerifyingShare,
			clientPublicKeyShare: shares.ClientVerifyingShare,
			publicKey:            []byte{1, 2, 3},
			expectError:          true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := ServerRound1(
				tc.serverShare,
				tc.serverPublicKeyShare,
				tc.clientPublicKeyShare,
				tc.publicKey,
				message,
			)
			if tc.expectError && err == nil {
				t.Error("expected error but got nil")
			}
			if !tc.expectError && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

// TestServerRound2_GeneratesValidPartialSignature verifies that ServerRound2
// produces a valid partial signature.
func TestServerRound2_GeneratesValidPartialSignature(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	message := []byte("test message for signing")

	// Server Round 1
	_, serverState, err := ServerRound1(
		shares.ServerShare,
		shares.ServerVerifyingShare,
		shares.ClientVerifyingShare,
		shares.PublicKey,
		message,
	)
	if err != nil {
		t.Fatalf("ServerRound1 failed: %v", err)
	}

	// Create client signer and generate client commitment
	clientSigner, _, err := CreateClientSigner(
		shares.ClientShare,
		shares.ServerVerifyingShare,
		shares.ClientVerifyingShare,
		shares.PublicKey,
	)
	if err != nil {
		t.Fatalf("CreateClientSigner failed: %v", err)
	}

	clientCommitment := clientSigner.Commit()
	encodedClientCommitment := clientCommitment.Encode()

	// Server Round 2
	partialSig, err := ServerRound2(serverState, encodedClientCommitment, message)
	if err != nil {
		t.Fatalf("ServerRound2 failed: %v", err)
	}

	// Verify partial signature is not empty
	if len(partialSig) == 0 {
		t.Error("partial signature is empty")
	}

	// Verify it can be decoded as a SignatureShare
	sigShare := &frost.SignatureShare{Group: frost.Ed25519.Group()}
	if err := sigShare.Decode(partialSig); err != nil {
		t.Errorf("failed to decode partial signature: %v", err)
	}
}

// TestServerRound2_InvalidInputs tests that ServerRound2 properly rejects invalid inputs.
func TestServerRound2_InvalidInputs(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	message := []byte("test message")

	// Create valid server state
	_, serverState, err := ServerRound1(
		shares.ServerShare,
		shares.ServerVerifyingShare,
		shares.ClientVerifyingShare,
		shares.PublicKey,
		message,
	)
	if err != nil {
		t.Fatalf("ServerRound1 failed: %v", err)
	}

	// Create valid client commitment
	clientSigner, _, err := CreateClientSigner(
		shares.ClientShare,
		shares.ServerVerifyingShare,
		shares.ClientVerifyingShare,
		shares.PublicKey,
	)
	if err != nil {
		t.Fatalf("CreateClientSigner failed: %v", err)
	}
	clientCommitment := clientSigner.Commit().Encode()

	tests := []struct {
		name             string
		state            *FROSTSigningState
		clientCommitment []byte
		message          []byte
		expectError      bool
	}{
		{
			name:             "nil state",
			state:            nil,
			clientCommitment: clientCommitment,
			message:          message,
			expectError:      true,
		},
		{
			name:             "empty client commitment",
			state:            serverState,
			clientCommitment: []byte{},
			message:          message,
			expectError:      true,
		},
		{
			name:             "empty message",
			state:            serverState,
			clientCommitment: clientCommitment,
			message:          []byte{},
			expectError:      true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// Need fresh state for each test since Sign() consumes nonces
			var testState *FROSTSigningState
			if tc.state != nil {
				_, testState, err = ServerRound1(
					shares.ServerShare,
					shares.ServerVerifyingShare,
					shares.ClientVerifyingShare,
					shares.PublicKey,
					message,
				)
				if err != nil {
					t.Fatalf("ServerRound1 failed: %v", err)
				}
			}

			if tc.name == "nil state" {
				testState = nil
			}

			_, err := ServerRound2(testState, tc.clientCommitment, tc.message)
			if tc.expectError && err == nil {
				t.Error("expected error but got nil")
			}
			if !tc.expectError && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

// TestAggregateSignatures_ProducesValidEd25519Signature tests the full signing flow
// and verifies the resulting signature is a valid Ed25519 signature.
func TestAggregateSignatures_ProducesValidEd25519Signature(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	message := []byte("this is a test message to sign")

	// Server Round 1
	_, serverState, err := ServerRound1(
		shares.ServerShare,
		shares.ServerVerifyingShare,
		shares.ClientVerifyingShare,
		shares.PublicKey,
		message,
	)
	if err != nil {
		t.Fatalf("ServerRound1 failed: %v", err)
	}

	// Client creates signer and generates commitment
	clientSigner, _, err := CreateClientSigner(
		shares.ClientShare,
		shares.ServerVerifyingShare,
		shares.ClientVerifyingShare,
		shares.PublicKey,
	)
	if err != nil {
		t.Fatalf("CreateClientSigner failed: %v", err)
	}

	clientCommitment := clientSigner.Commit()
	encodedClientCommitment := clientCommitment.Encode()

	// Server Round 2 - get server's partial signature
	serverPartial, err := ServerRound2(serverState, encodedClientCommitment, message)
	if err != nil {
		t.Fatalf("ServerRound2 failed: %v", err)
	}

	// Client signs to get client's partial signature
	commitments := frost.CommitmentList{serverState.ServerCommitment, clientCommitment}
	commitments.Sort()

	clientSigShare, err := clientSigner.Sign(message, commitments)
	if err != nil {
		t.Fatalf("client Sign failed: %v", err)
	}
	clientPartial := clientSigShare.Encode()

	// Aggregate signatures
	signature, err := AggregateSignatures(serverState, serverPartial, clientPartial, encodedClientCommitment, message)
	if err != nil {
		t.Fatalf("AggregateSignatures failed: %v", err)
	}

	// Verify signature is 64 bytes (Ed25519 signature size)
	if len(signature) != ed25519.SignatureSize {
		t.Errorf("signature length = %d, want %d", len(signature), ed25519.SignatureSize)
	}

	// Verify the signature using standard Ed25519
	if !ed25519.Verify(ed25519.PublicKey(shares.PublicKey), message, signature) {
		t.Error("Ed25519 signature verification failed")
	}
}

// TestFullSigningFlow_MultipleMessages tests signing multiple different messages
// to ensure fresh nonces are used each time.
func TestFullSigningFlow_MultipleMessages(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	messages := [][]byte{
		[]byte("message 1"),
		[]byte("message 2"),
		[]byte("message 3"),
	}

	signatures := make([][]byte, len(messages))

	for i, message := range messages {
		// Each message requires fresh state
		_, serverState, err := ServerRound1(
			shares.ServerShare,
			shares.ServerVerifyingShare,
			shares.ClientVerifyingShare,
			shares.PublicKey,
			message,
		)
		if err != nil {
			t.Fatalf("ServerRound1 failed for message %d: %v", i, err)
		}

		// Client creates fresh signer for each message
		clientSigner, _, err := CreateClientSigner(
			shares.ClientShare,
			shares.ServerVerifyingShare,
			shares.ClientVerifyingShare,
			shares.PublicKey,
		)
		if err != nil {
			t.Fatalf("CreateClientSigner failed for message %d: %v", i, err)
		}

		clientCommitment := clientSigner.Commit()
		encodedClientCommitment := clientCommitment.Encode()

		serverPartial, err := ServerRound2(serverState, encodedClientCommitment, message)
		if err != nil {
			t.Fatalf("ServerRound2 failed for message %d: %v", i, err)
		}

		commitments := frost.CommitmentList{serverState.ServerCommitment, clientCommitment}
		commitments.Sort()

		clientSigShare, err := clientSigner.Sign(message, commitments)
		if err != nil {
			t.Fatalf("client Sign failed for message %d: %v", i, err)
		}

		signature, err := AggregateSignatures(serverState, serverPartial, clientSigShare.Encode(), encodedClientCommitment, message)
		if err != nil {
			t.Fatalf("AggregateSignatures failed for message %d: %v", i, err)
		}

		signatures[i] = signature

		// Verify signature
		if !ed25519.Verify(ed25519.PublicKey(shares.PublicKey), message, signature) {
			t.Errorf("Ed25519 signature verification failed for message %d", i)
		}
	}

	// Verify all signatures are unique (different nonces were used)
	for i := 0; i < len(signatures); i++ {
		for j := i + 1; j < len(signatures); j++ {
			if string(signatures[i]) == string(signatures[j]) {
				t.Errorf("signatures %d and %d are identical - nonces may have been reused", i, j)
			}
		}
	}
}

// TestNoncesAreNeverReused verifies that each signing operation uses fresh nonces. [req.ey98nq]
func TestNoncesAreNeverReused(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	message := []byte("same message")

	commitments := make([][]byte, 10)

	for i := 0; i < 10; i++ {
		commitment, _, err := ServerRound1(
			shares.ServerShare,
			shares.ServerVerifyingShare,
			shares.ClientVerifyingShare,
			shares.PublicKey,
			message,
		)
		if err != nil {
			t.Fatalf("ServerRound1 failed on iteration %d: %v", i, err)
		}
		commitments[i] = commitment
	}

	// Verify all commitments are unique
	for i := 0; i < len(commitments); i++ {
		for j := i + 1; j < len(commitments); j++ {
			if string(commitments[i]) == string(commitments[j]) {
				t.Errorf("commitments %d and %d are identical - nonces were reused", i, j)
			}
		}
	}
}

// TestAggregateSignatures_InvalidInputs tests that AggregateSignatures properly rejects invalid inputs.
func TestAggregateSignatures_InvalidInputs(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	message := []byte("test message")

	// Create valid signing flow
	_, serverState, err := ServerRound1(
		shares.ServerShare,
		shares.ServerVerifyingShare,
		shares.ClientVerifyingShare,
		shares.PublicKey,
		message,
	)
	if err != nil {
		t.Fatalf("ServerRound1 failed: %v", err)
	}

	clientSigner, _, err := CreateClientSigner(
		shares.ClientShare,
		shares.ServerVerifyingShare,
		shares.ClientVerifyingShare,
		shares.PublicKey,
	)
	if err != nil {
		t.Fatalf("CreateClientSigner failed: %v", err)
	}

	clientCommitment := clientSigner.Commit()
	encodedClientCommitment := clientCommitment.Encode()

	serverPartial, err := ServerRound2(serverState, encodedClientCommitment, message)
	if err != nil {
		t.Fatalf("ServerRound2 failed: %v", err)
	}

	commitments := frost.CommitmentList{serverState.ServerCommitment, clientCommitment}
	commitments.Sort()

	clientSigShare, err := clientSigner.Sign(message, commitments)
	if err != nil {
		t.Fatalf("client Sign failed: %v", err)
	}
	clientPartial := clientSigShare.Encode()

	tests := []struct {
		name             string
		state            *FROSTSigningState
		serverPartial    []byte
		clientPartial    []byte
		clientCommitment []byte
		message          []byte
		expectError      bool
	}{
		{
			name:             "nil state",
			state:            nil,
			serverPartial:    serverPartial,
			clientPartial:    clientPartial,
			clientCommitment: encodedClientCommitment,
			message:          message,
			expectError:      true,
		},
		{
			name:             "invalid server partial",
			state:            serverState,
			serverPartial:    []byte{1, 2, 3},
			clientPartial:    clientPartial,
			clientCommitment: encodedClientCommitment,
			message:          message,
			expectError:      true,
		},
		{
			name:             "invalid client partial",
			state:            serverState,
			serverPartial:    serverPartial,
			clientPartial:    []byte{1, 2, 3},
			clientCommitment: encodedClientCommitment,
			message:          message,
			expectError:      true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := AggregateSignatures(tc.state, tc.serverPartial, tc.clientPartial, tc.clientCommitment, tc.message)
			if tc.expectError && err == nil {
				t.Error("expected error but got nil")
			}
			if !tc.expectError && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

// TestCreateClientSigner_Success tests that CreateClientSigner creates a valid signer.
func TestCreateClientSigner_Success(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	signer, config, err := CreateClientSigner(
		shares.ClientShare,
		shares.ServerVerifyingShare,
		shares.ClientVerifyingShare,
		shares.PublicKey,
	)
	if err != nil {
		t.Fatalf("CreateClientSigner failed: %v", err)
	}

	if signer == nil {
		t.Error("signer is nil")
	}
	if config == nil {
		t.Error("config is nil")
	}

	// Verify signer has correct identifier (client is participant 2)
	if signer.Identifier() != 2 {
		t.Errorf("expected signer identifier 2, got %d", signer.Identifier())
	}

	// Verify signer can generate a commitment
	commitment := signer.Commit()
	if commitment == nil {
		t.Error("commitment is nil")
	}
	if commitment.SignerID != 2 {
		t.Errorf("expected commitment signer ID 2, got %d", commitment.SignerID)
	}
}

// TestCreateClientSigner_InvalidInputs tests that CreateClientSigner rejects invalid inputs.
func TestCreateClientSigner_InvalidInputs(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	tests := []struct {
		name                 string
		clientShare          []byte
		serverPublicKeyShare []byte
		clientPublicKeyShare []byte
		publicKey            []byte
		expectError          bool
	}{
		{
			name:                 "empty client share",
			clientShare:          []byte{},
			serverPublicKeyShare: shares.ServerVerifyingShare,
			clientPublicKeyShare: shares.ClientVerifyingShare,
			publicKey:            shares.PublicKey,
			expectError:          true,
		},
		{
			name:                 "empty server public key share",
			clientShare:          shares.ClientShare,
			serverPublicKeyShare: []byte{},
			clientPublicKeyShare: shares.ClientVerifyingShare,
			publicKey:            shares.PublicKey,
			expectError:          true,
		},
		{
			name:                 "empty client public key share",
			clientShare:          shares.ClientShare,
			serverPublicKeyShare: shares.ServerVerifyingShare,
			clientPublicKeyShare: []byte{},
			publicKey:            shares.PublicKey,
			expectError:          true,
		},
		{
			name:                 "invalid public key",
			clientShare:          shares.ClientShare,
			serverPublicKeyShare: shares.ServerVerifyingShare,
			clientPublicKeyShare: shares.ClientVerifyingShare,
			publicKey:            []byte{1, 2, 3},
			expectError:          true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := CreateClientSigner(
				tc.clientShare,
				tc.serverPublicKeyShare,
				tc.clientPublicKeyShare,
				tc.publicKey,
			)
			if tc.expectError && err == nil {
				t.Error("expected error but got nil")
			}
			if !tc.expectError && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

// TestZeroSigningState tests that ZeroSigningState clears the state.
func TestZeroSigningState(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	message := []byte("test")
	_, state, err := ServerRound1(
		shares.ServerShare,
		shares.ServerVerifyingShare,
		shares.ClientVerifyingShare,
		shares.PublicKey,
		message,
	)
	if err != nil {
		t.Fatalf("ServerRound1 failed: %v", err)
	}

	// Verify state has data
	if state.Signer == nil {
		t.Error("state.Signer should not be nil before zeroing")
	}

	// Zero the state
	ZeroSigningState(state)

	// Verify state is cleared
	if state.Signer != nil {
		t.Error("state.Signer should be nil after zeroing")
	}
	if state.ServerCommitment != nil {
		t.Error("state.ServerCommitment should be nil after zeroing")
	}
	if state.Configuration != nil {
		t.Error("state.Configuration should be nil after zeroing")
	}

	// Test that zeroing nil state doesn't panic
	ZeroSigningState(nil)
}

// TestEncodeDecodeCommitment tests commitment encoding and decoding.
func TestEncodeDecodeCommitment(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	message := []byte("test")
	commitment, _, err := ServerRound1(
		shares.ServerShare,
		shares.ServerVerifyingShare,
		shares.ClientVerifyingShare,
		shares.PublicKey,
		message,
	)
	if err != nil {
		t.Fatalf("ServerRound1 failed: %v", err)
	}

	// Decode the commitment
	decoded, err := DecodeCommitment(commitment)
	if err != nil {
		t.Fatalf("DecodeCommitment failed: %v", err)
	}

	// Re-encode and verify it matches
	reEncoded := EncodeCommitment(decoded)
	if string(commitment) != string(reEncoded) {
		t.Error("re-encoded commitment doesn't match original")
	}
}

// TestSignSSHCertificate tests signing an actual SSH certificate TBS data.
func TestSignSSHCertificate(t *testing.T) {
	shares, err := GenerateKeyShares()
	if err != nil {
		t.Fatalf("GenerateKeyShares failed: %v", err)
	}

	// Generate an ephemeral user key for the certificate
	userPubKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate user key: %v", err)
	}

	// Create a TBS certificate with the user's public key
	cert, err := CreateTBSCertificate(shares.PublicKey, userPubKey, "testuser", 1, 60)
	if err != nil {
		t.Fatalf("CreateTBSCertificate failed: %v", err)
	}

	// Marshal to get the TBS bytes
	tbsData := cert.Marshal()

	// Sign the certificate using FROST
	_, serverState, err := ServerRound1(
		shares.ServerShare,
		shares.ServerVerifyingShare,
		shares.ClientVerifyingShare,
		shares.PublicKey,
		tbsData,
	)
	if err != nil {
		t.Fatalf("ServerRound1 failed: %v", err)
	}

	clientSigner, _, err := CreateClientSigner(
		shares.ClientShare,
		shares.ServerVerifyingShare,
		shares.ClientVerifyingShare,
		shares.PublicKey,
	)
	if err != nil {
		t.Fatalf("CreateClientSigner failed: %v", err)
	}

	clientCommitment := clientSigner.Commit()
	encodedClientCommitment := clientCommitment.Encode()

	serverPartial, err := ServerRound2(serverState, encodedClientCommitment, tbsData)
	if err != nil {
		t.Fatalf("ServerRound2 failed: %v", err)
	}

	commitments := frost.CommitmentList{serverState.ServerCommitment, clientCommitment}
	commitments.Sort()

	clientSigShare, err := clientSigner.Sign(tbsData, commitments)
	if err != nil {
		t.Fatalf("client Sign failed: %v", err)
	}

	signature, err := AggregateSignatures(serverState, serverPartial, clientSigShare.Encode(), encodedClientCommitment, tbsData)
	if err != nil {
		t.Fatalf("AggregateSignatures failed: %v", err)
	}

	// Verify signature is valid Ed25519
	if len(signature) != ed25519.SignatureSize {
		t.Errorf("signature length = %d, want %d", len(signature), ed25519.SignatureSize)
	}

	// Verify the signature
	if !ed25519.Verify(ed25519.PublicKey(shares.PublicKey), tbsData, signature) {
		t.Error("Ed25519 signature verification failed")
	}

	// Build the final signed certificate
	signedCert, err := BuildSignedCertificate(cert, signature, shares.PublicKey)
	if err != nil {
		t.Fatalf("BuildSignedCertificate failed: %v", err)
	}

	if len(signedCert) == 0 {
		t.Error("signed certificate is empty")
	}
}
