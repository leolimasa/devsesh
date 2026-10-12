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
echo "Running WASM client unit tests..."
# The wasm package only builds for js/wasm, so run it through Go's node runner.
# A minimal environment keeps node under its command-line size limit.
(
    cd web/wasm/sshclient
    env -i PATH="$PATH" HOME="$HOME" GOCACHE="$(go env GOCACHE)" GOMODCACHE="$(go env GOMODCACHE)" \
        GOFLAGS=-mod=vendor GOOS=js GOARCH=wasm \
        go test . -count=1 -exec="$(go env GOROOT)/lib/wasm/go_js_wasm_exec"
)

echo ""
echo "Running frontend unit tests..."
cd web
npm run test

echo ""
echo "All tests passed!"