FROM alpine:latest

RUN apk add --no-cache openssh-server tmux bash openssh-client expect curl

RUN adduser -D testuser && echo "testuser:testpass" | chpasswd

RUN ssh-keygen -A

RUN echo "PasswordAuthentication yes" >> /etc/ssh/sshd_config && \
    echo "PermitRootLogin no" >> /etc/ssh/sshd_config && \
    echo "ChallengeResponseAuthentication no" >> /etc/ssh/sshd_config && \
    echo "UsePAM yes" >> /etc/ssh/sshd_config

COPY --chmod=755 devsesh /usr/local/bin/devsesh

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]