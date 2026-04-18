#!/usr/bin/env bash
set -e

if [ "$IS_DEVSESH_NIX" != "1" ]; then
    echo "Error: This script requires the flake.nix development environment."
    echo "Run: nix develop --command bash -c './test.sh'"
    exit 1
fi

cd "$(dirname "$0")"

echo "Running all Go unit tests..."
go test $(go list ./... | grep -v "/web/wasm/")

echo ""
echo "Running frontend unit tests..."
cd web
npm run test

echo ""
echo "All tests passed!"