package ca

// import (
// 	"github.com/bytemare/frost"
// )

// ServerRound1 implements the first round of the FROST protocol by generating a commitment
// and then returning it to the client
func ServerRound1(session *SigningSession, groupPublicKey []byte, tbsData []byte) ([]byte, error) {
	// TODO
	return nil, nil
}

// ServerRound2 takes in a client commitment and generates a partial signature
func ServerRound2(session *SigningSession, clientCommitment []byte) ([]byte, error) {
	// TODO
	return nil, nil
}

// AggregateSignatures joins the client and server partial signatures to get the final signature
func AggregateSignatures(session *SigningSession, serverPartial, clientPartial []byte) ([]byte, error) {
	// TODO
	return nil, nil
}
