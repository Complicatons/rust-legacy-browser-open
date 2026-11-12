# Cross-play test plan: the server software with browser and desktop players

24 October 2026. Owner's goal: prove that a server running **Rust Legacy Host** works for browser players and for
desktop players who join through the **game loader**, and that the two play together in both directions. Builds on
`SERVER-TESTING-PLAN.md` (P5 gameplay matrix, P6 two-browser rows, P7 anti-cheat, P8 soaks; all automated in
`tools/native/` against the original server on the Azure VM) and `DESKTOP-LAUNCHER-PLAN.md` (the desktop sign-in path).

Stages run in order; each starts only when the one before passes. Results go under each stage with the date, build
and what failed. Tracker: `HOST-AND-LOADER-BUILD.md`.

## Stage 1: both client types on the stand-in server (cloud session)

The host app's demo stack (`host/demo.mjs`: our website, sidecar, gateway, mock game server), one browser player
(the real browser client, headless) and one simulated desktop player: `launcher/core.mjs` signs in, gets a desktop
pass, is admitted at the gateway's `/desktop/admit`, and a `UlinkClient` logs in with the `RLBD` envelope exactly as
the proxy would hand it to the game (as `tests/desktop-launcher.test.mjs` already does for one player).

| Check | Pass when |
|---|---|
| Both join | Browser and desktop players spawn on the same server, each under their own website account |
| See each other | Each sees the other's position and movement (`mixed.move` from P6, with one side desktop) |
| Chat | A line from each reaches the other |
| Combat | Melee and a shot from each side land on the other |
| Loot | Each loots the other's death bag |
| Leaving | The desktop player's loader signs out: the server ends that session within 60 s; the browser player is unaffected |
| Host app view | The dashboard lists both, with kind browser/desktop, and player history records both |

## Stage 2: compile and test on Windows (owner's PC)

`HOST-AND-LOADER-BUILD.md` "Next: compile and test on the PC": `npm test`, `node tools/build-launcher.mjs --test`,
`node tools/build-host-installer.mjs`, `npm run test:host` (including its Windows-only step), the adapter builds.
Compile errors are already ruled out by `node tools/check-csharp.mjs`; this stage runs the programs.

**Result (24 Oct, Azure VM instead of the PC, cloud session, commits up to `316a62e`; re-run 29 Oct): pass.**

