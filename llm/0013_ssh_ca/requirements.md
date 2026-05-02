# Summary

Allow devsesh to create short lived SSH certificates using an internal CA. Machines will trust the CA to grant access. The private key for the CA will never be stored. Instead, the server and the client will use a Threshold Signature Scheme to each sign their share of the certificate by using the FROST protocol.

The server will store its share in the database. The client's share will also be stored in the database, but encrypted with the **master key**. The client will then use the master key to decrypt the stored share (using the existing webauthn PRF) and then store the share in a webworker. The webworker will keep the share in memory for 30 minutes. The main browser thread will have NO access to the share. The webworker will expose an api for signing requests.

After the webworker expires and if another SSH connection is required, the user will be prompted for webauthn authentication in order to decrypt the master key again and create another webworker with the share.

Short lived SSH certificates (1 minute) will then be created everytime an SSH connection is required by performing FROST (Ed25519 2-of-2 threshold) with the webworker and the server. This certificate will be presented as an auth method by the WASM ssh module. Cert principals will be stored for each host in the hosts table.

The CA public certificate will be stored in the sqllite database. Users will be able to download the certificate using the web interface. The threshold signatures will be created every time a user is created, along with the public certificate.


## Requirements

### Libraries

**JavaScript/TypeScript**

* `@noble/curves` - FROST Ed25519 threshold signatures
* `@noble/hashes` - SHA-512, HKDF

**Go**

* `taurushq-io/multi-party-sig` - FROST Ed25519 threshold signatures
* `golang.org/x/crypto/ssh` - SSH certificate generation

### Webworker

* Main thread must NOT have access to the decrypted FROST share
* Webworker holds the share in memory only (never persisted to disk/IndexedDB)
* Webworker exposes postMessage API for: init, round1, round2, status, terminate
* Share must be zeroed from memory on terminate
* Inactivity timeout: 30 minutes (configurable)

### Security

* User must be authenticated (JWT) to perform signing requests
* User must own the host being accessed
* WebAuthn PRF authentication required to unlock the client share
* Fresh cryptographic nonces for every signing session (never reuse)
* Signing sessions expire after 60 seconds
* Session IDs are single-use UUIDs
* Rate limit: max 10 certificates per minute per user
* Certificates valid for 60 seconds max (configurable up to 5 minutes)
* Audit log all certificate issuance and failed attempts

### Certificates

* Type: `ssh-ed25519-cert-v01@openssh.com` user certificates
* Principals: configured per-host in hosts table
* Extensions: `permit-pty`, `permit-port-forwarding`
* Serial numbers: monotonically increasing per user

### User Interface

* Users can download CA public key in OpenSSH format
* Display CA fingerprint (SHA256)
* Show webworker status indicator when active (with countdown)
* Prompt for WebAuthn when SSH connection requires inactive webworker
* Host edit form includes SSH principal field

### Signing Flow

* Signing uses WebSocket for real-time two-round FROST protocol
* Client initiates by requesting a certificate for a specific host
* Server builds the certificate-to-be-signed (TBS) data and creates a signing session
* Round 1: Both parties generate nonces and exchange commitments
* Round 2: Both parties compute partial signatures using the exchanged commitments
* Server aggregates partial signatures into final Ed25519 signature
* Server returns the complete signed certificate to client
* If either party fails or times out, the session is aborted (no partial state retained)
* Client can retry immediately with a new session on failure

## Testing

* Change the existing SSH docker container to accept an SSH CA if one is provided
* Change the existing container to contain a "flag" file with a some static content.
* Create a new integration test that:
   * Uses the existing webauthn + PRF workflow to create a new user, leading to the creation of the SSH CA public key
   * Spings up the SSH test docker container which will accept the SSH CA public key created above as authentication
   * Create a new host that points to the running docker container with a valid principal. DO NOT SET A PASSWORD, so that it uses the CA public key.
   * Uses the **web interface** to connect to the docker host
   * Execute `cat FLAG_FILE` on the xterm that is connected to the docker machine and validate that the output matches the created flag file
