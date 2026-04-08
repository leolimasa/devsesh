#!/usr/bin/env bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "$SCRIPT_DIR"

echo "=== Devsesh Integration Tests ==="
echo ""

# Check prerequisites
echo "Checking prerequisites..."
if ! command -v node &> /dev/null; then
    echo "Error: node is not installed or not in PATH"
    exit 1
fi

if ! command -v npx &> /dev/null; then
    echo "Error: npx is not installed or not in PATH"
    exit 1
fi

if ! command -v go &> /dev/null; then
    echo "Error: go is not installed or not in PATH"
    exit 1
fi

echo "✓ All prerequisites available"
echo ""

# Install dependencies if needed
echo "Checking npm dependencies..."
if [ ! -d "node_modules" ] || [ ! -f "package-lock.json" ]; then
    echo "Installing npm dependencies..."
    npm install
    echo "✓ Dependencies installed"
else
    echo "✓ Dependencies already installed"
fi
echo ""

# Check if devsesh binary exists
echo "Checking devsesh binary..."
export DEVSESH_BINARY_PATH="$PROJECT_ROOT/devsesh"
if [ ! -f "$DEVSESH_BINARY_PATH" ]; then
    echo "Error: devsesh binary not found at $DEVSESH_BINARY_PATH"
    echo "Please build it first with: cd \"$PROJECT_ROOT\" && go build ./main.go"
    exit 1
fi
echo "✓ Using existing devsesh binary: $DEVSESH_BINARY_PATH"
echo ""

# Run tests
echo "Running Playwright tests..."
cd "$SCRIPT_DIR"
echo "Using chromium from: ${CHROMIUM_PATH:-$(which chromium || echo 'not found')}"

# Run with xvfb for headless display
if command -v xvfb-run &> /dev/null; then
    echo "Using xvfb-run for headless display"
    xvfb-run --auto-servernum -- npx playwright test
else
    echo "xvfb-run not available, running directly"
    npx playwright test
fi
TEST_EXIT_CODE=$?

echo ""
echo "=== Test Run Complete ==="

exit $TEST_EXIT_CODE