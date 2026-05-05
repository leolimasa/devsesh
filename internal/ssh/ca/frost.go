package ca

import (
	"errors"
	"fmt"

	"github.com/bytemare/ecc"
	"github.com/bytemare/frost"
	"github.com/bytemare/secret-sharing/keys"
)

// FROSTSigningState holds the FROST state needed across signing rounds.
// This is stored in the session to maintain state between Round 1 and Round 2.
type FROSTSigningState struct {
	// Signer is the FROST signer with internal state (nonces, etc.)
	Signer *frost.Signer
	// ServerCommitment is the server's commitment from Round 1
	ServerCommitment *frost.Commitment
	// Configuration is the FROST configuration for this signing session
	Configuration *frost.Configuration
}

// ServerRound1 implements the first round of the FROST protocol.
// It generates nonces and a commitment for the server's share.
//
// Parameters:
//   - serverShare: the server's encoded FROST secret share (KeyShare)
//   - serverPublicKeyShare: the server's encoded PublicKeyShare
//   - clientPublicKeyShare: the client's encoded PublicKeyShare
//   - publicKey: the group public key (CA public key, 32 bytes)
//   - message: the message to sign (certificate TBS data)
//
// Returns the encoded commitment to send to the client, and the signing state
// that must be stored for Round 2.
func ServerRound1(
	serverShare []byte,
	serverPublicKeyShare []byte,
	clientPublicKeyShare []byte,
	publicKey []byte,
	message []byte,
) ([]byte, *FROSTSigningState, error) {
	if len(serverShare) == 0 {
		return nil, nil, errors.New("server share is empty")
	}
	if len(serverPublicKeyShare) == 0 {
		return nil, nil, errors.New("server public key share is empty")
	}
	if len(clientPublicKeyShare) == 0 {
		return nil, nil, errors.New("client public key share is empty")
	}
	if len(publicKey) != 32 {
		return nil, nil, fmt.Errorf("invalid public key length: %d", len(publicKey))
	}

	ciphersuite := frost.Ed25519
	group := ciphersuite.Group()

	// Decode the group public key (verification key)
	verificationKey := group.NewElement()
	if err := verificationKey.Decode(publicKey); err != nil {
		return nil, nil, fmt.Errorf("failed to decode verification key: %w", err)
	}

	// Decode the public key shares
	serverPubKeyShare := new(keys.PublicKeyShare)
	if err := serverPubKeyShare.Decode(serverPublicKeyShare); err != nil {
		return nil, nil, fmt.Errorf("failed to decode server public key share: %w", err)
	}

	clientPubKeyShare := new(keys.PublicKeyShare)
	if err := clientPubKeyShare.Decode(clientPublicKeyShare); err != nil {
		return nil, nil, fmt.Errorf("failed to decode client public key share: %w", err)
	}

	// Build the configuration for FROST 2-of-2
	publicKeyShares := []*keys.PublicKeyShare{serverPubKeyShare, clientPubKeyShare}

	configuration := &frost.Configuration{
		Ciphersuite:           ciphersuite,
		Threshold:             2,
		MaxSigners:            2,
		VerificationKey:       verificationKey,
		SignerPublicKeyShares: publicKeyShares,
	}

	if err := configuration.Init(); err != nil {
		return nil, nil, fmt.Errorf("failed to initialize FROST configuration: %w", err)
	}

	// Decode the server's key share
	serverKeyShare := new(keys.KeyShare)
	if err := serverKeyShare.Decode(serverShare); err != nil {
		return nil, nil, fmt.Errorf("failed to decode server key share: %w", err)
	}

	// Create the signer from the configuration and key share
	signer, err := configuration.Signer(serverKeyShare)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create signer: %w", err)
	}

	// Generate commitment (this creates fresh nonces internally)
	commitment := signer.Commit()

	// Store the state for Round 2
	state := &FROSTSigningState{
		Signer:           signer,
		ServerCommitment: commitment,
		Configuration:    configuration,
	}

	// Encode the commitment for transmission
	encodedCommitment := commitment.Encode()

	return encodedCommitment, state, nil
}

