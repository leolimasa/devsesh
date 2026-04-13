#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building WASM SSH client..."
./build_wasm.sh

echo "Building web client..."
cd web
npm install
npm run build
cd ..

echo "Building Go binary (static)..."
nix develop --command bash -c 'CGO_ENABLED=0 go build -o devsesh .'

echo "Build complete: ./devsesh"