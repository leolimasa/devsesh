#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/web/wasm/sshclient"

GOOS=js GOARCH=wasm go build -o "$SCRIPT_DIR/web/public/sshclient.wasm" .

echo "WASM SSH client built successfully"