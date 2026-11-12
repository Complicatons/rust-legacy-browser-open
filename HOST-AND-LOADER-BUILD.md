# Server software and game loader: build tracker

Started 24 October 2026 (Claude Code, cloud session, branch `master-gvpezb`). This is the live tracker for finishing
**Rust Legacy Host** (the server software, `HOST-APP-PLAN.md`) and the **desktop game loader** (`DESKTOP-LAUNCHER-PLAN.md`).
Any session can pick up from here: read this file, then the plan files it names. Update the status table in the same
commit as the work.

## Owner decisions (24 October 2026)

- **Players need a website account.** No local or guest accounts for now (maybe later if player numbers need it). The
  game server keeps each character under the account's mapped ID, so items follow the account.
- **Sign up inside the loader.** A new player can create their account from the loader, with tick boxes to remember
  their email or username and to stay signed in. Passwords are never stored; "stay signed in" keeps the session token
  with Windows DPAPI, as before.
- **The loader's `steam_api` proxy is un-paused (option 1)**, for servers that run our software only: the loader makes
  the desktop game join as the player's website account. The 23 October pause is lifted by this decision. Nothing
  changes for servers that do not run our adapter. It still needs its first test with the real game in the VM.
- **Build every recommended server-software feature** (list below), plus documentation in plain English.
- **Testing on the owner's own servers (24 Oct, owner's permission):** stages 3-5 of `CROSS-PLAY-TEST-PLAN.md` run on the
  OVH game VPS (`eu1.your-domain.example`, not public yet; wiped to a fresh world before launch) and the live website
  (OVH web VPS); the Azure VM is the fallback. Allowed: open the game port (UDP 29015) on the game VPS for desktop
  players, with LauncherOnly kept on; deploy this branch to the live website once the PC tests pass; run the original
  desktop client on the owner's PC as a player for stages 4-5. These run from a Claude Code session on the owner's PC
  (it has the SSH key and the allowed IP); the prompts are in `NEXT-SESSION-PROMPTS.md`.

## Owner decisions (29 October 2026)

Answers to the seven open questions below, plus a network decision (separate, see `CROSS-PLAY-TEST-PLAN.md` / the VM session).

1. **Website roles from the host app: yes, two-way.** Give/remove role controls added to the host app's Settings page (today read-only there).
2. **Release feed: hosted on your-domain.example.**
3. **Setup wizard rights: give the service account write access** to `secrets`, `config` and the test copy so steps 08, 09, 10 and 13 run from the dashboard; drop the pasted-administrator-line requirement. A final "add the parts to host.json" step is added to a wizard run after install.
4. **Off-site backups: `host.json`-only confirmed** — no dashboard folder picker. Already how H8 works; no change needed.
5. **Health page uptime: keep current behaviour** — only minutes the host actually ran count. Already how H6 works; no change needed.
6. **Vanilla adapter: add a start-up hook** so save-and-quit works before the first player joins (today it only starts polling after the first join).
7. **Desktop app:** the app may start the Windows service itself (one UAC prompt); parts (server, website, etc.) auto-start when the service starts (resolves H15). Everything else stays as today's default: start-at-sign-in for the installing user only, the boot screen only after sign-in (not every tab), shell-started programs end with their tab, and PowerShell 7 is not offered.

## Work list

Who: **A** agent session, **O** needs the owner. State: todo, building, done (commit), blocked.

