# Caddy with the DuckDNS DNS provider, for Let's Encrypt certificates via the
# DNS-01 challenge: no open ports needed, the server stays private (branch `home` only).
FROM caddy:2.11.9-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/duckdns@v0.5.0

FROM caddy:2.11.9
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
