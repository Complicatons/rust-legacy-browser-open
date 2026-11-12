# Game VPS: the first public server (eu1.your-domain.example)

The OVH VPS-2 (Windows Server 2022 Standard, 4 vCore, 8 GB, London) runs the original Legacy server, our adapter sidecar and our gateway, colocated (BROWSER-SERVER-DECISION.md). The website and accounts (central) stay on the web VPS (`deploy/web-vps`). This folder is a thin layer over the host-test scripts and the host app, like `deploy/azure-test`: the same kit (`node tools/build-azure-kit.mjs`) carries it.

```
Browser (https://your-domain.example/play)
   └─ wss://eu1.your-domain.example/play ─ Cloudflare (proxied, Full strict) ─ 203.0.113.83:443 gateway (node, Origin cert)
                                                                                 ├─ 127.0.0.1:28090 sidecar
                                                                                 └─ 127.0.0.1 UDP 29015 rust_server.exe (blocked in/out by Windows Firewall)
```

Decisions built in (change them here before switching on):

| Setting | Value | Why |
| --- | --- | --- |
| Players | Browser only: `LauncherOnly=true`, UDP 29015 never opened | Owner direction: only players admitted through our website or launcher; the desktop launcher has not shipped. **Changed 24 Oct (owner): desktop players through the loader too: UDP 29015 to be opened inbound for `rust_server.exe`, LauncherOnly stays on, everything else stays blocked; see `NEXT-SESSION-PROMPTS.md` prompt 2.** |
| Gateway | `203.0.113.83:443`, Cloudflare Origin certificate for `eu1.your-domain.example` | Cloudflare proxies only standard HTTPS ports; Full (strict) needs an Origin certificate |
| Who reaches 443 | Cloudflare's ranges only (firewall), `trustedProxies: ["cloudflare"]` | The VPS IP stays behind Cloudflare; per-player limits see the player |
| Admin access | Remote Desktop and SSH from the owner's IP only | |
| Anti-cheat | `autoKick: false` (flag only) | Thresholds are tuned on real-player data first |
| Capacity | 100 (server `-maxplayers 100`) | |
| Sidecar namespace | as on Azure (`90000000000000000`, 1 000 000 ids) | Confirm it is a safe range before real players |

Files: `config/*.game-vps.json` and `rustlegacybrowser.cfg.template` (rendered by `scripts/01`), `scripts/01-Set-GameVpsConfig.ps1`, `scripts/02-New-OriginCsr.ps1`, `scripts/03-Install-OriginCert.ps1`. Every script prints its plan and changes nothing without `-Apply`. Tests: `tests/game-vps-config.test.mjs`.

## Before switching anything public on (owner decisions)

1. **Serve the game at `your-domain.example/play`.** The live site runs with `serveGame: false`, so nobody can play yet even with a server up. Turning it on publishes the recovered game files (about 932 MB) from the web VPS; that is the owner's call.
2. **The P5–P8 runs pass on the Azure VM** (PORT-GAPS "Plan to 100 %").

## Steps (O = owner, A = agent; the hosting session does the A steps)