| Step | Result |
|---|---|
| `node tools/build-launcher.mjs --test` | PASS: C# host, `steam_api` proxy, both native test suites |
| `node tools/build-host-installer.mjs` | PASS |
| Adapter `compile-check` and `vanilla` builds | PASS, 0 errors (against the test copy's `Managed` DLLs) |
| `npm run test:host` | 36/36 PASS, including "script-started server stopped from the app" (Windows-only) |
| `npm test` (first full run on Windows) | 4 failures, all fixed: the service wrapper printed nothing in non-interactive sessions and the installer test then hung `npm test` (`207315a`); SDDL alias `SY`, drive-letter paths, loader installer with no Start-menu folder (`316a62e`); the boot screen read a restart's "stopped" moment as final (`316a62e`) |
| `npm test` clean re-run | 29 Oct, VM, `6580de5`, default reporter: **1409 tests, 996 pass, 1 fail, 412 skipped** (the private recovered assets are not in the VM's build copy) in 160 s. The one failure was the test, not the loader: `tests/launcher-host.test.mjs` still looked for the pipe's replies as they were before `16d809e` added `pipe.log`; fixed in `d1c8f06` (6/6 pass) |
| Owner's PC (coordinator session, 29 Oct, main `61e303e` = this branch at `6580de5` + the Oxide/IP-ban branch) | `npm test` 1413 pass, 0 fail, 4 skipped (with `RLB_NO_ASSETS=1`: 1006 pass, 0 fail, 411 skipped); `build-launcher --test` and `build-host-installer` pass; vanilla adapter and `adapter/compile-check` 0 errors; `npm run test:host` not yet run there |

## Stage 3: the server software installed for real (Azure VM)

| Check | Pass when |
|---|---|
| Installer | `Install-RustLegacyHost.ps1 -Apply` installs the service and the desktop app; Start menu shortcut opens it signed in |
| Setup | Every Setup step runs with the real scripts (VPS mode); the parts appear on the Overview |
| Boot screen | Shows the real parts and health check, then the dashboard |
| Save-and-quit | Stop logs "saved; asked it to quit" and the save file is fresh; no "ended at once" |
| Schedule | A restart in 2 minutes warns in chat and comes back with the same world; a map wipe archives the old world |
| Message of the day | A player sees it after joining |
| Plugins | Turning a demo plugin off and restarting unloads it |
| Backups | Keep a copy, restore it with the server stopped; an off-site set to a folder and back |
| Terminal | PowerShell and CMD tabs open in the server folder; the Host tab's `restart services` works |
| Website console | Start/stop and "restart in 5 minutes" from your-domain.example's console reach the VM |

**Results so far (24 Oct, Azure VM `rlb-test-vm`, original server, kit at `6580de5`; cloud session).** The VM's own
test website (`http://203.0.113.207:8080`, `testDevSignIn` on) stands in for your-domain.example. The host runs the
original server through the SYSTEM task `RLB-OriginalServer-AtBoot` (`05-Start-Server.ps1 -ViaTask -NoProcmon`).
Two watcher bots (`tools/native/watch-players.mjs`: lite players that log chat, warnings and kicks and rejoin) stood in
for players.

| Check | Result |
|---|---|
| Installer | PASS after three fixes: the service account reads the website's signing keys (`0b0d8a6`); it reads the locked-down server copy and writes only its cfg, saves, userdata and Oxide (`3b1a7ad`); the scripts' firewall allow rules are copied to the kit's `node.exe` (`91ae7e0`). Health check all PASS (3 expected WARN). Start-menu sign-in: owner check in Remote Desktop, to do |
| Setup | parts come from `C:\RLB-host` configs in `host.json` (central, sidecar, gateway; server kind original); the wizard run in the app: to do |
| Boot screen | owner check in Remote Desktop, to do |
| Save-and-quit | PASS: "saved all." in 1.6 s, adapter "Quitting for the host app", process gone in 5 s. The real server never logs "Saved N Object(s)"; the host now takes "saved all." and the save files' times as the save (`c793a68`) |
| Schedule | Restart PASS: chat warnings at 2 min, 1 min and 9 s, back in 10 s with both watchers at the same positions, after `6580de5` (the adapters list browser players, so the host counts them for warnings and the sidecar keeps their leases; the host starts the server through the boot task). Map wipe PASS: warned, old world archived to `backups\wipe-20261024-143753-167` with `wipe.json`, characters kept |
| Message of the day | PASS: both watchers got it 6-10 s after joining |
| Plugins | N/A: the test server is vanilla (no Oxide) |
| Backups | to do after the stage 5 building: both need a kept, non-empty save (the off-site set's `world.sav` is the save guard's last good copy) and the world is still empty. `deploy.campfire` could not fill it: on 24 Oct the bot's kept character had no Rock; on 29 Oct the respawn it now tries first (`16521f0`) timed out in the F1 console helper (passed to the matrix session). The off-site folder goes in `host.json` (`offsite.folder`), which needs a service restart |
| Terminal | owner check in Remote Desktop, to do |
| Website console | to do: the owner makes a host app key on `http://203.0.113.207:8080/owner` and pastes it on the host's Accounts page |

Found on the way (tracked in `HOST-AND-LOADER-BUILD.md`, H12-H15): the watchdog's UDP probe makes the server log
"incompatible uLink version" every 5 s; the save guard moves a legitimately empty 0-byte save to `damaged-*` on every
restart; the service log prints the owner sign-in link with the token; parts do not start with the service (after a
service restart: `POST /api/action {"action":"start","target":"all"}`).

**29 Oct (host reinstalled at `314a5bc`, then `4736207`'s dashboard copied in):** H12-H14 and three more fixes from the
VM are in. The server had exited on 26 Oct 03:04 and stayed down until something started its task on 29 Oct 05:41: the
host took a server started through its own boot task for "started outside" and never restarted it (H16, fixed: it is
the host's own now, also after the host restarts). The service account read 0 CPU for the SYSTEM-owned server, so the
watchdog's CPU signal never moved (now read from WMI's process snapshot, `223db12`), and the host could not read the
gateway's health over its self-signed TLS on 10.0.0.4, so it showed no player count (`a43c88e`). After the reinstall:
every part up again in 22 s, the server re-adopted as the host's own, CPU age 0 s, UDP probe "not needed" (the server
logs a probe line only when a health check runs: 2 in 3 min, was 36), players 0 shown, no token in the new logs.
Host tests on the VM: 110 pass, 0 fail, 1 skip. The installer refuses an existing service on this branch (uninstall
first; main's installer updates in place since `6b9aff2`).

## Stage 4: the real desktop game through the loader (Azure VM)

Needs the original client installed in the VM (owner step, `SERVER-TESTING-PLAN.md` "owner steps" 2), and graphics
good enough for it to start: the VM may have no GPU, in which case the client runs on software graphics or this
stage moves to the owner's PC with the server staying on the VM.

| Check | Pass when |
|---|---|
| Sign in | The loader signs in (and a new account signs up) against the VM's website |
| Join as the account | Launch from the loader: the game joins, the server sees the account's mapped ID, not the PC's Steam/LumaEmu ID |
| Same character | Quit and rejoin: same inventory and position |
| Browser and desktop are one character | The same account in the browser gets the same character (one at a time) |
| One at a time | Joining from the browser while in game on desktop is refused (and vice versa) |
| Replay refused | A captured envelope used a second time is refused |
| Wrong ID refused | A login with another account's ID and no valid envelope is refused |
| Loader closed | Killing the loader mid-game ends the session within about 60 s (`leaseKick`) |
| Website players only | With LauncherOnly on, the plain game (no loader) is refused "Authorization failed"; with it off, it joins as before |
| Not armed | With the loader closed, the game behaves exactly as before on other servers (proxy forwards everything) |

**How to run it on the VM (notes, 24 Oct).** The original client is installed at `C:\Games\RustLegacy` (`rust.exe`
reaches the main menu without a GPU). Build the loader against the VM website:
`node tools/build-launcher.mjs --central <url>`. The loader only allows https, or http to loopback, so either put the
test website behind loopback inside the VM (`netsh interface portproxy add v4tov4 listenaddress=127.0.0.1
listenport=8080 connectaddress=10.0.0.4 connectport=8080`) or use https; its HTTPS call to the gateway's
`/desktop/admit` needs the gateway's self-signed certificate trusted inside the VM. The installer is per-user, so the
owner runs it as `rlbadmin` in Remote Desktop (Run Command is SYSTEM). Watch `%LOCALAPPDATA%\RustLegacyLauncher\pipe.log`
(one line per proxy request) and the sidecar log.

**Set up on the VM (29 Oct, `1275bc1`).** Loader built with `--central http://127.0.0.1:8080/` in
`C:\RLB-stage4\launcher-app`; `netsh portproxy` 127.0.0.1:8080 → 10.0.0.4:8080 (`iphlpsvc` set to Automatic);
the gateway's public certificate in `C:\RLB-stage4\gateway-cert.cer` (SAN 203.0.113.207; rlbadmin trusts it in
CurrentUser\Root); gateway config `desktop: {publicHost: 127.0.0.1, publicPort: 29015, leaseKick: true}` (backup
`gateway.json.pre-desktop`); outbound-block firewall rules "RLB stage 4: block client outbound (…)" for
`C:\Games\RustLegacy\rust.exe` and rlbadmin's launch-profile `rust.exe` (loopback is not filtered). **Remove the
portproxy and the two rules when testing ends.**

**Server side first (29 Oct, original server, `tools/native/desktop-probe.mjs`): 13/13 pass.** The loader's own
core (`launcher/core.mjs`) signs up, signs in, connects and "launches"; a UlinkClient then logs in to the original
server the way the proxy hands the game its ID and envelope:

| Row | Result |
|---|---|
| Sign up / sign in | PASS: `/desktop/register`, then `/desktop/login` |
| Join as the account | PASS: the server mapped ID `9000000000…` (not a Steam ID), game address 127.0.0.1:29015 from the gateway |
| Wrong ID refused | PASS: denied (adapter `identity-mismatch`) |
| Replay refused | PASS: in game, denied by the server's own duplicate-ID check; after leaving, denied by the adapter (`unknown-session`) |
| One at a time (same account, second ticket) | PASS: `already-connected` |
| Sign-out | PASS: the character is kicked 2 s after the loader signs out (`leaseKick`) |

The real game through the loader (the rest of the table above) needs the owner in Remote Desktop.

## Stage 5: playing together, both ways (Azure VM)

Browser side automated with the existing bots (`tools/native/driver.mjs`, the P5/P6 rows, walk-to-meet); desktop side
played by the owner from a checklist, about 30-45 minutes, while a session watches the server logs and the host app.

| Row | Desktop → browser | Browser → desktop |
|---|---|---|
| See and move | Desktop player walks, runs, crouches, jumps; the browser copy matches | Same, reversed |
| Held items | Equip a hatchet, a bow, an M4; the other side sees the right item | Same |
| Chat and voice | Chat both ways; voice where the desktop client supports it | Same |
| Melee and guns | Hits land and show on both sides; damage and death match | Same |
| Death and loot | The killer loots the bag; contents match | Same |
| Building | Foundation, walls, door with a code lock; the other side sees it and is refused at the lock, then opens it with the code | Same |
| Raiding | C4 on the other side's door; both see the explosion and the open doorway | Same |
| Wildlife and crafting | Both hunt the same animal; crafting timers match | Same |
| Restart | A scheduled restart with both online: both warned, both back with their characters | — |

Then a mixed soak: 1 desktop player and 10 browser bots for an hour. Pass when nobody is kicked by the server's
anti-cheat (TruthDetector), memory stays flat, and no move corrections pile up.

## Where (owner, 24 Oct)

Stages 3-5 run on the owner's own servers instead of the Azure VM: the OVH **game VPS** (Windows Server 2022,
`eu1.your-domain.example`, not public yet; wiped to a fresh world before launch) and the **live website** on the OVH web
VPS. The desktop game runs on the **owner's PC** as a real player would, joining the game VPS over the internet
(UDP 29015 opened for it, LauncherOnly on). The Azure VM is the fallback. A Claude Code session on the owner's PC
drives the servers (SSH key and allowed IP); prompts in `NEXT-SESSION-PROMPTS.md`.

**Later on 24 Oct the owner moved stages 3-5 back to the Azure VM** (`rlb-test-vm`): the original server, the host app,
the test website and the original client all run there, with the owner playing the desktop side in Remote Desktop.

## VM state and access (24 Oct)

- **VM:** `rlb-test-vm`, resource group `rlb-test-rg`, ukwest, public IP 203.0.113.207, auto-shutdown 23:00. Driven with
  managed Run Command (`az vm run-command create ... --location ukwest`; runs as SYSTEM; at most 25 stored commands per
  VM, so delete each after reading it; the instance view keeps only the last 4 KB of output). Long jobs: a script in
  `C:\RLB-stage2\jobs\<name>.ps1`, started detached with `Win32_Process.Create` through
  `C:\RLB-stage2\runner.ps1 -Name <name>` (log `C:\RLB-stage2\logs\<name>.log`, ends with `JOBEXIT <code>`). Code:
  `git archive HEAD` to a blob in storage account `rlbtestkitexample`, container `kits`, a short read SAS, then curl + tar
  into `C:\RLB-build` (keeps `node_modules`, `build`, `analysis`).
- **Installed:** Node 24.15, .NET SDK 8.0.426, VS 2022 Build Tools (C++ x86/x64), WebView2, .NET 3.5. Builds in
  `C:\RLB-build` (`build\launcher\app`, `build\host-installer\RustLegacyHost`, `build\vm-test\adapter`). Headless Edge
  does not start as SYSTEM: use Playwright's Chromium under the system profile (`BROWSER_PATH`). Original client:
  `C:\Games\RustLegacy`.
- **Rust Legacy Host:** installed with `-Apply -AppUser rlb-test-vm\rlbadmin -DesktopShortcut` in
  `C:\Program Files\Rust Legacy Host`, data in `C:\ProgramData\Rust Legacy Host` (owner token in `owner.token`;
  dashboard 127.0.0.1:28100; API: `POST /api/login {token}` with headers `origin` and `x-rlb-host: 1`). The original
  server shows as "not verified" (the SYSTEM task owns it); the host stops it by save-and-quit through the adapter.
- **Test website** `http://203.0.113.207:8080` (`testDevSignIn` on), gateway `wss://203.0.113.207:28443/play`
  (self-signed), server id `bd98f98e-278f-4eab-af48-6310ec5f659a`. NSG rule `web-from-vm-self` (the VM's own IP to
  8080/28443) was added for the tests: **remove it when testing ends**. Native rows config:
  `C:\RLB-stage2\cfg\native-vm.json`. Watcher bots: `tools/native/watch-players.mjs`, log
  `C:\RLB-stage2\logs\watch-players.log` (restart after the VM starts).

## Order and who

1. Stage 1: cloud session, once the parts simplification and settings work are merged.
2. Stage 2: owner's PC (or a session there).
3. Stages 3-5: a session with Azure access (the network now allows `management.azure.com`; a new session picks it up),
   otherwise paste blocks for the owner; the owner installs the original client in the VM and plays the stage 5
   checklist.
