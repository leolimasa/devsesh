FROM alpine:latest

RUN apk add --no-cache openssh-server tmux bash openssh-client expect curl neovim

RUN adduser -D testuser && echo "testuser:testpass" | chpasswd

RUN ssh-keygen -A

RUN echo "PasswordAuthentication yes" >> /etc/ssh/sshd_config && \
    echo "PermitRootLogin no" >> /etc/ssh/sshd_config && \
    echo "ChallengeResponseAuthentication no" >> /etc/ssh/sshd_config && \
    echo "UsePAM yes" >> /etc/ssh/sshd_config

COPY --chmod=755 build/devsesh /usr/local/bin/devsesh

# Copy CA setup script for certificate-based authentication [req.17dfwk]
COPY integration_tests/ssh/ca_setup.sh /ca_setup.sh
RUN chmod +x /ca_setup.sh

COPY integration_tests/ssh/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
