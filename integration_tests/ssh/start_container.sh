#!/usr/bin/env bash
# Starts the Docker container for SSH integration tests
#
# Usage:
#   ./start_container.sh          # Start container (default SSH port 2222)
#   ./start_container.sh 2223     # Start container with custom SSH port
#
# Environment variables:
#   CA_PUBLIC_KEY  - Optional SSH CA public key for certificate-based auth [req.17dfwk]
#
# To SSH into the container:
#   ssh -p 2222 testuser@localhost  (password: testpass)
#
# To access host services from within the container:
#   Use host.docker.internal as the hostname
#   Example: curl http://host.docker.internal:8080
#
# For CA certificate authentication testing:
#   1. Generate a test CA keypair:
#      ssh-keygen -t ed25519 -f /tmp/ca_key -N ""
#   2. Start container with CA:
#      CA_PUBLIC_KEY="$(cat /tmp/ca_key.pub)" ./start_container.sh
#   3. Sign a user key:
#      ssh-keygen -t ed25519 -f /tmp/user_key -N ""
#      ssh-keygen -s /tmp/ca_key -I test -n testuser -V +1m /tmp/user_key.pub
#   4. Connect:
#      ssh -i /tmp/user_key -o CertificateFile=/tmp/user_key-cert.pub -p 2222 testuser@localhost

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

# Build docker run command with optional CA_PUBLIC_KEY
DOCKER_CMD="docker run -d \
    --name ${CONTAINER_NAME} \
    --rm \
    --add-host=host.docker.internal:host-gateway \
    -p ${SSH_PORT}:22"

# Add CA_PUBLIC_KEY environment variable if set
if [ -n "$CA_PUBLIC_KEY" ]; then
    echo "  CA public key: provided (certificate auth enabled)"
    DOCKER_CMD="${DOCKER_CMD} -e CA_PUBLIC_KEY='${CA_PUBLIC_KEY}'"
fi

# Add FLAG_CONTENT if set
if [ -n "$FLAG_CONTENT" ]; then
    echo "  Flag content: ${FLAG_CONTENT}"
    DOCKER_CMD="${DOCKER_CMD} -e FLAG_CONTENT='${FLAG_CONTENT}'"
fi

DOCKER_CMD="${DOCKER_CMD} ${IMAGE_NAME}"

# Execute the docker run command
eval "${DOCKER_CMD}"

echo ""
echo "✓ Container started successfully!"
echo ""
if [ -n "$CA_PUBLIC_KEY" ]; then
    echo "Certificate authentication is ENABLED."
    echo "To test, sign a user key with your CA and use it to connect:"
    echo "  ssh-keygen -t ed25519 -f /tmp/user_key -N ''"
    echo "  ssh-keygen -s <your_ca_key> -I test -n testuser -V +1m /tmp/user_key.pub"
    echo "  ssh -i /tmp/user_key -o CertificateFile=/tmp/user_key-cert.pub -p ${SSH_PORT} testuser@localhost"
    echo ""
else
    echo "Password authentication is enabled."
    echo "To SSH into the container:"
    echo "  ssh -p ${SSH_PORT} testuser@localhost"
    echo "  Password: testpass"
    echo ""
fi
echo "To access host services from within the container:"
echo "  Use 'host.docker.internal' as the hostname"
echo "  Example: curl http://host.docker.internal:8080"
echo ""
echo "To stop the container:"
echo "  docker stop ${CONTAINER_NAME}"
echo ""
echo "To view logs:"
echo "  docker logs ${CONTAINER_NAME}"
echo ""