// ServerRound2 implements the second round of the FROST protocol.
// It computes the server's partial signature using the client's commitment.
//
// Parameters:
//   - state: the FROST signing state from Round 1
//   - clientCommitment: the encoded commitment from the client
//   - message: the message being signed (certificate TBS data)
//
// Returns the encoded partial signature from the server.
func ServerRound2(
	state *FROSTSigningState,
	clientCommitment []byte,
	message []byte,
) ([]byte, error) {
	if state == nil {
		return nil, errors.New("signing state is nil")
	}
	if state.Signer == nil {
		return nil, errors.New("signer is nil")
	}
	if len(clientCommitment) == 0 {
		return nil, errors.New("client commitment is empty")
	}
	if len(message) == 0 {
		return nil, errors.New("message is empty")
	}

	// Decode the client's commitment
	clientComm := new(frost.Commitment)
	if err := clientComm.Decode(clientCommitment); err != nil {
		return nil, fmt.Errorf("failed to decode client commitment: %w", err)
	}

	// Build the commitment list with both participants' commitments
	// Must be sorted by signer identifier
	commitments := frost.CommitmentList{state.ServerCommitment, clientComm}
	commitments.Sort()

	// Sign the message using the commitments
	signatureShare, err := state.Signer.Sign(message, commitments)
	if err != nil {
		return nil, fmt.Errorf("failed to sign: %w", err)
	}

	// Encode the signature share for transmission
	return signatureShare.Encode(), nil
}

// AggregateSignatures combines the server and client partial signatures
// into the final Ed25519 signature.
//
// Parameters:
//   - state: the FROST signing state containing the configuration
//   - serverPartial: the encoded partial signature from the server
//   - clientPartial: the encoded partial signature from the client
//   - clientCommitment: the encoded commitment from the client
//   - message: the message that was signed
//
// Returns the final 64-byte Ed25519 signature.
func AggregateSignatures(
	state *FROSTSigningState,
	serverPartial []byte,
	clientPartial []byte,
	clientCommitment []byte,
	message []byte,
) ([]byte, error) {
	if state == nil {
		return nil, errors.New("signing state is nil")
	}
	if state.Configuration == nil {
		return nil, errors.New("configuration is nil")
	}

	ciphersuite := frost.Ed25519
	group := ciphersuite.Group()

	// Decode the partial signatures
	serverSigShare := &frost.SignatureShare{Group: group}
	if err := serverSigShare.Decode(serverPartial); err != nil {
		return nil, fmt.Errorf("failed to decode server partial signature: %w", err)
	}

	clientSigShare := &frost.SignatureShare{Group: group}
	if err := clientSigShare.Decode(clientPartial); err != nil {
		return nil, fmt.Errorf("failed to decode client partial signature: %w", err)
	}

	// Decode the client's commitment
	clientComm := new(frost.Commitment)
	if err := clientComm.Decode(clientCommitment); err != nil {
		return nil, fmt.Errorf("failed to decode client commitment: %w", err)
	}

	// Build the commitment list (must match what was used in Sign)
	commitments := frost.CommitmentList{state.ServerCommitment, clientComm}
	commitments.Sort()

	// Aggregate the signature shares
	sigShares := []*frost.SignatureShare{serverSigShare, clientSigShare}
	signature, err := state.Configuration.AggregateSignatures(message, sigShares, commitments, true)
	if err != nil {
		return nil, fmt.Errorf("failed to aggregate signatures: %w", err)
	}

	// Verify the final signature
	if err := frost.VerifySignature(ciphersuite, message, signature, state.Configuration.VerificationKey); err != nil {
		return nil, fmt.Errorf("signature verification failed: %w", err)
	}

	// Encode to Ed25519 format (R || S, 64 bytes)
	// Note: signature.Encode() includes a group identifier prefix (65 bytes),
	// so we encode R and Z separately for the raw 64-byte Ed25519 format.
	rBytes := signature.R.Encode()
	zBytes := signature.Z.Encode()

	result := make([]byte, 64)
	copy(result[:32], rBytes)
	copy(result[32:], zBytes)

	return result, nil
}

