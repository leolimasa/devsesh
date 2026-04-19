#!/usr/bin/env bash
# Starts the Docker container for SSH integration tests
#
# Usage:
#   ./start_container.sh          # Start container (default SSH port 2222)
#   ./start_container.sh 2223     # Start container with custom SSH port
#
# To SSH into the container:
#   ssh -p 2222 testuser@localhost  (password: testpass)
#
# To access host services from within the container:
#   Use host.docker.internal as the hostname
#   Example: curl http://host.docker.internal:8080

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="devsesh-ssh-test"
CONTAINER_NAME="devsesh-ssh-test-container"
SSH_PORT="${1:-2222}"

# Check if image exists
if ! docker image inspect "${IMAGE_NAME}" &>/dev/null; then
    echo "Error: Docker image '${IMAGE_NAME}' not found."
    echo "Please run ./build_container.sh first."
    exit 1
fi

# Stop and remove existing container if running
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Stopping existing container..."
    docker rm -f "${CONTAINER_NAME}" &>/dev/null || true
fi

echo "Starting SSH test container..."
echo "  Image: ${IMAGE_NAME}"
echo "  Container: ${CONTAINER_NAME}"
echo "  SSH port: ${SSH_PORT}"

docker run -d \
    --name "${CONTAINER_NAME}" \
    --rm \
    --add-host=host.docker.internal:host-gateway \
    -p "${SSH_PORT}:22" \
    "${IMAGE_NAME}"

echo ""
echo "✓ Container started successfully!"
echo ""
echo "To SSH into the container:"
echo "  ssh -p ${SSH_PORT} testuser@localhost"
echo "  Password: testpass"
echo ""
echo "To access host services from within the container:"
echo "  Use 'host.docker.internal' as the hostname"
echo "  Example: curl http://host.docker.internal:8080"
echo ""
echo "To stop the container:"
echo "  docker stop ${CONTAINER_NAME}"
echo ""
echo "To view logs:"
echo "  docker logs ${CONTAINER_NAME}"
