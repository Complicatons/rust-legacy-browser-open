# Maintainer setup: keys, domains and accounts

This guide is for whoever takes over the project. The code has been cleaned for open source, so **no real keys, domains, server addresses or accounts are included**. You make your own and put them in place as described below.

Rule for everything here: **secrets live in files on the server or in environment variables, never in git.** The configs only point to secret files (`…File` settings) or name environment variables (`…Env` settings).

---

## 1. Placeholders to replace

Search the repo for these and swap in your own values.

| Placeholder | Means | Where it matters most |
| --- | --- | --- |
| `your-domain.example` | Your website domain | `central/site.mjs`, `site/pages/*.html` (terms, privacy, downloads), `deploy/web-vps/*.sh`, `deploy/game-vps/**`, `host/*.mjs`, `host/setup-exe/RustLegacyHostSetup.cs`, `launcher/host/Storage.cs`, `tools/build-launcher.mjs`, plus docs and tests |
| `eu1.your-domain.example` | Hostname of the first game server (its gateway) | `deploy/game-vps/**` |
| `OWNER/rust-legacy-browser` | Your GitHub repository | Site header and footer, `site/pages/roadmap.html` and `contact.html`, `central/progress.mjs`, `tools/central.mjs`, `tools/sync-progress.mjs`, README badge |
| `discord.gg/your-invite` | Your Discord invite link | `site/pages/*.html`, `site/partials/footer.html`, `site/content/docs/*.md` |
| `203.0.113.x` | Your server IP addresses (these are documentation-only addresses) | `deploy/game-vps/README.md`, `deploy/web-vps/README.md`, `host/wizard-practice.mjs` |
| `rlbtestkitexample` | Azure storage account name (only for the optional Azure test VM) | `deploy/azure-test/**` |
| `https://REPLACE-WITH-DOWNLOAD-URL/...` | Download link for a third-party client used by a survey script | `deploy/azure-test/scripts/30-*.ps1`, `33-*.ps1` |

Quick search: `git grep -n -E "your-domain\.example|OWNER/|your-invite|203\.0\.113|REPLACE"`

Tests check the placeholder values. If you change a domain in code, change it in `tests/` too, then run `npm test`.

The roadmap progress bar reads figures from a public GitHub README (`progressUrl` in the central config, default in `central/progress.mjs`). Point it at your own repo, or set `"progressUrl": null` to use the committed `site/content/progress.json`.

---

## 2. Accounts and services you need

| Service | What it's for | Needed? |
| --- | --- | --- |
| **Domain name** | The website, plus a subdomain per game server (e.g. `eu1.`) | Yes |
| **Cloudflare** (free plan) | DNS, proxy in front of both servers, Origin CA certificates | Yes, as the deploy scripts are written for it |
| **Linux VPS** (Ubuntu 24.04, about 2 GB RAM) | Website and accounts service ("central") | Yes |
| **Windows VPS** (Windows Server 2022, 4 cores / 8 GB) | Original game server, plus our gateway and sidecar | Only to host a game server |
| **SMTP email provider** (the scripts assume Resend: `smtp.resend.com`, user `resend`) | Email verification, password reset and the waitlist email | Optional, but without it those features are hidden |
| **Steam Web API key** | Steam sign-in names and account-quality checks | Optional; Steam sign-in works without it |
| **Discord server and bot** | Community server, status message, update posts | Optional |
| **GitHub repository** | Code, tests (Actions) and the Discord update workflow | Yes |
| **Azure subscription** | Only for the isolated test VM in `deploy/azure-test` | Optional |

---

## 3. Secrets and keys to create

None of these exist in the repo. Generate fresh ones and keep backups somewhere safe, outside git.

### Website / accounts service (central), on the Linux VPS

| Secret | How to make it | Where it goes |
| --- | --- | --- |
| Ticket signing key | `node tools/central.mjs new-key /etc/rlb-central/keys` | `signingKeys` in `central.json` (the first key signs; older keys only verify) |
| SMTP password | From your email provider's dashboard | File named by `mail.passwordFile` (e.g. `/etc/rlb-central/mail-password`) |
| Steam Web API key | https://steamcommunity.com/dev/apikey | File named by `steam.apiKeyFile` |
| Identity pepper | Optional: random bytes, e.g. `openssl rand -hex 32` | File named by `identity.pepperFile`. If you leave it out, one is generated into the database. |
| TLS certificate | Cloudflare dashboard → SSL/TLS → Origin Server → Create certificate (make the key on the server) | `/etc/ssl/cloudflare/origin.{pem,key}`, served by Caddy |

Start from `deploy/central.example.json`. Check it with `node tools/central.mjs check <config>`. The full list of options is in the comment at the top of `tools/central.mjs`. `deploy/web-vps/deploy.sh` writes the config on first run.

Make yourself site staff after registering: `node tools/central.mjs staff <config> <your email or username>`

### Each game server (gateway + sidecar), on the Windows VPS

