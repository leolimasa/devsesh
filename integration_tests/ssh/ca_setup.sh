#!/bin/bash
# ca_setup.sh - Configure SSH CA certificate authentication
#
# This script sets up SSH CA (Certificate Authority) trust for the test container.
# When CA_PUBLIC_KEY environment variable is set, it enables certificate-based
# authentication as an alternative to password auth.
#
# Requirements:
# - CA_PUBLIC_KEY: The CA public key in OpenSSH format (e.g., "ssh-ed25519 AAAA...")
# - The user must have a principals file matching their username
#
# References: [req.17dfwk]
set -e

# Check if CA_PUBLIC_KEY is provided
if [ -z "$CA_PUBLIC_KEY" ]; then
    echo "CA_PUBLIC_KEY not set, skipping CA configuration"
    exit 0
fi

echo "Configuring SSH CA trust..."

# Write the CA public key to a file
echo "$CA_PUBLIC_KEY" > /etc/ssh/ca-key.pub
chmod 644 /etc/ssh/ca-key.pub

# Configure sshd to trust certificates signed by this CA
# TrustedUserCAKeys: Path to CA public key that sshd trusts for signing user certificates
echo "TrustedUserCAKeys /etc/ssh/ca-key.pub" >> /etc/ssh/sshd_config

# Configure principals file location
# AuthorizedPrincipalsFile: Tells sshd where to find the list of authorized principals for each user
# %u is replaced with the username during authentication
echo "AuthorizedPrincipalsFile /etc/ssh/principals-%u" >> /etc/ssh/sshd_config

# Create principals file for testuser
# Principals are identities that a certificate can assert
# A certificate is valid for a user only if it contains a principal listed in this file
mkdir -p /etc/ssh
cat > /etc/ssh/principals-testuser << EOF
testuser
testuser@devsesh
EOF
chmod 644 /etc/ssh/principals-testuser

echo "SSH CA configuration complete"
echo "CA public key installed at /etc/ssh/ca-key.pub"
echo "Principals file created at /etc/ssh/principals-testuser"