| # | Who | Step |
| --- | --- | --- |
| 1 | O | Remote Desktop to `203.0.113.83` as `Administrator` with the password from OVH's email; change it (Ctrl+Alt+End → Change a password) and keep it in your password manager. |
| 2 | O | In that session, PowerShell as administrator: paste the OpenSSH block the agent gives you (Windows' built-in OpenSSH Server, key-only, your `id_ed25519.pub` as the admin key; runbook 2.6). |
| 3 | A | `ssh Administrator@203.0.113.83 hostname` works; on the PC check `build/vm-test/adapter` is at least as new as `adapter/vanilla` (the 23 Oct 10:45 build already has `LauncherOnly`; rebuild with `deploy/vm-test/host/Build-AdapterOutputs.ps1` only if the source changed since, between VM runs, with the coordinator) and build the kit (`node tools/build-azure-kit.mjs`); copy it to `C:\RLB-kit` and extract; `deploy\azure-test\scripts\00-Install-Node.ps1 -Apply`. |
| 4 | O | In Remote Desktop: install Microsoft's Visual C++ 2013 Redistributable (x86) (aka.ms/highdpimfc2013x86enu, check the Microsoft signature); then `deploy\host-test\scripts\01-New-ServerAccount.ps1 -Apply` and type a password for `rlbserver` (keep it; step 9 needs it once). |
| 5 | A | `host-test\02-Prepare-Server.ps1 -ZipPath C:\RLB-kit\server\RustLegacyServer.zip -Apply`, then `game-vps\01-Set-GameVpsConfig.ps1 -OwnerIp <owner IP> -Apply`, `host-test\03-Set-Firewall.ps1 -Apply`, `04-Test-Isolation.ps1 -Apply` (it warns that the VPS is online: expected), `08-New-Secrets.ps1 -Apply`. |
| 6 | A | `game-vps\02-New-OriginCsr.ps1 -Apply`; in Cloudflare (your-domain.example → SSL/TLS → Origin Server → Create Certificate → *Use my private key and CSR*, hostname `eu1.your-domain.example`, 15 years) paste the CSR and create; save the certificate on the VPS; `game-vps\03-Install-OriginCert.ps1 -CertFile <file> -Apply`. The key is made on the VPS and ends up only in `secrets\gateway-tls.pfx`. |
| 7 | A | `host-test\10-Patch-TestCopy.ps1 -Apply` (adapter with `LauncherOnly=true`). |
| 8 | O | On https://your-domain.example/owner: add a server (name e.g. "EU 1", region EU, endpoint `wss://eu1.your-domain.example/play`) and create an enrolment code; give the server id and code to the agent (valid 15 minutes). Do not publish it yet. |
| 9 | A + O | A: `host-test\13-Enrol-Gateway.ps1 -ServerId <id> -Code <code> -Apply`. O, in Remote Desktop: `host-test\17-Register-ServerTask.ps1 -AtBoot -Apply` and type the `rlbserver` password into the Windows prompt (Task Scheduler stores it). |
| 10 | A | Host app: build the installer on the PC (`node tools/build-host-installer.mjs`), copy and run `Install-RustLegacyHost.ps1 -ScriptsRoot C:\RLB-host -Apply`; it runs the gateway and sidecar as a service (dashboard on `127.0.0.1:28100`, reached through an SSH tunnel). Set the backup schedule on the dashboard. Check the gateway answers locally and its heartbeat shows online on the owner page. |
| 11 | O | **Go.** Say go to the hosting session. Start the original server for the first time yourself (`host-test\05-Start-Server.ps1 -ConfirmRunOriginalBinaries -ViaTask` in Remote Desktop, or the host app dashboard's start button). |
| 12 | A | Cloudflare DNS: `A eu1 → 203.0.113.83`, proxied. Check `wss://eu1.your-domain.example/play` through Cloudflare, a test join from the browser, the owner page heartbeat; then O publishes the server on the owner page. |

Up to step 10 nothing is reachable from the internet: there is no DNS record, 443 is open to Cloudflare only, and the original server is never started by an agent.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Cloudflare 521/522 on eu1 | Gateway not running, wrong `listen` address, or Cloudflare's ranges changed | Host app dashboard; re-run `01-Set-GameVpsConfig.ps1 -Apply` (fetches current ranges) |
| Cloudflare 526 | Gateway certificate missing or not for `eu1.your-domain.example` | Redo steps 6 (new CSR + certificate) |
| Join refused "Authorization failed" | A native client without our launcher, as intended with `LauncherOnly=true` | Join through the website |
| RDP/SSH stopped working | Owner's home IP changed | OVH KVM console (VPS Home → … → KVM), re-run 01 with the new `-OwnerIp` |
