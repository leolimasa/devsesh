#!/bin/bash
# entrypoint.sh - Container entrypoint script for SSH test container
#
# This script initializes the SSH test environment:
# 1. Optionally configures SSH CA trust if CA_PUBLIC_KEY is provided
# 2. Creates a flag file for integration test verification
# 3. Starts the SSH daemon
# 4. Creates a tmux session for the test user
#
# Environment variables:
# - CA_PUBLIC_KEY: Optional CA public key for certificate-based auth [req.17dfwk]
# - FLAG_CONTENT: Optional content for the flag file (default: "SUCCESS")
#
# References: [req.17dfwk] [req.cu1f0k]
set -e

# Create flag file with known content for integration test verification [req.cu1f0k]
# This file is used by Phase 13 integration tests to verify SSH connection works
FLAG_FILE="/home/testuser/FLAG_FILE"
FLAG_CONTENT="${FLAG_CONTENT:-SSH_CA_TEST_SUCCESS}"
echo "$FLAG_CONTENT" > "$FLAG_FILE"
chown testuser:testuser "$FLAG_FILE"
chmod 644 "$FLAG_FILE"
echo "Flag file created at $FLAG_FILE with content: $FLAG_CONTENT"

# Run CA setup if CA_PUBLIC_KEY is provided [req.17dfwk]
if [ -n "$CA_PUBLIC_KEY" ]; then
    /ca_setup.sh
fi

# Enable verbose logging for sshd
sed -i 's/#LogLevel.*/LogLevel DEBUG3/' /etc/ssh/sshd_config
echo "LogLevel DEBUG3" >> /etc/ssh/sshd_config

# Start SSH daemon with debug logging
/usr/sbin/sshd -E /tmp/sshd.log
chmod 644 /tmp/sshd.log

# Create tmux session for test user
su - testuser -c "tmux new-session -d -s testsession"

# Keep container running
tail -f /dev/null
