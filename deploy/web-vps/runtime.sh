#!/bin/bash
# Node.js (official tarball, SHA-256 checked) and Caddy (official apt repo) on the Web VPS.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
V=24.15.0 F=node-v24.15.0-linux-x64.tar.xz
cd /tmp
curl -fsSLO "https://nodejs.org/dist/v$V/$F"
curl -fsSLO "https://nodejs.org/dist/v$V/SHASUMS256.txt"
grep " $F\$" SHASUMS256.txt | sha256sum -c -
sudo mkdir -p /opt/node
sudo tar -xJf "$F" -C /opt/node --strip-components=1
sudo ln -sf /opt/node/bin/node /usr/local/bin/node
sudo ln -sf /opt/node/bin/npm /usr/local/bin/npm
rm -f "$F" SHASUMS256.txt
node -v

sudo -E apt-get -y -q install debian-keyring debian-archive-keyring apt-transport-https curl gnupg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo -E apt-get update -q
sudo -E apt-get -y -q install caddy
sudo chgrp caddy /etc/ssl/cloudflare/origin.key
sudo chmod 640 /etc/ssl/cloudflare/origin.key
caddy version
