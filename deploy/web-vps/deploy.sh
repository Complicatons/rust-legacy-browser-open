#!/bin/bash
# Website (central service) on the Web VPS behind Caddy. Runbook Phase 5.2 + 5.4 (forum not included yet).
# Re-runnable: replaces the app code, keeps /var/lib/rlb-central (database) and /etc/rlb-central (keys, config).
set -euo pipefail

id rlb >/dev/null 2>&1 || sudo useradd --system --home /srv/rlb --shell /usr/sbin/nologin rlb
sudo mkdir -p /srv/rlb /var/lib/rlb-central /etc/rlb-central/keys
sudo chown rlb:rlb /var/lib/rlb-central /etc/rlb-central /etc/rlb-central/keys
sudo chmod 700 /var/lib/rlb-central /etc/rlb-central /etc/rlb-central/keys

# Downloads (central/downloads.mjs): host installer + game loader, uploaded by the hosting runbook outside a code
# deploy (like /srv/rlb/recovered). The folder always exists so the config key is unconditional; empty subfolders just
# make the download boxes show "Soon".
sudo mkdir -p /srv/rlb/downloads/host /srv/rlb/downloads/loader
sudo chown -R root:root /srv/rlb/downloads && sudo chmod -R a+rX /srv/rlb/downloads

# Code: fresh copy of origin/main + the built site media, owned by root, read-only to the service.
sudo rm -rf /srv/rlb/app.new && sudo mkdir -p /srv/rlb/app.new
sudo tar -xzf /tmp/app.tar.gz -C /srv/rlb/app.new
sudo tar -xzf /tmp/generated.tar.gz -C /srv/rlb/app.new
cd /srv/rlb/app.new
sudo env HOME=/root npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error

# Game at /play (owner's decision, 23 Oct 2026): the recovered assets live outside the app in /srv/rlb/recovered, so a
# code deploy does not re-upload ~940 MB. A new /tmp/recovered.tar.gz (top folder recovered/) replaces them; without
# them the game stays off.
if [ -f /tmp/recovered.tar.gz ]; then
 sudo rm -rf /srv/rlb/recovered.new && sudo mkdir -p /srv/rlb/recovered.new
 sudo tar -xzf /tmp/recovered.tar.gz -C /srv/rlb/recovered.new --strip-components=1
 sudo chown -R root:root /srv/rlb/recovered.new && sudo chmod -R a+rX /srv/rlb/recovered.new
 sudo rm -rf /srv/rlb/recovered.old
 [ -d /srv/rlb/recovered ] && sudo mv /srv/rlb/recovered /srv/rlb/recovered.old
 sudo mv /srv/rlb/recovered.new /srv/rlb/recovered
 sudo rm -f /tmp/recovered.tar.gz
fi
SERVE_GAME=false
if [ -f /srv/rlb/recovered/manifest.json ]; then
 sudo mkdir -p browser/assets && sudo ln -sfn /srv/rlb/recovered browser/assets/recovered
 SERVE_GAME=true
fi
sudo chown -R root:root /srv/rlb/app.new
sudo rm -rf /srv/rlb/app.old
[ -d /srv/rlb/app ] && sudo mv /srv/rlb/app /srv/rlb/app.old
sudo mv /srv/rlb/app.new /srv/rlb/app
cd /srv/rlb/app

# Signing key (first deploy only). The keys folder is mode 700 for rlb, so look with sudo (a plain ls always failed and
# made a new key on every deploy). Keep the key the current config already uses, so join tickets survive a redeploy.
KEY=$(sudo grep -o 'signing-[^"/]*\.pem' /etc/rlb-central/central.json 2>/dev/null | head -1)
if [ -z "$KEY" ] || ! sudo test -f "/etc/rlb-central/keys/$KEY"; then
 if ! sudo ls /etc/rlb-central/keys/ | grep -q '^signing-.*\.pem$'; then
  sudo -u rlb node tools/central.mjs new-key /etc/rlb-central/keys
 fi
 KEY=$(sudo ls -t /etc/rlb-central/keys/ | grep '^signing-.*\.pem$' | head -1)
fi

# Identity pepper (central/identity.mjs): identifiers are stored only as HMACs under it. Made once, kept outside the
# database; never replace it, or every stored identifier stops matching.
if ! sudo test -s /etc/rlb-central/identity-pepper; then
 openssl rand -base64 48 | sudo tee /etc/rlb-central/identity-pepper >/dev/null
fi
sudo chown rlb:rlb /etc/rlb-central/identity-pepper && sudo chmod 600 /etc/rlb-central/identity-pepper

# Mail (central/mailer.mjs): account mail (password reset, email verification) sends over SMTP once the owner drops a
# password into /etc/rlb-central/mail-password (any provider's SMTP credentials work; Resend's are host smtp.resend.com,
# user "resend"). Without that file, mail stays unset and those features stay hidden (console transport off by default
# in production).
MAIL_BLOCK=null
if sudo test -s /etc/rlb-central/mail-password; then
 sudo chown rlb:rlb /etc/rlb-central/mail-password && sudo chmod 600 /etc/rlb-central/mail-password
 MAIL_BLOCK='{"transport": "smtp", "host": "smtp.resend.com", "port": 587, "secure": false, "user": "resend", "passwordFile": "/etc/rlb-central/mail-password", "from": "Rust Legacy <noreply@your-domain.example>"}'