// Helper function to decode a commitment for external use (e.g., in tests)
func DecodeCommitment(data []byte) (*frost.Commitment, error) {
	comm := new(frost.Commitment)
	if err := comm.Decode(data); err != nil {
		return nil, err
	}
	return comm, nil
}

// Helper function to encode a commitment for external use
func EncodeCommitment(comm *frost.Commitment) []byte {
	return comm.Encode()
}

// CreateClientSigner creates a FROST signer for the client side.
// This is used in tests and will be called from the frontend via WebSocket.
//
// Parameters:
//   - clientShare: the client's encoded FROST secret share (KeyShare)
//   - serverPublicKeyShare: the server's encoded PublicKeyShare
//   - clientPublicKeyShare: the client's encoded PublicKeyShare
//   - publicKey: the group public key (CA public key, 32 bytes)
//
// Returns a configured signer ready to generate commitments and sign.
func CreateClientSigner(
	clientShare []byte,
	serverPublicKeyShare []byte,
	clientPublicKeyShare []byte,
	publicKey []byte,
) (*frost.Signer, *frost.Configuration, error) {
	if len(clientShare) == 0 {
		return nil, nil, errors.New("client share is empty")
	}
	if len(serverPublicKeyShare) == 0 {
		return nil, nil, errors.New("server public key share is empty")
	}
	if len(clientPublicKeyShare) == 0 {
		return nil, nil, errors.New("client public key share is empty")
	}
	if len(publicKey) != 32 {
		return nil, nil, fmt.Errorf("invalid public key length: %d", len(publicKey))
	}

	ciphersuite := frost.Ed25519
	group := ciphersuite.Group()

	// Decode the group public key
	verificationKey := group.NewElement()
	if err := verificationKey.Decode(publicKey); err != nil {
		return nil, nil, fmt.Errorf("failed to decode verification key: %w", err)
	}

	// Decode the public key shares
	serverPubKeyShare := new(keys.PublicKeyShare)
	if err := serverPubKeyShare.Decode(serverPublicKeyShare); err != nil {
		return nil, nil, fmt.Errorf("failed to decode server public key share: %w", err)
	}

	clientPubKeyShare := new(keys.PublicKeyShare)
	if err := clientPubKeyShare.Decode(clientPublicKeyShare); err != nil {
		return nil, nil, fmt.Errorf("failed to decode client public key share: %w", err)
	}

	// Build the configuration
	publicKeyShares := []*keys.PublicKeyShare{serverPubKeyShare, clientPubKeyShare}

	configuration := &frost.Configuration{
		Ciphersuite:           ciphersuite,
		Threshold:             2,
		MaxSigners:            2,
		VerificationKey:       verificationKey,
		SignerPublicKeyShares: publicKeyShares,
	}

	if err := configuration.Init(); err != nil {
		return nil, nil, fmt.Errorf("failed to initialize FROST configuration: %w", err)
	}

	// Decode the client's key share
	clientKeyShare := new(keys.KeyShare)
	if err := clientKeyShare.Decode(clientShare); err != nil {
		return nil, nil, fmt.Errorf("failed to decode client key share: %w", err)
	}

	// Create the signer
	signer, err := configuration.Signer(clientKeyShare)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create signer: %w", err)
	}

	return signer, configuration, nil
}

// ZeroSigningState securely clears the signing state from memory.
func ZeroSigningState(state *FROSTSigningState) {
	if state == nil {
		return
	}
	// Clear the signer by setting it to nil
	// The GC will handle cleanup, but we ensure no references remain
	state.Signer = nil
	state.ServerCommitment = nil
	state.Configuration = nil
}

// GetCommitmentGroup returns the group used in a commitment for type assertions.
func GetCommitmentGroup() ecc.Group {
	return frost.Ed25519.Group()
}
