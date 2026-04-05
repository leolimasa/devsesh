#!/usr/bin/env bash
set -e

echo "Building web client..."
cd web
npm install
npm run build
cd ..

echo "Building Go binary..."
nix develop --command go build -o devsesh .

echo "Build complete: ./devsesh"