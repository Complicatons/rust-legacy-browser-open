# Web VPS: your-domain.example

The public website and accounts service (central) on the OVH VPS-1, Ubuntu 24.04, behind Caddy and Cloudflare. Live since 22 Oct 2026. The owner's hosting runbook (outside the repo) has the full plan, including the Windows game VPS.

```
Browser → Cloudflare (proxied, Full strict, Origin CA cert) → Caddy :443 → central 127.0.0.1:8443
```

| What | Where |
| --- | --- |
| Server | `ubuntu@203.0.113.84` (SSH key only; owner's `id_ed25519`, loaded in the Windows ssh-agent) |
| Code | `/srv/rlb/app` (origin/main + `site/generated`; previous copy in `/srv/rlb/app.old`) |
| Game assets | `/srv/rlb/recovered` (root-owned, ~940 MB; linked into the app as `browser/assets/recovered`; previous copy in `/srv/rlb/recovered.old`) |
| Config, signing key | `/etc/rlb-central/` (user `rlb`, mode 700) |
| Database | `/var/lib/rlb-central/central.db` |
| Service | `rlb-central.service` (`journalctl -u rlb-central`) |
| TLS | `/etc/ssl/cloudflare/origin.{pem,key}` (key made on the server; cert valid to 2041) |

Settings in `central.json`: `serveGame` true whenever `/srv/rlb/recovered` holds the assets (the game at `/play`, on since 23 Oct 2026 by the owner's decision to publish them), Steam sign-in without an API key (players get "Steam ####" names), mail via Resend's SMTP relay once `/etc/rlb-central/mail-password` exists (see below; otherwise unset, password reset and email verification stay hidden), `trustedProxies: ["loopback","cloudflare"]`.

## Scripts (run on the server as `ubuntu`)

- `harden.sh`: updates, ufw (22/80/443), fail2ban, unattended upgrades, key-only SSH. Once per server.
- `runtime.sh`: Node.js (official tarball, SHA-256 checked) and Caddy. Once per server.
- `deploy.sh`: installs `/tmp/app.tar.gz` and `/tmp/generated.tar.gz`, writes the config on first run, the systemd unit and the Caddyfile (current Cloudflare ranges), restarts. Safe to re-run; keeps the database and keys.
- `check.sh`: local checks through Caddy (`--resolve` to 127.0.0.1), never via public DNS.

## Redeploy the website

From the repo on the owner's PC (PowerShell for `scp`/`ssh`, so the ssh-agent key is used):

```bash
git fetch origin && git archive --format=tar.gz -o app.tar.gz origin/main
tar -czf generated.tar.gz site/generated
scp app.tar.gz generated.tar.gz deploy/web-vps/deploy.sh ubuntu@203.0.113.84:/tmp/
ssh ubuntu@203.0.113.84 "bash /tmp/deploy.sh"
```

`site/generated` is built locally (`npm run build:site`) and is not in git; skip re-uploading it when it has not changed, but `deploy.sh` expects the file, so keep the last one in `/tmp` or upload it again.

Game assets: only when `browser/assets/recovered` changed (sessions say so when they re-export), also upload `tar -cf - -C browser/assets recovered | gzip -1 > recovered.tar.gz` as `/tmp/recovered.tar.gz`. `deploy.sh` swaps it into `/srv/rlb/recovered` and deletes the upload; every other deploy keeps the copy already there.

Who deploys: only the owner's "Rustlegacy hosting runbook" session redeploys the live site. Other sessions push to origin/main and message it with the commit (and whether `site/generated` changed); they do not upload to or run scripts on the server themselves, because two deploys at once overwrite each other's `/tmp` packages.

Server listings: `deploy.sh` sets `listingReview: true`, so a new listing shows publicly only after site staff approve it on `/staff`.

Identity pepper: `deploy.sh` creates `/etc/rlb-central/identity-pepper` once (owner `rlb`, mode 600) and names it in `central.json` (`identity.pepperFile`). Identifiers are stored only as HMACs under it, so never replace or delete it, and never deploy with a script that leaves `identity` out of the config: central would then generate a different pepper into the database and every stored identifier would stop matching. Live since 22 Oct 2026 (first identity backfill ran under the file pepper). Database backups: `/var/backups/rlb-central/` (root only).

Mail: `central/mailer.mjs` sends over SMTP; any provider's SMTP credentials work, including Resend's SMTP relay (host `smtp.resend.com`, user `resend`, the API key as the password). Put the password alone into `/etc/rlb-central/mail-password` on the server — `deploy.sh` then owns it `rlb:rlb` mode 600 and writes the `mail` block (`passwordFile` points at that file; the password itself never goes in `central.json`, git, GitHub or chat). Without that file, `mail` is `null` and password reset / email verification stay hidden, same as before. This one password never goes in git, GitHub, or chat logs — only into that file:
```
ssh ubuntu@203.0.113.84 "sudo tee /etc/rlb-central/mail-password >/dev/null && sudo bash /tmp/deploy.sh" < path/to/local/key/file
```

Signing keys: `deploy.sh` keeps the key the current `central.json` uses (fixed 22 Oct 2026: before that, every deploy made a new key and switched to whichever sorted first, because it checked the mode-700 keys folder without sudo). Seven unused keys from those deploys are still in `/etc/rlb-central/keys/`; the live one is the one named in `central.json`. Old keys only verify tickets issued before a rotation, so they can be deleted by the owner when convenient.

## Discord #server-status

`tools/discord-status.mjs` keeps one message in #server-status up to date from `GET /servers` (posted once, then edited only when the text changes; see `HANDOFF.md` "Discord status + patch notes"). `deploy.sh` installs it as `rlb-discord-status.service` (`journalctl -u rlb-discord-status`) hitting central directly at `http://127.0.0.1:8443/`, state kept in `/var/lib/rlb-central/discord-status.json` so it survives a redeploy. It is **off** until the webhook exists: once the owner has the #server-status webhook URL (Discord: Edit Channel → Integrations → Webhooks → Copy Webhook URL), put it on the server —

```bash
echo 'DISCORD_STATUS_WEBHOOK_URL=https://discord.com/api/webhooks/…' | ssh ubuntu@203.0.113.84 "sudo tee /etc/rlb-central/discord-status.env >/dev/null && sudo bash /tmp/deploy.sh"
```

(or just drop the file in and `sudo systemctl enable --now rlb-discord-status` without a full redeploy). Removing or emptying the file and re-running `deploy.sh` stops and disables it again. This one webhook URL never goes in git, GitHub, or chat logs — only into that file.

The #updates channel's patch-notes/roadmap cards are posted by `.github/workflows/discord-updates.yml` from GitHub, not from this server; that workflow needs its own `DISCORD_UPDATES_WEBHOOK_URL` repository secret (owner sets it in GitHub: Settings → Secrets and variables → Actions).
