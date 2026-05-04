# Summary

Allow devsesh to create short lived SSH certificates using an internal CA. Machines will trust the CA to grant access. The private key for the CA will never be stored. Instead, the server and the client will use a Threshold Signature Scheme to each sign their share of the certificate by using the FROST protocol.

The server will store its share in the database. The client's share will also be stored in the database, but encrypted with the **master key**. The client will then use the master key to decrypt the stored share (using the existing webauthn PRF) and then store the share in a webworker. The webworker will keep the share in memory for 30 minutes. The main browser thread will have NO access to the share. The webworker will expose an api for signing requests.

After the webworker expires and if another SSH connection is required, the user will be prompted for webauthn authentication in order to decrypt the master key again and create another webworker with the share.

Short lived SSH certificates (1 minute) will then be created everytime an SSH connection is required by performing FROST (Ed25519 2-of-2 threshold) with the webworker and the server. This certificate will be presented as an auth method by the WASM ssh module. Cert principals will be stored for each host in the hosts table.

The CA public certificate will be stored in the sqllite database. Users will be able to download the certificate using the web interface. The threshold signatures will be created every time a user is created, along with the public certificate.


## Requirements

### Libraries

**JavaScript/TypeScript**

* `@noble/curves` - FROST Ed25519 threshold signatures [req.0xpudr]
* `@noble/hashes` - SHA-512, HKDF [req.jap7ew]

**Go**

* `taurushq-io/multi-party-sig` - FROST Ed25519 threshold signatures [req.c02qrs]
* `golang.org/x/crypto/ssh` - SSH certificate generation [req.1mujak]

### Webworker

* Main thread must NOT have access to the decrypted FROST share [req.qwdm15]
* Webworker holds the share in memory only (never persisted to disk/IndexedDB) [req.gvq1jj]
* Webworker exposes postMessage API for: init, round1, round2, status, terminate [req.xxu1i4]
* Share must be zeroed from memory on terminate [req.obmwbr]
* Inactivity timeout: 30 minutes (configurable) [req.2k5is9]

### Security

* User must be authenticated (JWT) to perform signing requests [req.o9pemq]
* User must own the host being accessed [req.hs8zrm]
* WebAuthn PRF authentication required to unlock the client share [req.qogtvx]
* Fresh cryptographic nonces for every signing session (never reuse) [req.ey98nq]
* Signing sessions expire after 60 seconds [req.tie4zq]
* Session IDs are single-use UUIDs [req.1i6osk]
* Rate limit: max 10 certificates per minute per user [req.zp9nw1]
* Certificates valid for 60 seconds max (configurable up to 5 minutes) [req.u72wa2]
* Audit log all certificate issuance and failed attempts [req.xj6amw]

### Certificates

* Type: `ssh-ed25519-cert-v01@openssh.com` user certificates [req.umkdzs]
* Principals: configured per-host in hosts table [req.zbf0si]
* Extensions: `permit-pty`, `permit-port-forwarding` [req.2x3a51]
* Serial numbers: monotonically increasing per user [req.56dvhi]

### User Interface

* Users can download CA public key in OpenSSH format [req.23hk63]
* Display CA fingerprint (SHA256) [req.0lpwy4]
* Show webworker status indicator when active (with countdown) [req.35jehk]
* Prompt for WebAuthn when SSH connection requires inactive webworker [req.4oofln]
* Host edit form includes SSH principal field [req.w51l9k]

### FROST Key Storage

* Server stores both verification shares (public key shares) for FROST configuration [req.v8k2fs]
* Verification shares are public information needed to set up FROST signing sessions
* Each participant's verification share is extracted during key generation and stored separately

### Signing Flow

* Signing uses WebSocket for real-time two-round FROST protocol [req.5kl1v5]
* Client initiates by requesting a certificate for a specific host [req.3j5hnq]
* Server builds the certificate-to-be-signed (TBS) data and creates a signing session [req.wdalb2]
* Round 1: Both parties generate nonces and exchange commitments [req.5xcc6i]
* Round 2: Both parties compute partial signatures using the exchanged commitments [req.o3lf24]
* Server aggregates partial signatures into final Ed25519 signature [req.dzym7r]
* Server returns the complete signed certificate to client [req.jki5t0]
* If either party fails or times out, the session is aborted (no partial state retained) [req.3zw1de]
* Client can retry immediately with a new session on failure [req.9e2ob6]

## Testing

* Change the existing SSH docker container to accept an SSH CA if one is provided [req.17dfwk]
* Change the existing container to contain a "flag" file with a some static content. [req.cu1f0k]
* Create a new integration test that: [req.jc1drs]
   * Uses the existing webauthn + PRF workflow to create a new user, leading to the creation of the SSH CA public key [req.ancud7]
   * Spings up the SSH test docker container which will accept the SSH CA public key created above as authentication [req.vz2fg3]
   * Create a new host that points to the running docker container with a valid principal. DO NOT SET A PASSWORD, so that it uses the CA public key. [req.4whcli]
   * Uses the **web interface** to connect to the docker host [req.twjlw7]
   * Execute `cat FLAG_FILE` on the xterm that is connected to the docker machine and validate that the output matches the created flag file [req.xbft6g]
