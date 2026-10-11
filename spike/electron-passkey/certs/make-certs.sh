#!/bin/sh
# Throwaway CA for the spike. The CA can only sign names under $HOST (name constraint),
# so trusting it on the Mac does not let it vouch for any other site.
set -e
HOST=${1:-devsesh-spike.example.net}
cd "$(dirname "$0")"
cat > ca.cnf <<EOC
[req]
distinguished_name=dn
x509_extensions=v3_ca
prompt=no
[dn]
CN=devsesh spike CA (delete me)
[v3_ca]
basicConstraints=critical,CA:TRUE,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
nameConstraints=critical,permitted;DNS:$HOST
EOC
cat > leaf.cnf <<EOC
[req]
distinguished_name=dn
prompt=no
[dn]
CN=$HOST
[v3_leaf]
basicConstraints=CA:FALSE
keyUsage=digitalSignature
extendedKeyUsage=serverAuth
subjectAltName=DNS:$HOST
EOC
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 30 -keyout ca.key -out ca.pem -config ca.cnf
openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout leaf.key -out leaf.csr -config leaf.cnf
openssl x509 -req -in leaf.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 30 -out leaf.pem -extfile leaf.cnf -extensions v3_leaf
rm -f leaf.csr ca.srl
echo "ok: ca.pem leaf.pem leaf.key for $HOST"
# Key hash of the leaf for Electron's ignore-certificate-errors-spki-list (spike only)
echo "{\"spki\":\"$(openssl x509 -in leaf.pem -noout -pubkey | openssl pkey -pubin -outform DER | openssl dgst -sha256 -binary | base64)\"}" > ../app/spki.json