| # | Piece | Where | State |
|---|---|---|---|
| L1 | Sign up in the loader; "Remember my email or username" and "Keep me signed in" ticks | `central/desktop.mjs` (`POST /desktop/register`), `launcher/core.mjs`, `launcher/ui/` | done (`5d5bc47`, `796a296`); the window, central and core tested here; C# bridge uncompiled |
| L2 | Un-pause the proxy and launch profile in the plans and the window | `DESKTOP-LAUNCHER-PLAN.md`, `OFFSHOOT-COMPATIBILITY-PLAN.md`, `launcher/` | done (`ee38424`): plans updated; no pause flag existed in code |
| L3 | Hardware ID sent by the loader (contract in DESKTOP-LAUNCHER-PLAN.md "Hardware ID") | `launcher/host/` | done (`796a296`): `launcher/host/HardwareId.cs`, uncompiled; part formats now fixed in DESKTOP-LAUNCHER-PLAN.md |
| L4 | Loader installer (per-user, WebView2 and .NET checks, removes the launch profile on uninstall) | `deploy/launcher/` | done (`6925582`): `deploy/launcher/`, never run (no PowerShell here); static test `tests/launcher-installer.test.mjs` |
| L5 | Build on the PC (`node tools/build-launcher.mjs --test`: first compile of the new C#), first installer run with `-Apply`, then the first run with the real game in the VM | PC, VM | build and native tests done on the VM (24 Oct, stage 2); first run with the real game: stage 4, todo. Open point to check there: an armed proxy answers with the website ID even if the player types another server's address in game |
| L6 | Loader setup as one download: a per-user setup exe (self-contained .NET, so no runtime check; signed) instead of the PowerShell installer | `deploy/launcher/`, `tools/build-launcher.mjs` | todo |
| L7 | Loader self-update from a signed feed, as the host's (`host/release-feed.mjs`) | `launcher/` | todo |
| L8 | Loader takes over the game installer's desktop shortcuts ("Launch Rust Legacy", "Change nickname") so the loader is what players open | `deploy/launcher/` | todo |
| H12 | Watchdog UDP probe makes the original server log "incompatible uLink version" every 5 s (log noise; found on the VM) | `host/` watchdog | done (`ca96e72`): the probe runs only when the log and CPU have both been quiet 10 s; the dashboard shows UDP "not needed" meanwhile. The 26 Oct exit (H16) came 0.5 s after the 26,235th rejection of a 36.5 h run with no exception and flat object counts (the server log, saved by the coordinator at `C:\RLB-host\run\crash-20261026\output_log.txt`): the probe flood may itself have worn the server down; nothing proves it. **Regression found 2026-10-29 (rlb-test-vm, game-breaking):** a fresh join into an idle server is a join into a *quiet* one, so the probe and the real handshake raced for uLink's one pending-connection slot and the probe won, "No answer from remote host" on the gateway side. **Fixed 2026-10-29:** the watchdog now skips the probe while the gateway's own health (asked fresh, not the cached 5 s copy) reports a session mid native handshake (`bridge/gateway-launcher.mjs` stats' new `connecting` count); see HANDOFF.md. Not yet reproduced live on the VM after the fix. |
| H13 | Save guard moves a legitimately empty 0-byte save (a fresh world) to `damaged-*` on every restart (found on the VM) | `host/` | done (`ca96e72`): an empty save is damage only when a good copy exists and the server's `.old.0` is not empty too |
| H14 | Service log prints the owner sign-in link with the token (found on the VM) | `host/service.mjs` | done (`ca96e72`): the link is printed only at a console; the VM's older service logs still hold the token |
| H15 | Parts do not start with the service: after a service restart they need `POST /api/action {"action":"start","target":"all"}` (open question 7) | `host/service.mjs` | done (29 Oct 2026, owner decision 7): `startService(config,{autoStart:true})`, wired from the CLI entry (the Windows service wrapper runs `node host/service.mjs run <host.json>`); a refused component (e.g. `confirmRunOriginalBinaries:false`) just logs, same as a manual Start all, instead of crashing the service. `tests/host-stack.test.mjs` covers both the happy path and the refusal |
| H16 | A server the host started through the boot task was treated as "started outside" when it exited: never restarted (VM: down 26 Oct 03:04 to 29 Oct 05:41) | `host/supervisor.mjs`, `host/host.mjs` | done (`ca96e72`): the host's own boot-task start, and a server re-adopted by a host set up for the boot task, crash and restart with backoff like a child |
| H17 | The service account read 0 CPU time for the SYSTEM-owned original server, so the watchdog's CPU signal never moved (found on the VM) | `host/proc-stats.mjs` | done (`223db12`): CPU from WMI's process snapshot when the handle gives none; VM: CPU age 0 s after the reinstall |
| H18 | No player count on the VM: the host trusted the gateway's self-signed TLS only on 127.0.0.1, the gateway listens on 10.0.0.4 | `host/host.mjs` | done (`a43c88e`): any address of this machine |
| H1 | Save-and-quit for the game server, used by Stop, Restart and updates | `bridge/adapter.mjs`, `adapter/*.cs`, `host/` | done (`659d9b9`): save → wait for the save line → quit → kill only as a fallback; used by Stop, Restart, schedules. Assumes the console command `save.all` and `Application.Quit()` (uncompiled C#; check on the first real run). **Owner decision 29 Oct (question 6): add a start-up hook so the vanilla build works before the first player joins too — blocked**, see `adapter/vanilla/RustLegacyBrowserVanilla.cs`'s header: needs either a decompiled trace of the server's own start-up sequence (`analysis/decompiled/server/Assembly-CSharp`, not in this worktree) to find a genuine non-player-triggered injection site, or confirmation that the real server's stdin takes console commands the way `host/server-control.mjs`'s mock-only `'console'` via already assumes |
| H2 | Scheduled restarts and wipes with in-game countdown warnings | `host/schedule.mjs`, dashboard Schedule page | done (`659d9b9`, `370230f`): daily restarts, wipe rules (nth/last weekday or every N days/weeks), chat warnings, world or full wipe archived to backups; website console can queue a restart; `servers.last_wipe_at` reported to the website (not shown on the public site yet) |
| H3 | Discord alerts (crash, freeze, failed, anti-cheat flags, reports, offline) | `host/alerts.mjs`, dashboard Settings | done (`7acfabf`, `a87a08f`, `d55ffc2`): Discord webhook only, batched and rate-limited, a switch per event, test button |
| H4 | Server settings editor (server.cfg values, admins, message of the day) | `host/server-settings.mjs`, dashboard Settings | done (`e76b1c9`): `cfg/server.cfg` editor (22 known settings, write-only admin password), new `Motd` in both adapters (uncompiled C#); Legacy has no admin list (`rcon.login` per session). **Website roles two-way (owner decision, question 1, 29 Oct 2026):** give/remove controls added to the Admins panel — `host/accounts.mjs`'s `ADMIN_ROUTES.POST` now includes `roles` (central's `POST /admin/servers/:id/roles` already accepted the host key as the server's owner; only the host-side allowlist was missing), `host/dashboard/server-settings.mjs` adds a player picker (from `/api/accounts`) + role select + Save. Verified: `tests/host-accounts.test.mjs` (grant admin, confirm, revoke, confirm, audited `via:'host'`) and live in the browser (demo stack, both directions) |
| H5 | Player history (play time, names, past flags and bans) | `central/admin.mjs`, dashboard Players | done (`366ea19`, `a87a08f`): central `GET /admin/servers/{id}/player-history` + new `player_names` table; side panel on Players (not on the website admin page yet) |
| H6 | Health graphs over 24 h and 7 days | `host/metrics.mjs`, dashboard Health page | done (`7acfabf`, `a87a08f`): per-minute CSV in the data dir, 24 h and 7 days, five charts with markers and a table view; Windows memory reading unrun |
| H7 | Plugin manager for Oxide plugins | `host/plugins.mjs`, dashboard Plugins page | done (`e76b1c9`): Oxide folder configurable (location on a real Legacy Oxide server unverified); reload waits for H1's console path, otherwise "next restart" |
| H8 | Automatic off-site backups (a folder or S3-compatible storage) | `host/offsite.mjs`, dashboard Backups | done (`dd12013`, `83cc375`): world save + player folder + identity map as one set; folder (path in host.json only) or S3-compatible (own SigV4, tested against AWS vectors); AES-256-GCM; restore needs the game server and sidecar stopped |
| H9 | Config health check | `host/health-check.mjs`, dashboard Overview | done (`e76b1c9`): 12 checks on Overview with a fix line each |
| H10 | Setup wizard (runs the setup scripts step by step, pass/warn/fail) | `host/wizard.mjs`, dashboard Setup | done (`383694d`, `2aa8295`): 14 steps over the existing scripts (`-Json` added, unverified: no PowerShell here); admin steps hand the owner a one-line elevated command to paste. **Owner decision 29 Oct (question 3):** service account write access to `secrets`, `config` and `server\test\rust_server_Data\Managed` (plus read on `server\original` and write on `manifests`, needed for the same reason) added to `deploy/host-app/Install-RustLegacyHost.ps1` — steps 08 (New-Secrets), 09 (New-GatewayCert), 10 (Patch-TestCopy) and 13 (Enrol-Gateway) now run from the dashboard without the pasted-administrator-line fallback (not yet run for real: no PowerShell here, and real ACL changes are too risky to test blind). New final step **"Add the parts to host.json"** (`host/wizard.mjs` `finish()`, a Setup-page button, not a `.ps1` script): detects what the scripts wrote under the scripts root and adds whichever parts host.json does not already have; a part set some other way (attach) is left alone. Tested (`tests/host-wizard.test.mjs`) |
| H11 | Signed release feed for updates | `host/release-feed.mjs`, `tools/`, `central/downloads.mjs` | done (`dd12013`, `83cc375`, 29 Oct 2026): Ed25519-signed feed, `tools/publish-release.mjs`; owner decision 2 (29 Oct) chose your-domain.example, so `central/downloads.mjs` now serves `/downloads/updates/release-feed.json` and `/downloads/updates/rlb-<version>.tar` from `downloadsDir/updates/` (same pattern as the installer's own `/downloads/host/*`), and a fresh install's host.json defaults `releaseFeed.url` to that path on the website it enrols with. The kit already ships a public key (`host/release-feed.pub.pem`, committed in `6b9aff2`) so the feed stays dormant (`release-feed.mjs`'s `configured` needs both a URL and a key it can verify) until whoever holds the matching private key — or a new pair, if that one was never kept offline by the owner — runs `publish-release.mjs sign` and the hosting session uploads the result to `downloadsDir/updates/` on the live site. Not deployed by this session (hosting-only deploys per the standing rule); message sent to the hosting session with what to upload. |
| D1 | Documentation: how it all fits together, server owners, server teams, players (loader) | `site/content/docs/` | done: overview + diagram, host app, setup, restarts and wipes, backups, health and alerts, settings and plugins, updates, troubleshooting, the game loader |
| D2 | HANDOFF entry and roadmap entries for each finished piece | `HANDOFF.md`, `site/content/roadmap/` | done: HANDOFF entry; roadmap `2026-10-24-1` … `-6` with media registered (screenshots regenerate on the PC) |
| A1 | **Desktop app for the host** (owner, 24 Oct): its own window, Start menu shortcut and tray icon over the service; a terminal-style boot screen that animates the real start-up steps and health checks, then opens the dashboard; a terminal panel always docked at the side with PowerShell, CMD and Host-command tabs. Real shells live only in the desktop window (ConPTY, as the signed-in Windows user), never in the service's HTTP API, the website console or a plain browser | `host/desktop/` (C#, WebView2), `host/dashboard/` | done (`8be6f7c`, `8bf88c5`): `host/desktop/`, boot screen `boot.mjs`, terminal `terminal.mjs` + `host-commands.mjs` (xterm.js 6.0.0), status bar; shells and the token are refused unless the dashboard port belongs to the RustLegacyHost service; CSP relaxed for styles only on the dashboard page (nonce + style-src-attr). Owner decision 7 (29 Oct 2026) added `OfflinePage.cs`'s "Start the service" button: one UAC-elevated `Start-Service RustLegacyHost`, honoured by `MainForm.cs` only while that page (not the dashboard) is showing. Builds clean with `dotnet build host/desktop/RustLegacyHost.csproj` (verified this session); still not exercised against a real Windows service — WebView2/ConPTY need an actual desktop session, not this worktree |

## Testing

Cross-play test plan (browser and desktop players together, the server software installed for real): `CROSS-PLAY-TEST-PLAN.md`, stages 1-5.

**24 Oct, Azure VM:** stage 2 passed (one clean `npm test` re-run still to record). Stage 3: installer, save-and-quit,
scheduled restart, map wipe and message of the day pass against the original server; backups, off-site, website console
and the owner's Remote Desktop checks (boot screen, Start-menu sign-in, terminal tabs) are next. Results in the plan.

## Next: compile and test on the PC (first compile of all new C#)

**Compile-checked in the cloud (24 Oct):** `node tools/check-csharp.mjs` (Linux + Ubuntu's `dotnet-sdk-8.0`, against Microsoft's Windows Desktop reference pack) compiles the loader, its test program and the host desktop app with no errors; the service wrapper also compiles. Still only on Windows: running them, the C proxy build (unchanged since the PC built it on 23 Oct) and the adapters (they need the game server's own DLLs).

Everything here is written and tested as far as Linux allows. Paste into PowerShell on the owner's PC, in the repository, after `git fetch` and `git checkout master-gvpezb` + `git pull`. Each step prints PASS/FAIL; send the output of any failure back to a Claude session.

```powershell
npm ci
npm test                                              # full suite (Windows runs the tests Linux skips)
node tools/build-launcher.mjs --test                  # loader: C# host, steam_api proxy, both native test suites
node tools/build-host-installer.mjs                   # host kit: service wrapper, desktop app (dotnet publish), icon
$env:REQUIRE_GPU=''; npm run test:host                # dashboard check, including the Windows-only step
dotnet build adapter/compile-check -p:RefDir=<folder with Assembly-CSharp.dll, uLink.dll, UnityEngine.dll>
dotnet build adapter/vanilla -c Release -p:RefDir=<rust_server_Data\Managed of the test copy>
```

Then, on the Azure VM (sealed-off test machine): install the built host kit with `Install-RustLegacyHost.ps1 -Apply`, open Rust Legacy Host from the Start menu, run Setup, and try save-and-quit, a scheduled restart and the message of the day against the original server; then the loader's first run with the real game (L5). Three adapter calls are unconfirmed until the compile: `ConsoleSystem.Run("save.all", false)`, `rust.BroadcastChat`, and (likely fine, used by the vanilla adapter since 21 Oct) `netUser.connected`.

## How the work is split

Pieces are built in parallel in separate git worktrees, then merged into `master-gvpezb` one at a time with the host
tests run after each merge. New features live in their own modules; shared files (`host/service.mjs`,
`host/host.mjs`, `host/dashboard/index.html`, `host/dashboard/host.mjs`, `host/dashboard/host.css`) only get small
additions.

## Limits of this environment

- Linux cloud container: no PowerShell, no .NET or C# compiler, no Windows service APIs. C# changes (`adapter/*.cs`,
  `launcher/host/*.cs`) are written but **not compiled here**; build them on the PC with
  `node tools/build-launcher.mjs --test` and the adapter builds before shipping.
- `npm run test:host` runs here with `BROWSER_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`. Its step
  "script-started server stopped from the app" times out on Linux before any change (it needs Windows process lookups);
  every other step passes.
- Nothing here runs the original server or client.
