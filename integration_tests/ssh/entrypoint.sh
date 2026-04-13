#!/bin/bash
set -e

/usr/sbin/sshd

su - testuser -c "tmux new-session -d -s testsession"

tail -f /dev/null