| Secret | How to make it | Where it goes |
| --- | --- | --- |
| Gateway credential | Register the server on the website's owner panel, then `node tools/gateway.mjs enrol <config> <code>` within 15 minutes | `credentialFile` |
| Control key | `openssl rand -hex 32` | `controlKeyFile` (same file for gateway and sidecar) |
| Plugin key | `openssl rand -hex 32` | Sidecar `pluginKeyFile` and the Oxide plugin config (`PluginKeyHex`) |
| Metrics token (optional) | `openssl rand -hex 24` | Gateway `metricsTokenFile` |
| RCON password | `deploy/*/scripts/*-New-Secrets.ps1` generate one | Server config only |
| Origin certificate for `eu1.` | `deploy/game-vps/scripts/02-New-OriginCsr.ps1`, then Cloudflare Origin CA, then `03-Install-OriginCert.ps1` | Gateway TLS |

Start from `deploy/gateway.example.json` and `deploy/sidecar.example.json`. `deploy/game-vps/README.md` walks through the whole server.

### Host app and game loader updates (release signing)

The host app only installs updates signed with a key it trusts.

1. `node tools/publish-release.mjs keygen --out <safe offline folder>` creates a private `signing-<id>.pem` and a public `release-<id>.pub.pem`.
2. **Replace `host/release-feed.pub.pem` with your new public key** and commit it. The one in the repo belongs to the previous owner's key, which you don't have, so you couldn't sign updates against it.
3. Sign releases with `node tools/publish-release.mjs sign --key <signing.pem> ...` (see the comment at the top of the file). The private key never goes in git or on a server.

### Discord (optional)

| Secret | Used by | How |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` + `--guild <id>` | `tools/discord-setup.mjs`: builds roles and channels from `tools/discord-layout.json` | Discord Developer Portal → New Application → Bot. Give it Administrator only while setup runs. |
| `DISCORD_STATUS_WEBHOOK_URL` and `CENTRAL_URL` | `tools/discord-status.mjs`: live server-status message | Channel → Edit → Integrations → Webhooks |
| `DISCORD_PATCH_NOTES_WEBHOOK_URL`, `DISCORD_PATCH_NOTES_ROLE_ID`, `SITE_URL` | `tools/discord-patch-notes.mjs` | Same way |
| GitHub secret `DISCORD_UPDATES_WEBHOOK_URL`, variables `SITE_URL` and `DISCORD_UPDATES_ROLE_ID` | `.github/workflows/discord-updates.yml` posts new roadmap entries | Repo → Settings → Secrets and variables → Actions |

### Test environments (optional)

`deploy/native-test.example.json` reads passwords from environment variables only: `RLB_NATIVE_PASSWORD`, `RLB_NATIVE_TARGET_PASSWORD`, `RLB_SOAK_PASSWORD`, `RLB_NATIVE_RCON_PASSWORD` and `RLB_GATEWAY_METRICS_TOKEN`. The Azure test VM uses a short-lived storage SAS in `RLB_KIT_SAS`. See `deploy/azure-test/RUNBOOK.md`.

---

## 4. Domain and Cloudflare setup

1. Add the domain to Cloudflare and switch its nameservers.
2. DNS records, both **proxied** (orange cloud):
   - `A @` → web VPS IP (and `www` if you want it)
   - `A eu1` → game VPS IP
3. SSL/TLS mode: **Full (strict)**. Create Origin certificates for the root domain and `eu1.`.
4. Only allow ports 80 and 443 from Cloudflare's IP ranges. `deploy/web-vps/deploy.sh` writes the Caddyfile with the current ranges, and the game VPS firewall does the same. Set `trustedProxies: ["loopback","cloudflare"]` so rate limits see real player IPs.
5. Keep the game server's UDP port (28015/29015) closed to the internet unless you deliberately allow desktop players.

---

## 5. Game assets (not in the repo)

The original game files, the decompiled source and the recovered assets are **not** included and must never be committed (see `.gitignore`). You need your own copy of the original Rust Legacy client and server files. The README's "Regenerate recovered data" section shows how to export `browser/assets/recovered/`. The website only serves the game at `/play` when `serveGame` is `true` and those assets are on the server.

---

## 6. Deploying

- **Website:** `deploy/web-vps/README.md`. Run `harden.sh` and `runtime.sh` once, then `deploy.sh` for each release. Build `site/generated` locally first with `npm run build:site`.
- **Game server:** `deploy/game-vps/README.md`. Its scripts print a plan and only change things with `-Apply`.
- **Host app and loader:** `npm run` scripts and `tools/build-launcher.mjs`. Upload signed builds to the `downloadsDir` the central config points at.
- **Tests:** `npm ci`, then `npm test` (unit tests). Browser checks are `npm run test:*` and need Microsoft Edge.

---

## 7. Handover checklist (for the previous owner)

To keep the existing site, players and community, the previous owner transfers these. To start fresh, skip this and create your own.

- [ ] Domain: transfer it at the registrar, or keep it and point it to your servers
- [ ] Cloudflare: add you as a member of the zone, or move the zone
- [ ] Servers: hand over the VPS accounts, or let you build new ones from the deploy scripts
- [ ] Accounts database (`central.db`): it holds player emails and IPs, so transferring it is a data-protection matter. Update `site/pages/privacy.html` with who runs the site, and tell players before the handover.
- [ ] Discord server: transfer ownership
- [ ] Rotate everything they had access to: SMTP password, Steam API key, Discord bot token and webhooks, gateway credentials and control/plugin keys, and the release signing key (replace `host/release-feed.pub.pem`)
- [ ] Remove the previous owner's SSH keys and IP allow-list rules from the servers
