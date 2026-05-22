#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Output directly to web/public so Vite serves it without copying
OUTPUT_PATH="$SCRIPT_DIR/web/public/sshclient.wasm"

cd "$SCRIPT_DIR/web/wasm/sshclient"

GOOS=js GOARCH=wasm go build -o "$OUTPUT_PATH" .

echo "WASM SSH client built successfully to $OUTPUT_PATH"