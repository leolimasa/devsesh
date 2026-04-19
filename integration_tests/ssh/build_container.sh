#!/usr/bin/env bash
# Builds the Docker image for SSH integration tests

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
IMAGE_NAME="devsesh-ssh-test"

echo "SCRIPT_DIR: $SCRIPT_DIR"
echo "PROJECT_ROOT: $PROJECT_ROOT"
echo "Building Docker image for SSH tests..."
docker build -f "${SCRIPT_DIR}/Dockerfile" -t "${IMAGE_NAME}" "${PROJECT_ROOT}"
echo "✓ Docker image built: ${IMAGE_NAME}"