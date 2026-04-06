#!/run/current-system/sw/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
INTEGRATION_DIR="$PROJECT_ROOT/integration_tests"
DEVSESH_BINARY="$PROJECT_ROOT/devsesh"

cd "$INTEGRATION_DIR"

if [ ! -d "node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install
fi

CHROMIUM_PATH=$(nix develop .#default --command sh -c 'which chromium' 2>/dev/null)
if [ -n "$CHROMIUM_PATH" ]; then
    export CHROMIUM_PATH
fi

echo "Running integration tests..."
nix develop .#default --command sh -c "DEVSESH_BINARY=$DEVSESH_BINARY npx playwright test $@"