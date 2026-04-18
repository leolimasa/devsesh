#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BUILD_DIR="$SCRIPT_DIR/build"
mkdir -p "$BUILD_DIR"

echo "Building WASM SSH client..."
nix develop --command bash -c 'export GOOS=js GOARCH=wasm; ./build_wasm.sh '"$BUILD_DIR"

echo "Building web client..."
mkdir -p "$BUILD_DIR/web"
cd web
npm install
npm run build
cp -r dist/* "$BUILD_DIR/web/"
cd ..

echo "Building Go binary (static)..."
nix develop --command bash -c 'CGO_ENABLED=0 go build -o '"$BUILD_DIR"'/devsesh .'

echo "Build complete: ./build/devsesh"
echo "Web artifacts: ./build/web/"
echo "WASM artifact: ./build/sshclient.wasm"