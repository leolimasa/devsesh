# SSH Testing Guide

This document explains how to start the SSH test Docker container and connect to it to test the devsesh server functionality.

## Overview

The SSH test environment consists of:
- An Alpine-based Docker container running an SSH server
- A test user (`testuser`) with password (`testpass`)
- A pre-created tmux session (`testsession`)
- The devsesh binary installed in the container

## Prerequisites

- Docker installed and running
- Basic familiarity with SSH and tmux

## Starting the Container

### Method 1: Using the provided test script

The simplest way is to use the provided test script:

```bash
cd /path/to/devsesh/integration_tests/ssh
./ssh_test.sh
```

This will:
1. Build the Docker image using build_container.sh
2. Start the container
3. Run basic validation tests
4. Keep the container running for manual testing

### Method 2: Manual Docker commands

If you prefer to manage the container manually:

```bash
# Build the image (from project root)
docker build -t devsesh-ssh-test -f integration_tests/ssh/Dockerfile .

# Run the container (detached, publishing port 2222)
docker run -d -p 2222:22 --name devsesh-ssh-test devsesh-ssh-test
```

## Connecting via SSH

Once the container is running, you can connect via SSH:

```bash
ssh testuser@localhost -p 2222
```

When prompted for the password, use: `testpass`

## Verifying the Environment

After connecting via SSH, you should see:

1. You're logged in as `testuser`
2. A tmux session named `testsession` is already running

You can verify this with:

```bash
# Check current user
whoami

# Check if tmux session exists
tmux has-session -t testsession && echo "tmux session exists" || echo "tmux session missing"

# List tmux sessions
tmux ls
```

## Using devsesh

The devsesh binary is available in the container's PATH at `/usr/local/bin/devsesh`. You can use it to:

```bash
# Start a devsesh session
devsesh start my-test-session

# List devsesh sessions
devsesh list

# Stop a devsesh session
devsesh stop <session-id>
```

## Testing with the devsesh Server

To test against a devsesh server:

1. Start your devsesh server locally (if not already running):
   ```bash
   devsesh server
   ```

2. From within the SSH container, pair with your local server:
   ```bash
   # First, find your host machine's IP from inside the container
   # Typically, you can use the host's internal IP or use host.docker.io on Mac/Windows
   
   # Example (adjust IP as needed):
   devsesh login http://host.docker.io:8080
   ```

3. Start a session that will be tracked by the server:
   ```bash
   devsesh start tracked-session
   ```

## Stopping and Cleaning Up

When you're done testing:

```bash
# Stop and remove the container
docker stop devsesh-ssh-test
docker rm devsesh-ssh-test
```

Or if you used the test script, it will clean up automatically when interrupted (Ctrl+C).

## Troubleshooting

### Connection refused
- Ensure the container is running: `docker ps`
- Verify port mapping: `docker port devsesh-ssh-test`

### Authentication failed
- Username: `testuser`
- Password: `testpass` (as defined in Dockerfile)

### tmux session missing
- Check container logs: `docker logs devsesh-ssh-test`
- The entrypoint.sh script should create the session on startup

## Notes

- This environment is designed for testing and development purposes only
- The SSH server allows password authentication for ease of testing
- In production environments, SSH key-based authentication is recommended