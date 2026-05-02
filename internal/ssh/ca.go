package ssh

import (
	"github.com/bytemare/frost"
	fdb "github.com/bytemare/frost/debug"
)

type KeyShares struct {
	PublicKey   []byte
	ServerShare []byte
	ClientShare []byte
}

// GenerateKeyShares generates the server and client shares to be used in the FROST 
// signiging ceremony.
func GenerateKeyShares() (KeyShares, error) {
	// number of signers
	var threshold uint16
	var maxSigners uint16
	threshold = 2 
	maxSigners = 2

	// Generates the key shares
	keyShares, groupVerifyingKey, _ := fdb.TrustedDealerKeygen(
		frost.Ed25519, nil, threshold, maxSigners)

	return KeyShares {
		PublicKey: groupVerifyingKey.Encode(),
		ServerShare: keyShares[0].Encode(),
		ClientShare: keyShares[1].Encode(),
	}, nil
}

// CreateTBSCertificate creates a To Be Signed certificate - an SSH certificate that will be
// signed by the two client + server shares.
func CreateTBSCertificate(publicKey []byte, principal string, serial uint64, validSeconds int) ([]byte, error) {

}