fi

sudo tee /etc/rlb-central/central.json >/dev/null <<EOF
{
  "listen": {"host": "127.0.0.1", "port": 8443},
  "publicUrl": "https://your-domain.example/",
  "database": "/var/lib/rlb-central/central.db",
  "signingKeys": ["/etc/rlb-central/keys/$KEY"],
  "allowedOrigins": ["https://your-domain.example"],
  "steam": {"enabled": true},
  "serveGame": $SERVE_GAME,
  "playUrl": null,
  "trustedProxies": ["loopback", "cloudflare"],
  "identity": {"pepperFile": "/etc/rlb-central/identity-pepper"},
  "listingReview": true,
  "mail": $MAIL_BLOCK,
  "downloadsDir": "/srv/rlb/downloads"
}
EOF
sudo chown rlb:rlb /etc/rlb-central/central.json && sudo chmod 600 /etc/rlb-central/central.json
sudo -u rlb node tools/central.mjs check /etc/rlb-central/central.json

sudo tee /etc/systemd/system/rlb-central.service >/dev/null <<'EOF'
[Unit]
Description=Rust Legacy website and accounts (central)
After=network-online.target
Wants=network-online.target

[Service]
User=rlb
Group=rlb
WorkingDirectory=/srv/rlb/app
ExecStart=/usr/local/bin/node tools/central.mjs run /etc/rlb-central/central.json
Restart=always
RestartSec=3
Environment=NODE_ENV=production
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/rlb-central
ReadOnlyPaths=/etc/rlb-central
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable rlb-central >/dev/null
sudo systemctl restart rlb-central

# Discord #server-status (tools/discord-status.mjs): optional, off until the owner drops the webhook URL in. Put
#   DISCORD_STATUS_WEBHOOK_URL=https://discord.com/api/webhooks/…
# in /etc/rlb-central/discord-status.env (mode 600, owner rlb) and re-run this script, or just systemctl start it.
if sudo test -s /etc/rlb-central/discord-status.env; then
 sudo chown rlb:rlb /etc/rlb-central/discord-status.env && sudo chmod 600 /etc/rlb-central/discord-status.env
 sudo tee /etc/systemd/system/rlb-discord-status.service >/dev/null <<'EOF'
[Unit]
Description=Rust Legacy Discord #server-status updater
After=network-online.target rlb-central.service
Wants=network-online.target

[Service]
User=rlb
Group=rlb
WorkingDirectory=/srv/rlb/app
EnvironmentFile=/etc/rlb-central/discord-status.env
Environment=NODE_ENV=production
Environment=CENTRAL_URL=http://127.0.0.1:8443/
Environment=DISCORD_STATUS_STATE=/var/lib/rlb-central/discord-status.json
ExecStart=/usr/local/bin/node tools/discord-status.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/rlb-central
ReadOnlyPaths=/etc/rlb-central
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true

[Install]
WantedBy=multi-user.target
EOF
 sudo systemctl daemon-reload
 sudo systemctl enable rlb-discord-status >/dev/null
 sudo systemctl restart rlb-discord-status
 echo "rlb-discord-status: enabled"
else
 sudo systemctl disable --now rlb-discord-status >/dev/null 2>&1 || true
 echo "rlb-discord-status: skipped (no /etc/rlb-central/discord-status.env yet; see deploy/web-vps/README.md)"
fi

# Caddy: Cloudflare origin certificate; real client IP from Cloudflare only.
CF=$(curl -fsS https://www.cloudflare.com/ips-v4; echo; curl -fsS https://www.cloudflare.com/ips-v6)
CF=$(echo $CF)
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
{
	servers {
		trusted_proxies static $CF
		client_ip_headers CF-Connecting-IP
	}
}

your-domain.example {
	tls /etc/ssl/cloudflare/origin.pem /etc/ssl/cloudflare/origin.key
	encode zstd gzip
	reverse_proxy 127.0.0.1:8443
}

www.your-domain.example {
	tls /etc/ssl/cloudflare/origin.pem /etc/ssl/cloudflare/origin.key
	redir https://your-domain.example{uri} permanent
}
EOF
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -1
sudo systemctl reload caddy

sleep 3
systemctl is-active rlb-central caddy
sudo test -s /etc/rlb-central/discord-status.env && systemctl is-active rlb-discord-status
sudo ss -tlnp | grep -E ':(8443|443|80) '
curl -sk -o /dev/null -w 'local https / -> %{http_code} %{size_download}B\n' --resolve your-domain.example:443:127.0.0.1 https://your-domain.example/
curl -sk -o /dev/null -w 'local https /roadmap -> %{http_code}\n' -H 'Accept: text/html' --resolve your-domain.example:443:127.0.0.1 https://your-domain.example/roadmap
curl -sk -o /dev/null -w 'www -> %{http_code} %{redirect_url}\n' --resolve www.your-domain.example:443:127.0.0.1 https://www.your-domain.example/x
echo "serveGame: $SERVE_GAME"
curl -sk -o /dev/null -w 'local https /play -> %{http_code} %{size_download}B\n' --resolve your-domain.example:443:127.0.0.1 https://your-domain.example/play
