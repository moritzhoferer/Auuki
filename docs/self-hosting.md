# Self-hosting on your home network

This guide puts Auuki on a small server at home (a Raspberry Pi, a NAS, an old
laptop) so every phone, tablet and laptop on your Wi-Fi can use it with Bluetooth
sensors.

## How it fits together

```
device on your Wi-Fi ──https──▶ Caddy (:443 or HTTPS_PORT) ──http──▶ auuki (:8080)
                                   │                                  app + API
                                   └─ Let's Encrypt certificate        rides in a volume
                                      via DuckDNS (DNS-01 challenge)
```

- **auuki**: one container with the web app and its API. Riders, their account
  tokens and rides live in the `auuki-data` volume.
- **caddy**: a TLS proxy, started by the `https` compose profile. Web Bluetooth and
  Web Serial only work in a secure context, so any device other than `localhost`
  needs HTTPS.
- **DuckDNS**: a free DNS name (`your-subdomain.duckdns.org`) pointing at the
  server's LAN IP. Caddy proves ownership by writing a DNS record through the DuckDNS
  API, so no router ports are opened.

**What is public:** the name, the private LAN IP it points to, and the fact that a
certificate exists (Certificate Transparency logs). **What is not:** the app. A
private IP like `192.168.x.x` can't be reached from the internet. Don't forward
ports to the server and don't point the name at your public IP.

## Requirements

- A server on your home network with Docker and the compose plugin
  (`curl -fsSL https://get.docker.com | sh`). About 150 MB of free RAM is enough
  to run it.
- A machine to build the images on, if the server is small (see step 2).
- A free account at [duckdns.org](https://www.duckdns.org).
- On the devices you ride with: Chrome or Edge. Brave works after enabling
  `brave://flags/#brave-web-bluetooth-api`. Safari on iPhone/iPad has no Web Bluetooth.

## 1. Prepare the server

Check the platform and whether the HTTPS port is free:

```bash
uname -m                                # aarch64 -> linux/arm64, x86_64 -> linux/amd64
sudo ss -tlnp | grep -E ':(80|443) '    # who already uses 80/443?
```

If something already uses 443 (Pi-hole's web UI, a NAS UI, another proxy), either
move that service or pick another port such as `8443` for Auuki (step 4).

Let your user run Docker without sudo (needed for copying images over SSH), then log
out and back in:

```bash
sudo usermod -aG docker $USER
```

## 2. Build the images

On a server with plenty of RAM you can build there (`docker compose build`). A
1 GB board is slow and can run out of memory, so build on another machine and copy
the images. Build for the server's platform from step 1:

```bash
COMPOSE_PROFILES=https DOCKER_DEFAULT_PLATFORM=linux/arm64 docker compose build
docker save auuki-home auuki-caddy | ssh <user>@<server> docker load
```

An Apple Silicon Mac builds `linux/arm64` natively. On an x86 machine Docker
emulates it, which is slower but works.

## 3. Get a DuckDNS name

1. Log in at [duckdns.org](https://www.duckdns.org) and add a subdomain.
2. Set its IP to the server's **LAN** IP (e.g. `192.168.1.50`), not your public IP.
3. Copy the token at the top of the page. Treat it like a password.

**DNS rebinding protection:** some routers and DNS filters refuse to answer for a
public name that points at a private IP. Check from a device on your network:

```bash
nslookup your-subdomain.duckdns.org     # should print the server's LAN IP
```

If it prints nothing or an error, add a local DNS record for the name pointing at the
server (Pi-hole: Settings → Local DNS Records; AdGuard Home: DNS rewrites; or your
router's DNS settings).

## 4. Configure

Copy `compose.yaml` and `.env.example` to a folder on the server and create `.env`:

```bash
ssh <user>@<server> mkdir -p auuki
scp compose.yaml .env.example <user>@<server>:auuki/
ssh -t <user>@<server> "cd auuki && cp .env.example .env && chmod 600 .env && nano .env"
```

```
COMPOSE_PROFILES=https
AUUKI_HOST=your-subdomain.duckdns.org
DUCKDNS_API_TOKEN=<your token>
# only if 443 is taken on the server:
HTTPS_PORT=8443
```

Optional app settings (`COOKIE_SECURE`, `DATA_DIR`) go in `server/.env`, see
[server/.env.example](../server/.env.example).

## 5. Start and check

```bash
cd auuki
docker compose up -d --no-build         # --no-build: use the copied images
docker compose logs -f caddy            # wait for "certificate obtained successfully"
```

The first certificate takes under a minute. Then open
`https://your-subdomain.duckdns.org` (add `:8443` if you changed the port) on a
device, add a rider and connect your sensors. Give riders a 6-digit PIN: everyone on
the network can open the app.

Both containers restart on their own after a reboot (`restart: unless-stopped`).
Caddy renews the certificate about a month before it expires; it is kept in the
`caddy-data` volume.

## Updating

Pull the new code, rebuild and copy the images, then restart on the server:

```bash
git pull
COMPOSE_PROFILES=https DOCKER_DEFAULT_PLATFORM=linux/arm64 docker compose build
docker save auuki-home auuki-caddy | ssh <user>@<server> docker load
ssh <user>@<server> "cd auuki && docker compose up -d --no-build"
```

If `compose.yaml` or `.env.example` changed, copy them again too. Rider data stays in
its volume.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "Client sent an HTTP request to an HTTPS server" | The address was opened with `http://`. Use `https://`. Current images redirect this on their own. |
| Name doesn't resolve on the network | DNS rebinding protection. Add a local DNS record (step 3). |
| Caddy can't bind the port | Another service uses it. Free it or set `HTTPS_PORT` (step 1). |
| Certificate fails in the Caddy log | Wrong `DUCKDNS_API_TOKEN` or `AUUKI_HOST`, or the server has no internet access. |
| Page loads but sensors can't connect | Browser without Web Bluetooth (Safari, Firefox) or Brave with the flag off. |
| Logged out on every reload | The page isn't on https. Session cookies are https only behind the proxy. |

Useful commands on the server:

```bash
docker compose ps                       # are both containers up?
docker compose logs --tail 50 auuki     # app and API log
docker compose restart caddy
```
