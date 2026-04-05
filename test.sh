#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "Running all Go unit tests..."
nix develop --command go test ./...

echo ""
echo "Running frontend unit tests..."
cd web
npm run test

echo ""
echo "All tests passed!"
