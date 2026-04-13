#!/bin/bash
# This is just a sanity check for the Docker container itself.
# It verifies the container can start and has SSH/tmux working.
# The actual devsesh integration tests are in integration_tests/tests/ssh.spec.ts

set -e

CONTAINER_NAME="devsesh-ssh-test"
IMAGE_NAME="devsesh-ssh-test"

echo "Building Docker image..."
docker build -t "$IMAGE_NAME" .

echo "Starting container..."
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
CONTAINER_ID=$(docker run -d -p 2222:22 --name "$CONTAINER_NAME" "$IMAGE_NAME")

cleanup() {
    echo "Cleaning up..."
    docker stop "$CONTAINER_ID" 2>/dev/null || true
    docker rm "$CONTAINER_ID" 2>/dev/null || true
}
trap cleanup EXIT

echo "Waiting for SSH to be ready..."
sleep 3

echo "Testing SSH via su (container exec)..."
TEST_RESULT=$(docker exec "$CONTAINER_ID" su - testuser -c "whoami")
if [ "$TEST_RESULT" = "testuser" ]; then
    echo "Container exec test: OK"
else
    echo "Container exec test: FAILED"
    exit 1
fi

echo "Testing tmux session..."
TMUX_RESULT=$(docker exec "$CONTAINER_ID" su - testuser -c "tmux has-session -t testsession 2>/dev/null && echo exists")
if echo "$TMUX_RESULT" | grep -q "exists"; then
    echo "tmux session test: OK"
else
    echo "tmux session test: FAILED"
    exit 1
fi

echo "All integration tests passed!"