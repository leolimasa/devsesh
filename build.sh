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

# build_wasm.sh outputs directly to web/public/sshclient.wasm
# so Vite includes it in the build automatically
GOOS=js GOARCH=wasm ./build_wasm.sh

echo "Building web client..."
cd web
npm run build
mkdir -p "$BUILD_DIR/web"
cp -rf dist/* "$BUILD_DIR/web/"
cd ..

echo "After web, pwd: $(pwd)"
echo "BUILD_DIR: $BUILD_DIR"

echo "Building Go binary (static)..."
CGO_ENABLED=0 go build -o "$SCRIPT_DIR/build/devsesh" "$SCRIPT_DIR"

echo "Build complete: ./build/devsesh"
