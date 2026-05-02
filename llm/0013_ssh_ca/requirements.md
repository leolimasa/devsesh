# Summary

Allow devsesh to create short lived SSH certificates using an internal CA. Machines will trust the CA to grant access. The private key for the CA will never be stored. Instead, the server and the client will use a Threshold Signature Scheme to each sign their share of the certificate by using the FROST protocol.

The server will store its share in the database. The client's share will also be stored in the database, but encrypted with the **master key**. The client will then use the master key to decrypt the stored share (using the existing webauthn PRF) and then store the share in a webworker. The webworker will keep the share in memory for 30 minutes. The main browser thread will have NO access to the share. The webworker will expose an api for signing requests.

After the webworker expires and if another SSH connection is required, the user will be prompted for webauthn authentication in order to decrypt the master key again and create another webworker with the share.

Short lived SSH certificates (1 minute) will then be created everytime an SSH connection is required by performing FROST (Ed25519 2-of-2 threshold) with the webworker and the server. This certificate will be presented as an auth method by the WASM ssh module. Cert principals will be stored for each host in the hosts table.

The CA public certificate will be stored in the sqllite database. Users will be able to download the certificate using the web interface. The threshold signatures will be created every time a user is created, along with the public certificate.


## Requirements

**Libraries**

* Use @noble/curves on the javascript/typescript side to implement FROST

TODO add extra libraries here

**Webworker**

TODO add extra webworker requirements here

**Security**

* The user must be authenticated to perform all signing requests.

TODO add extra security requirements here, like nonces and other strategies

TODO -- write the rest of requirements here
