#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${1:-$SCRIPT_DIR/build}"
mkdir -p "$BUILD_DIR"

cd "$SCRIPT_DIR/web/wasm/sshclient"

GOOS=js GOARCH=wasm go build -o "$BUILD_DIR/sshclient.wasm" .

echo "WASM SSH client built successfully"