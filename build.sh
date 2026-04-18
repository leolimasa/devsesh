#!/usr/bin/env bash
set -e

if [ "$IS_DEVSESH_NIX" != "1" ]; then
    echo "Error: This script requires the flake.nix development environment."
    echo "Run: nix develop --command bash -c './build.sh'"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BUILD_DIR="$SCRIPT_DIR/build"
mkdir -p "$BUILD_DIR"

echo "Building WASM SSH client..."
export GOOS=js GOARCH=wasm
./build_wasm.sh "$BUILD_DIR"

echo "Building web client..."
rm -rf "$BUILD_DIR/web"
mkdir -p "$BUILD_DIR/web"
cd web
npm install
npm run build
cp -rf dist/* "$BUILD_DIR/web/"
cd ..

echo "Building Go binary (static)..."
export CGO_ENABLED=0
go build -o "$BUILD_DIR/devsesh" .

echo "Build complete: ./build/devsesh"
echo "Web artifacts: ./build/web/"
echo "WASM artifact: ./build/sshclient.wasm"