# Server-owner host app plan

22 October 2026. Design for **Rust Legacy Host**: one piece of software a server owner installs on the Windows PC or
VPS of their choice. It sets everything up, runs the owner's original Legacy server beside our gateway and website,
and gives one dashboard for server management, admin and anti-cheat, with live logs. Slice 1 is built (see
"Implemented in slice 1"); everything else here is planned.

## Try it (mock stack, about two minutes)

From PowerShell in the repository: `git pull`, then `npm run host:demo -- --start`. It starts our real website,
sidecar and gateway beside the mock game server; never the original. Open the printed
`http://127.0.0.1:28100/#token=…` link. Logs is the second item in the rail. On the Overview, **Simulate the freeze**
reproduces the 2026-10-22 autosave freeze: the three lanes go quiet, and after 30 s the host restarts the server with
the last good save. Ctrl+C in the PowerShell window stops everything. Add `--fresh` to start over with a new demo folder.

## Who it is for and what success looks like

- **Owner today:** follows `deploy/host-test/RUNBOOK.md` over Remote Desktop, running 16 PowerShell scripts in order,
  watching four consoles, and finding out the server froze when players complain.
- **Owner with the host app:** runs one installer, points it at their own server copy, clicks through a setup wizard
  that shows PASS/WARN/FAIL per step, and then manages everything from a browser tab: start/stop/restart, live logs,
  players, anti-cheat, backups and updates. On a VPS they never need Remote Desktop after install.
- **Success for slice 1:** the service supervises the server, sidecar, gateway and website as child processes, shows
  their state and logs live, restarts a crashed or frozen server by itself, and keeps the last good save. Proven against
  the mock stack. The original binaries are never run by us.

Constraints that shape every choice:

- We cannot ship the original server. The app points at the owner's own copy and verifies its SHA-256 against
  `deploy/host-test/settings.json` before it will run it.
- Only the owner starts original binaries. The service refuses to run the original `rust_server.exe` until the
  owner has ticked an explicit confirmation in the wizard (`server.confirmRunOriginalBinaries`). This is the
  dashboard's version of `05-Start-Server.ps1 -ConfirmRunOriginalBinaries`.
- Changes to Windows security (accounts, firewall rules, folder permissions) happen only in setup steps the owner runs
  from the wizard. Each step shows its plan first, like the scripts' dry runs. Nothing changes silently.

## Shape: a Windows service that serves a dashboard

```
 owner's browser ──https (remote, slice 4)──▶ central /host proxy ──┐
 owner's browser ──http://127.0.0.1:28100 (local)───────────────────┤
                                                                     ▼
                         ┌──────────── Rust Legacy Host service (Node) ────────────┐
                         │  dashboard + JSON API + SSE (host/service.mjs)          │
                         │  supervisor ── central   (tools/central.mjs run)        │
                         │            ├── sidecar   (tools/adapter-sidecar.mjs)    │
                         │            ├── server    (owner's rust_server.exe)      │
                         │            └── gateway   (tools/gateway.mjs run)        │
                         │  log hub (stdout/stderr + output_log.txt tail)          │
                         │  watchdog (log silence + UDP probe + CPU) → save guard  │
                         └─────────────────────────────────────────────────────────┘
```

This is the recommended shape from the brief, with two choices made explicit:

1. **Node, in-process supervision.** The service is plain Node (no new dependencies) and starts our tools as child
   processes, not by importing them. A crash in the gateway's session engine then cannot take down the supervisor,
   and each piece keeps the command line it has today (the PowerShell scripts run exactly the same commands).
2. **The PowerShell scripts stay the source of truth for Windows changes.** The wizard (slice 3) runs the existing
   `deploy/host-test/scripts/*.ps1` steps through a step runner, which parses their output and their
   `Test-RlbLockdown` rows into PASS/WARN/FAIL. We do not rewrite the firewall, account and ACL logic in Node: it is
   already reviewed, it already has dry runs, and `99-Remove.ps1` already undoes it. The scripts get a
   `-Json` switch where the wizard needs structured output.

**Change from the brief: who the server runs as.** Today `05-Start-Server.ps1` asks for the `rlbserver` password
each time (`Start-Process -Credential`). A service cannot type a password, and storing it would be worse. Instead
the installer registers the service under its own **virtual service account** (`NT SERVICE\RustLegacyHost`). It has
no password, cannot log on interactively, and is not an administrator. The server inherits it as a child process.
The lock-down rules move from "the rlbserver user" to "the service SID": `03-Set-Firewall.ps1` gains a
`-ServiceSid` mode, the folder ACLs in `02-Prepare-Server.ps1` grant the SID instead of the user, and
`Test-RlbLockdown` checks the SID. The program-path firewall rules for `rust_server.exe` stay as they are. The
gateway, sidecar and website then run under the same account. That is acceptable because they are our code and
reach only loopback plus the public listener. This change lands with the installer (slice 5). Until then the
service can run in a normal console, and the original server keeps being started by the scripts.

**Why not the alternatives:**

- *Electron desktop app.* It needs Remote Desktop on a VPS, which is exactly what owners want to avoid, and it adds
  about 150 MB plus a second auto-updater.
- *A Go or .NET rewrite.* It would duplicate `tools/central.mjs`, `bridge/gateway-launcher.mjs` and the gateway's
  Node-only session engine. We already ship Node.
- *Docker.* The original server is a 32-bit Windows Unity player. Windows containers need Windows Server and add
  nothing over the lock-down we already have.

## Components

Each unit has one job, a small interface, and its own tests.

| Unit | File | Job | Interface |
| --- | --- | --- | --- |
| Config | `host/config.mjs` | Load and validate `host.json`; derive the component specs | `loadHostConfig(file)`, `validateHostConfig(c)`, `componentSpecs(c)` |
| Log hub | `host/log-hub.mjs` | One ring buffer per source, one sequence number across all of them, subscribers, file tailing | `createLogHub({perSource})`: `push(source, stream, text)`, `since(seq)`, `subscribe(fn)`; `tailFile(path, onLine)` |
| Supervisor | `host/supervisor.mjs` | Start, stop and restart one child process, and follow its state. Restart crashes with backoff | `createProcess(spec, {hub, spawn})`: `start()`, `stop()`, `restart()`, `state`, events `state`/`exit` |
| Watchdog | `host/watchdog.mjs` | Decide whether the server is hung, from three independent signals | `createHangWatchdog({hangSeconds, graceSeconds, probe, cpuTime, lastLogAt, now})`: `sample()` → verdict |
| UDP probe | `host/udp-probe.mjs` | Ask the server's uLink socket for an answer without creating a connection | `probeUlink({host, port, timeoutMs})` → `{ok, ms, reason}` |
| CPU time | `host/proc-stats.mjs` | Total CPU time of a PID (Windows: `GetProcessTimes` through one long-lived PowerShell; Linux: `/proc`) | `createCpuSampler()`: `cpuMs(pid)`, `close()` |
| Save guard | `host/save-guard.mjs` | Copy each completed autosave to `backups/last-good`. Put a damaged save aside and restore the good one before a restart | `createSaveGuard({savePath, backupDir})`: `onLogLine(text)`, `restoreIfBad()` |
| Host | `host/host.mjs` | Wire it all together. Start/stop order, watchdog loop, event stream, actions | `startHost(config)` → `{status(), act(action, target), hub, close()}` |
| Service | `host/service.mjs` | Serve the dashboard and API on 127.0.0.1, with authentication | `node host/service.mjs run <host.json>` |
| Dashboard | `host/dashboard/` | Static HTML/CSS/JS, no build step, the site's design tokens | Calls the API, reads the SSE stream |
| Mock game server | `host/mock-game-server.mjs` | Stands in for `rust_server.exe` in tests and demos: the uLink mock socket, a Unity-style `output_log.txt`, real save rotation, and `freeze`/`crash` commands | `node host/mock-game-server.mjs --port --datadir --log [--autosave s]` |

### Start and stop order

Start order: central → sidecar → server → gateway. The gateway's first heartbeat needs central, and its first join
needs the sidecar and the server. Stop order is the reverse. The order is used only by "Start all" and "Stop all":
each component also has its own Start/Stop/Restart.

### Crash handling

The supervisor treats an exit it did not ask for as a crash. It restarts the process after 2 s, 4 s, 8 s and so on,
capped at 60 s. The backoff resets after 10 minutes of uptime. After 5 crashes in 10 minutes the component goes to
`failed` and waits for the owner. A crash loop cannot fill the disk with logs or hammer the save file.

## Watchdog: catching the autosave freeze

**What happened (22 October 2026).** The original server froze at about its first 10-minute autosave
(`save.autosavetime = 600`). CPU was 0, no log lines came out, and the `.sav` files were 0 bytes. The process did not
exit, so nothing noticed.

**How the server saves** (decompiled `ServerSaveManager.Save`):

1. It logs `Saving to '<datadir><map>.sav'`.
2. It writes `<map>.sav.new`.
3. It rotates `.sav.old.0` … `.sav.old.5`.
4. It renames `.sav` to `.sav.old.0` and `.sav.new` to `.sav`.
5. It logs ` Saved N Object(s). Took T seconds.`

With the shipped arguments, `-datadir rust_server_Data/` and map `rust_island_2013`, the save file is
`rust_server_Data/rust_island_2013.sav`. A freeze between steps 1 and 5 leaves a 0-byte `.sav.new`, and possibly a
0-byte `.sav`.

**Three signals, all required.** The server is declared **hung** only when all three have been silent for
`hangSeconds` (default 90 s) at the same time:

| Signal | How | Why it is honest on the real server |
| --- | --- | --- |
| No log lines | Time since the last line in `output_log.txt` (Unity's `-batchmode` log, tailed by the log hub) | The server logs player joins, saves and errors. A quiet but healthy server still answers the other two. |
| No UDP replies | Every 5 s while the log and CPU have both been quiet for 10 s (or hangSeconds/3), send a Lidgren `Connect` system message with app id `rlb-host-probe` to the game port. A live server answers `ConnectionRejected("Bad app id")` and creates no connection (ULINK-PROTOCOL.md, `O391`). The real server logs each probe as "rejected due to incompatible uLink version" (Azure VM, 2026-10-24), so it is not sent while the other signals are fresh. | uLink starts no thread of its own (no `new Thread` in the decompiled uLink), so its packets are read on the Unity main thread. A frozen main thread stops answering. |
| No CPU | Every 5 s, the process's total CPU time must have increased (more than 0 ms over the window) | A Unity player that is ticking always uses some CPU. A deadlock uses none. |

Requiring all three avoids false restarts. A long save holds the main thread but still uses CPU. A quiet night still
answers the probe. A busy server still logs.

**Grace.** No verdict is reached during `graceSeconds` (default 300 s) after a start, because the first world load
is slow and silent. When `hangSeconds` passes with all three silent, the watchdog acts:

1. Log `hang detected` to the host log, with the three ages.
2. Kill the server process tree (the process does not answer a polite stop).
3. Run the **save guard**: if `<map>.sav` is missing or 0 bytes, or a `<map>.sav.new` is left over, move those files
   into `backups/damaged-<time>/` and copy the newest good save from `backups/last-good/` back into place. A save
   counts as good when its ` Saved N Object(s)` line was logged and its size has not changed since.
4. Start the server again. Restarts count toward the crash budget, so a server that freezes every time ends up
   `failed` instead of looping.

The save guard copies `<map>.sav` into `backups/last-good/` after each completed save, keeping the newest 6. It never
deletes the server's own `.old.N` files.

## Live logs

Sources: `server` (tails `output_log.txt`), `sidecar`, `gateway` and `central` (child stdout/stderr), and `host`
(the supervisor's and watchdog's own events). Each line becomes
`{seq, at, source, stream: out|err|file|host, text, level}`, where `level` is guessed from the text (error, warn,
info). The hub keeps the newest 5,000 lines per source in memory. Each source is also written to
`<dataDir>/logs/<source>-<date>.log`, rolling every day and kept 14 days.

The dashboard reads `GET /api/events?since=<seq>`, a Server-Sent Events stream: first the backlog after `since`,
then `log`, `state` and `watchdog` events. When the connection drops, the browser reconnects with `Last-Event-ID`,
so no line is lost or shown twice. Lines arrive in batches of up to 50 ms so a log burst costs one frame.

## Dashboard

A single page: a left rail and one view per section. It uses the site's design language (`site/css/tokens.css`:
near-black surfaces, Archivo at 125% width for headings, JetBrains Mono for labels, orange `--or` accent, teal,
amber and red status colours). Stats are a big number with a tiny label, never a sentence.

| View | Slice | Contents |
| --- | --- | --- |
| **Overview** | 1 | Server hero (state, uptime, restarts, log lines per minute, players), Start/Stop/Restart; a card per component; the watchdog panel with the three signal meters filling toward `hangSeconds`; the recent host events |
| **Logs** | 1 | Live tail of every source with source chips, a level filter, search, follow/pause, and new-line highlighting |
| **Setup** | 3 | The wizard: scripts 01–15 as steps (account, folders, firewall, isolation probe, secrets, certificate, patch, website, enrol, start) with a plan, live output and PASS/WARN/FAIL |
| **Players** | 4 | Browser and desktop players. Kick, ban, teleport and message through the existing admin command path (central → gateway → adapter → plugin). RCON for console commands where the plugin path has no action |
| **Anti-cheat** | 4 | The `ANTICHEAT-ADMIN-PLAN.md` roster, flags, evidence and replay plot, reusing `site/js/admin.mjs` pieces |
| **Accounts** | 2 | Linked website accounts, native identities and online state, unlink, audit; the adapter panel; the link flow monitor (see "Accounts and links") |
| **Backups** | 3 | Last-good saves, scheduled copies, restore (server stopped) |
| **Updates** | 5 | Gateway and browser-kit channel: signed release manifest, download, verify, swap, roll back |

Slice 1 builds Overview and Logs. The other sections appear in the rail as "not yet" placeholders, so the shape is
visible.

**Motion.** Motion here carries status, not decoration. All of it is CSS transitions and keyframes on transform and
opacity only:

- The status beacon pulses while a component runs and blinks amber while it starts.
- State changes cross-fade the label and slide the card's accent bar.
- The watchdog meters fill smoothly toward the hang threshold and turn amber at 50% and red at 80%.
- New log lines fade in with a brief highlight.
- A sparkline shows log lines per second over the last two minutes.
- Buttons show a progress ring while their action runs.
- Toasts slide in from the corner.

With `prefers-reduced-motion: reduce`, every one of these becomes an instant change. The meaning (colour, text, icon)
stays, and the beacon becomes a steady dot. No information is carried by motion alone.

## Security

- **Loopback only in slice 1.** The service binds `127.0.0.1:28100` and refuses any other `listen.host`.
- **Owner token.** On first start the service writes a random 32-byte token to `<dataDir>/owner.token` (owner and
  administrators only) and prints a one-time sign-in link: `http://127.0.0.1:28100/#token=…`. The page trades the
  token for an `HttpOnly; SameSite=Strict` session cookie and removes it from the address bar. API calls without the
  session cookie get 401.
- **DNS rebinding and CSRF.** Every request must carry `Host: 127.0.0.1:<port>` or `localhost:<port>`. State-changing
  requests are POST only, need `Origin` to match, and need the `X-RLB-Host: 1` header (a cross-site form cannot set
  it).
- **Fixed actions only.** The API runs a fixed list of actions (`start`, `stop` and `restart` on known components).
  Nothing from the browser becomes a command line or a path.
- **Remote access (slice 4).** The owner signs in on their own website (central already has Steam/Discord sign-in,
  roles and HTTPS in production). Central's new `/host` route proxies to the loopback service for the server's
  `owner` role only. The proxy authenticates with a key pair made at enrolment, so the service still listens on
  loopback only. A VPS owner opens `https://their-site/host` from any browser. No Remote Desktop, no extra open
  port, no second password. Fallback for owners without a public website: an SSH tunnel
  (`ssh -L 28100:127.0.0.1:28100 vps`), documented in the runbook.

## Two ways to run it: scripts or app

The owner chooses. Both ways are fully supported, and neither depends on the other.

- **Scripts.** `deploy/host-test/scripts` 01–16 and `deploy/azure-test` keep working on their own, exactly as before.
  The app is not needed and does not need to be installed.
- **App.** The dashboard does everything the scripts do, plus the watchdog, live logs and the slices below.

They are built on the same steps, so they cannot drift apart. The app does not reimplement the scripts:

| Shared piece | Scripts use it | App uses it |
| --- | --- | --- |
| `deploy/host-test/settings.json` (exe, hash, arguments, ports, account, root) | every script | `host/config.mjs` |
| `Test-RlbLockdown` in `_Common.ps1` | 04, 05 | dot-sourced before the original server starts |
| Setup steps 01–04 and 08–13 | run by the owner | run by the wizard (slice 3), which calls these same scripts and reads their output |
| `<root>\run\<name>.pid` (server, sidecar, gateway) | 05, 06, 14, 15 | written for every part the app starts, read to find parts the scripts started |
| `<root>\run\<name>.stop` | written by 06 and 15 just before they stop a part | tells the app that the exit was a stop, not a crash |
| `<root>\logs\<name>-<time>.log` | 14 writes them | followed for a sidecar or gateway the scripts started |

The shared run state is turned on with `scripts: {root: 'C:/RLB-host'}` in `host.json`. Without it, the app keeps
its own run folder (`<dataDir>\run`).

**Either way, it shows in the app and stops either way:**

- A part the scripts started is **adopted**. Its PID file is read, and the PID's program path (the server) or command
  line (`tools\gateway.mjs` and the others) is checked through CIM. It then shows as running, "started outside the
  host", and the watchdog watches it.
  - When the identity is verified, Stop in the app ends it, the way 06 and 15 do.
  - When it is not verified (a process of another account that this one may not inspect), the app only shows it and
    says to stop it the way it was started.
  - When it exits by itself, the app reports it and does not restart it, because the app did not start it. The
    exception is a host set up to start the server through the boot task (`-ViaTask`): that server is the app's own, so
    a crash is restarted through the task, also after the app itself restarted (found on the Azure VM, 26 Oct: the
    server exited and stayed down three days).
  - If it hangs, the app stops it when it may. The save is repaired at the next start, whoever starts it.
- A part the app started writes the same PID file. So 06 and 15 stop it with their usual checks, and 05 and 14 refuse
  to start a second copy. The `.stop` marker they write makes the app record a stop instead of restarting a crash.
- The website started with `12-Start-Central.ps1` runs in its own console and has no PID file. The app sees its port
  in use and refuses to start a second one, with the reason.
- When the app shuts down, it stops only what it started. Parts the scripts started keep running.

Tested in `tests/host-shared.test.mjs` with the mock server, in both directions.

## Accounts and links (next slice)

The owner's goal: a player's account on our website, used in the browser or on the desktop, stays tied to one
character on each game server, so the player keeps that character and can sign in and out. This builds on the existing
identity design rather than a new one:

- `BROWSER-SERVER-DECISION.md`: "Establishing identity on every join" and "Linking a desktop character".
- `HOSTING-ACCOUNTS-BRIDGE-PLAN.md` §3, §5 and §6.
- The gateway enrolment and admission tickets: `bridge/gateway.mjs`, `bridge/adapter.mjs` and central's
  `/bridge/*` routes.

The host app does not invent a second identity system. It runs, watches and explains the one that exists.

**Rules carried over unchanged:**

- The server, through the adapter sidecar's identity map, stays authoritative for which website account owns which
  native identity. Central keeps a link reference for the website and for recovery, but never overrides the map.
- Never auto-link by name, email or IP. There is no arbitrary-ID fallback: a join without a valid ticket or a
  confirmed link is refused.
- One live session per account per server. A second one is refused, or it replaces the same account's stale browser
  session, as the gateway already does.
- Linking keeps the existing backend identity (saves, doors, ownership and bans stay attached), grants no
  permissions, and lifts no bans. Every link and unlink is audited.

**In the app:**

- **Accounts page:**
  - linked website accounts per server, with each one's native identity and handle, kind (browser or desktop), and
    online state from the adapter's leases and the gateway roster;
  - an unlink with a reason, needing a recent owner sign-in;
  - the audit log of links, unlinks and conflicts.
- **Adapter panel:**
  - sidecar health;
  - enrolment with central (server id, credential present, last heartbeat and report);
  - identity-map size and namespace;
  - the open link reservations.
- **Link flow monitor** for desktop characters, from code issued in game (`/browserlink`, short-lived, bound to this
  server and that character) to the website redeeming it, then the adapter reserving and committing. Each step shows
  pass or fail, so an owner can see where a player's link stopped.

**Desktop players signing in with their website account, in two steps:**

1. **Now (designed): the link code.** The player joins with their own desktop identity, types `/browserlink`, and
   redeems the code on the website while signed in. From then on the website account and that character are one,
   in the browser and on the desktop.
2. **Later: a launcher.** It carries a website-issued identity, so the desktop client joins as the account directly.
   The desktop-launcher session is designing it in `DESKTOP-LAUNCHER-PLAN.md`:
   - a one-use desktop pass from central, redeemed at the gateway's `/desktop/admit`;
   - an `RLBD` envelope checked by the adapter, like the browser's `RLBA`;
   - leases of kind `desktop`, ended by a missed launcher heartbeat or a sign-out.

   The host app only supervises those processes. It shows the desktop leases and the launcher-ended events once the
   adapter exposes them as read-only status. It owns none of the gateway's public routes or the plugin.

## Install and updates (slice 5)

- **Installer:** Inno Setup (free, scriptable, signed with the project certificate when there is one). It bundles a
  pinned `node.exe` (MIT), the repository's runtime files (`bridge/`, `central/`, `tools/` runtime subset, `site/`,
  `browser/` without recovered assets, `host/`) and WinSW (MIT) to register the Windows service. It asks for one
  thing: the folder that holds the owner's `RustLegacyServer.zip` or unpacked server. Recovered assets are not in the
  installer. The owner's machine builds or downloads its private overlay the way it does today.
- **Uninstall** runs `99-Remove.ps1 -Apply` (firewall rules, logging settings) and removes the service. The data
  folder stays unless the owner ticks "remove data".
- **Update channel:** the service polls a signed release manifest (Ed25519, the same key format as central's
  `central/keys.mjs`). Gateway and browser-kit updates download beside the running copy, are verified, then
  swapped. The gateway restarts on the next empty-server moment, or right away if the owner clicks. The previous
  version is kept for one-click roll-back.

## Testing

- Unit tests (`tests/host-*.test.mjs`, `node --test`):
  - log hub ordering, limits and `since`;
  - file tail across appends, truncation and partial lines;
  - supervisor states, crash backoff and the `failed` cap;
  - the watchdog verdict table: each signal alone, all three, grace, recovery;
  - the UDP probe against `startMockUlinkServer`, plus a silent socket;
  - the save guard: completed save, 0-byte `.sav`, leftover `.sav.new`, restore;
  - config validation, including that the original server is refused without the confirmation or with the wrong
    SHA-256;
  - the service's Host, Origin, header and cookie checks.
- Integration test: `startHost` with the mock game server, a mock sidecar process and a mock gateway process.
  Start all, see logs arrive over SSE, kill the server and watch the restart, freeze it (`freeze` on its stdin stops
  its event loop, so the log, probe and CPU all go quiet, like the real freeze) and watch the hang verdict, the save
  restore and the restart. Stop all.
- Dashboard check: `tools/check-host-dashboard.mjs` (playwright-core, the installed Edge) opens the dashboard against
  the mock stack and checks:
  - Start, Stop and Restart reach the right states;
  - logs stream;
  - the watchdog panel moves;
  - reduced motion turns off the animations;
  - screenshots for the roadmap.
- Never: the original `rust_server.exe`. It runs only when the owner starts it from their own dashboard.

## Slices

1. **Service, dashboard shell, start/stop/restart, watchdog, live logs**, on the mock stack. Built, with scripts and app
   sharing run state ("Two ways to run it").
2. **Accounts and links**: the Accounts page, the adapter panel and the link flow monitor (see above).
3. Setup wizard (the same scripts with `-Json`, a step runner, PASS/WARN/FAIL) and a backups view.
4. Players and anti-cheat views (the central admin API through the service), RCON, and remote access through central.
5. Installer, Windows service under a virtual account, update channel.
6. First owner run on a real VPS (the owner runs the original server; we watch the dashboard and logs).

## Implementation plan for slice 1

Work in this order. Each step has tests that fail first.

**Review focus.** These are failure modes the sections above imply but do not spell out. Each has a test in the step
that owns the code:

- **Unity rewrites `output_log.txt` at every start.** The tail must notice the file shrinking and read it again from
  the start (step 1).
- **A child that ignores a stop request.** After 10 s the whole process tree is killed (`taskkill /T /F` on
  Windows) and the component still reaches `stopped` (step 6).
- **Paths with spaces or non-ASCII characters** (`C:\Users\Zoë\Rust Server\`). Processes are spawned without a
  shell and with argument arrays, so nothing is quoted by hand (steps 6 and 8).
- **The host restarts while its old server is still running.** A `server.pid` file left behind whose process is
  alive, or a game port already bound, means "already running, not managed". The host never starts a second
  server on the same save (step 8).
- **A slow or stalled dashboard tab.** The SSE backlog is capped at the newest 2,000 lines, and a client whose socket
  buffer stays full for 30 s is dropped. It then reconnects with `Last-Event-ID` (step 9).

1. `host/log-hub.mjs` + `tests/host-log-hub.test.mjs`: ring per source, global `seq`, `since`, subscribers,
   `tailFile` with polling (Unity holds `output_log.txt` open, so `fs.watch` is unreliable on Windows) handling
   truncation and partial lines.
2. `host/udp-probe.mjs` + test against `startMockUlinkServer` (it answers `Bad app id`) and against a bound socket
   that never answers.
3. `host/watchdog.mjs` + verdict-table tests with an injected clock.
4. `host/save-guard.mjs` + tests in a temporary folder that use the server's own file names and rotation.
5. `host/proc-stats.mjs`: one long-lived PowerShell reading PIDs on stdin and answering `TotalProcessorTime`
   (spawning PowerShell every 5 s costs about 300 ms of CPU each time); `/proc/<pid>/stat` elsewhere. Test against
   this Node process.
6. `host/supervisor.mjs` + tests with small Node child scripts (exit, crash loop, slow stop).
7. `host/mock-game-server.mjs`: the mock uLink socket on a fixed port, a Unity-style log, an autosave every N seconds
   with the original file rotation, and stdin commands `freeze`, `crash`, `say <text>`.
8. `host/config.mjs` + `host/host.mjs` + an integration test (start all, crash, freeze → hang → restore → restart).
9. `host/service.mjs`: HTTP server, token sign-in, Host/Origin/header checks, `/api/status`, `/api/action`,
   `/api/events` (SSE), static dashboard. Tests for the security checks.
10. `host/dashboard/` (index.html, host.css, host.mjs) with the motion and reduced-motion rules above.
11. `tools/check-host-dashboard.mjs` + `host/demo.json` (mock stack config) and the `npm run host:demo` and
    `npm run test:host` scripts.
12. HANDOFF.md entry, roadmap entry with dashboard screenshots, commit, rebase, push.

## Implemented in slice 1

Built 22 October 2026 and tested on the mock stack only. The original server has never been run by the host.

- `host/log-hub.mjs`: one ring per source and one sequence number across all of them. Daily files are kept 14 days.
  Lines are split safely across chunks. `tailFile` polls `output_log.txt` and starts over when Unity rewrites it.
  Host notes carry their own level.
- `host/supervisor.mjs`: child processes are spawned with argument arrays and no shell.
  - States: stopped, starting, running, stopping, backoff, failed.
  - Readiness checks; crash backoff of 2, 4 … 60 s; `failed` after 5 crashes in 10 minutes.
  - A graceful stop over stdin where a component has one. Otherwise, and after 10 s, `taskkill /T /F`.
  - A program that cannot start, or a missing folder, is reported plainly.
- `host/watchdog.mjs`, `host/udp-probe.mjs`, `host/proc-stats.mjs`: the three-signal hang verdict described above.
  - The probe gets "Bad app id" from the mock uLink server and opens no connection.
  - CPU time comes from one long-lived PowerShell on Windows, or `/proc` elsewhere. When CPU cannot be read, log and
    UDP decide.
- `host/save-guard.mjs`: keeps the 6 newest completed saves. Before any start it repairs a missing, empty or
  unfinished save: the damaged files go to `backups/damaged-<time>/`, and the newest good copy goes back.
- `host/config.mjs`: `host.json` validation and the component specs.
  - The original server needs all of these: `confirmRunOriginalBinaries: true`, the host running as the locked-down
    account from `settings.json`, the verified SHA-256, and every `Test-RlbLockdown` row without a FAIL. These are
    05's own checks.
  - Until the installer's service account exists (slice 5), the practical path for the original server stays
    `05-Start-Server.ps1`.
- `host/host.mjs`: start order, the watchdog loop, players from the gateway's `/healthz`, and status and events. It
  refuses a second server when a recorded PID is still alive or something already answers the game port.
- `host/service.mjs`: 127.0.0.1 only. Owner token, then an `HttpOnly; SameSite=Strict` session cookie. Host-header,
  Origin and `X-RLB-Host` checks, a fixed action list, and CSP. SSE with backlog, resume and stall cut-off.
- `host/dashboard/`: Overview (server hero, big-number stats, the vital-signs strip, component cards, host events),
  Logs (sources, level, search, follow/pause), and placeholders for the later sections.
- `host/mock-game-server.mjs`: the mock uLink socket on a fixed port (`startMockUlinkServer({port})`), a Unity-style
  log, saves in the original file sequence, and `freeze`/`crash`/`quit`/`save`/`say` on stdin.
- `host/demo.mjs` (`npm run host:demo`): our real website, sidecar and gateway, enrolled through the normal owner and
  enrolment API, plus the mock game server.
- Tests:
  - `tests/host-core.test.mjs` (13) and `tests/host-stack.test.mjs` (2): security, start, SSE resume, crash, and
    freeze → hang → restore → restart.
  - `npm run test:host` (`tools/check-host-dashboard.mjs`): 11 checks in headless Edge on the demo stack. Screenshots
    go to `analysis/host-qa`.

Not done yet:

- ~~**A graceful stop for the original server.**~~ Built through the server plugin instead of RCON: see "Implemented:
  save-and-quit, scheduled restarts and wipes" below.
- **The probe on the real server.** Whether it logs each "Bad app id" rejection is unknown. If it does, raise
  `probeEveryMs`; a hang is still caught, because a frozen server logs nothing.
- **Children outlive a host that is killed hard.** Windows does not end them; Ctrl+C stops every part cleanly. Slice 5's
  service wrapper puts the children in a Job Object.
- **The hang thresholds on the real server.** These need the first owner run (slice 6).

## Implemented in slice 2: Accounts and links

Built 23 October 2026 and tested on the mock stack only.

- **Control channel fix (`bridge/adapter.mjs`).** Every sender run now signs a random boot id together with its
  sequence number. The verifier keeps the last sequence for each of the 64 most recent boot ids.
  - Before this, a gateway restarted on its own had every control message refused as `unauthenticated` until the
    sidecar was restarted too. No browser player could join in that time.
  - Replaying a message from a remembered run still fails.
- **Adapter, which stays authoritative:**
  - `unlink` {subject, reason}: refused while the character holds a lease (`online`) or a link reservation is open
    (`link-in-progress`). The identity map entry is removed and the backend identity, so the character and its save,
    stays on the server. A `link-removed` event goes to the outbox.
  - `status` gains `identities` (count, namespace, entries) and `unlinks`.
- **Central:**
  - `host_tokens` table. `POST /owner/servers/{id}/host-key` shows a key once and replaces any older key;
    `POST /owner/servers/{id}/host-key-revoke` withdraws it.
  - The key (`Authorization: Bearer rlbh_…`) is accepted only by `staffOn` admin routes of that one server, as its
    owner. Its audit entries carry `via: host`. Every other route refuses it.
  - New routes: `GET /admin/servers/{id}/accounts` (play sessions and desktop links, with online and ban state) and
    `GET /admin/servers/{id}/link-requests`.
  - `/bridge/report` handles `link-removed`: it deletes the link reference and audits it.
  - The owner page has a **New host app key** button.
- **Host:**
  - `host/accounts.mjs` combines the adapter's view (over the control channel, with the sidecar's control key)
    with central's view (through the host key in `<dataDir>/central-host.key`).
  - API: `GET /api/accounts`, `POST /api/accounts/unlink` (a reason is required), `POST /api/accounts/key`. A
    key is checked against central before it is kept.
  - The gateway's `/healthz` now includes its last heartbeat (a timestamp only).
- **Dashboard Accounts page:**
  - stats: linked accounts, online now, desktop links, links in progress;
  - the account table with kind, character, state, last played, and Unlink (a dialog that asks for a reason);
  - an identity adapter panel: sidecar, server id, website, last heartbeat, key state, identities;
  - desktop link steps (code redeemed → reserved → linked, or the reason it stopped);
  - the link audit;
  - "Connect to your website" until a key is saved.
- **Demo:** `prepareDemo` makes the host key through the owner route and seeds three labelled demo accounts, two
  browser and one desktop link, through the normal tables.
- **Tests:**
  - `tests/accounts-links.test.mjs` (3): the restart and replay, unlink rules and event, and the host key's scope,
    replacement, revoke, audit and `link-removed`.
  - `tests/host-accounts.test.mjs` (1): on the demo stack, the overview, unlink reaching the website through the
    gateway's report, and bad keys.
  - `npm run test:host`: 13 checks.

## Implemented in slice 4 (Players, Anti-cheat) and Backups

Built 23 October 2026 and tested on the mock stack only.

- **Admin proxy:** `host/accounts.mjs` `admin()` and `screenshotImage()`. The host calls central's admin routes for
  its own server only, with the host app key:
  - `GET` players, flags, desktop-flags, recent-flags, bans, reports, commands, audit, alts, screenshots;
  - `POST` kick, bans, unban, command, resolve-report, screenshot.

  Anything else is refused (404). The dashboard reaches them through `GET|POST /api/central/<route>` and
  `GET /api/screenshot/<id>`.
- **Central:** `GET /admin/servers/{id}/recent-flags`, the newest 200 browser and desktop flags without detail.
- **Players page:**
  - browser and desktop tables with score bars and named flag kinds;
  - per-player actions: Message, Go to, Bring, Evidence, Kick, and Ban (1 h, 1 d, 7 d, 30 d or permanent, optionally
    also on the game server's own ban list); desktop players act by handle;
  - bans with Unban, and the in-game actions with their results;
  - a note when the server is not reporting.
- **Anti-cheat page:**
  - recent flags in plain words;
  - a player's evidence: the measurements, a top-down replay path with shots, and screenshots;
  - Screenshot, Kick and Ban;
  - open reports with Resolved and Dismiss.
  - One action dialog serves both pages (fields per action; a reason is required for kicks and bans).
- **Backups page:**
  - the save guard's copies (newest 6) and copies the owner keeps (`<backupDir>/owner`, never pruned);
  - Keep a copy now, refused mid-save;
  - Restore, refused unless the server is stopped (whoever started it); the replaced save goes to
    `replaced-<time>`;
  - Delete for the owner's copies only;
  - the server's own `.sav.old.N` rotation, and what was set aside.

  API: `GET /api/backups`, `POST /api/backups/keep|restore|delete`.
- **Motion:** data pages refresh in place with no repeated fades. Only the Overview's host events fade in, because a new
  line there is news.
- **Demo:** labelled demo flags (a teleport with a replay path, fire rate, speed, and a desktop speed flag) and one open
  report.
- **Tests:**
  - `tests/host-accounts.test.mjs` also covers recent flags, evidence, report resolve, kick, ban and unban through
    the key, the route list, and `via: host` in the audit;
  - `tests/host-core.test.mjs` covers owner copies, restore and delete;
  - `tests/host-stack.test.mjs` covers restore refused while running and allowed when stopped;
  - `npm run test:host` now has 16 checks.

## Implemented: the update channel (Updates page)

Built 23 October 2026 and tested on the mock stack and temp folders only.

- **`tools/kit-install.mjs`**, an `inspect` / `apply` / `rollback` module and command line. It uses the rules of
  `deploy/azure-test/scripts/03-Install-KitUpdate.ps1`:
  - files only, refusing `..` and absolute entries;
  - refusing `tools/central.mjs`, `central/` and `site/` unless `withCentral`;
  - backing up every replaced file, then unpacking with Windows' own `tar.exe` (System32 is called explicitly,
    because under Git Bash `tar.exe` is GNU tar).

  The backup also records the files an update added, so a roll back removes them. `tests/kit-install.test.mjs` checks
  that 03's two refusal lines are still the ones the module implements, so a change on either side fails until both
  match. `partsFor` maps entries to the parts that must restart (central, gateway, sidecar, host, server adapter).
- **`host/updates.mjs`:**
  - updates are added to `<dataDir>/updates/staged`: streamed to disk, at most 2 GB, a plain `.tar` name;
  - each is inspected (SHA-256, files, parts, refused entries, website files) before anything changes;
  - installs go into `config.updates.appDir` (default this checkout), with backups in
    `<dataDir>/updates/installs/install-<time>`;
  - after an install or roll back, only the affected parts this host started and that are running restart. The
    original server is never restarted by an update, and the owner gets notes when the host app itself or the server
    adapter changed (10-Patch-TestCopy).
- **API:** `GET /api/updates`, `POST /api/updates/upload?name=` (the tar is the body), and
  `POST /api/updates/install|rollback|remove`.
- **Updates page:** the waiting updates with their SHA-256, file count, the parts they touch and anything refused,
  plus consent for website files; Install, which asks first; Remove; and the install history with Roll back.
- **Signed release feed:** built since; see "Implemented: off-site backups and the signed release feed". Without a
  feed, the owner adds the file that `Publish-Kit.ps1` or `tools/build-kit-update.mjs` made, and compares its SHA-256
  with the `.sha256` file beside it.
- **Tests:** `tests/kit-install.test.mjs` (2), `tests/host-updates.test.mjs` (1), the upload in
  `tests/host-stack.test.mjs`, and `npm run test:host` now with 17 checks, including install and roll back with
  the gateway restart.

## Implemented: off-site backups and the signed release feed

Built 24 October 2026 (HOST-AND-LOADER-BUILD.md H8, H11) and tested with temp folders, a local fake S3 server and a
loopback feed only.

- **Off-site backups (`host/offsite.mjs`).** One *set* is the save guard's newest good save, the
  `rust_server_Data/userdata/` player folder (as a tar) and the sidecar's identity map (its `dataFile`), with
  `set.json` written last. A world without its identity map is not a recovery (HOSTING-ACCOUNTS-BRIDGE-PLAN.md §4), so
  they always travel together.
  - Targets: a folder from host.json (`offsite.folder`: a network share or a OneDrive/Dropbox folder; copied under a
    temporary name, renamed, then read back and checked by size and SHA-256; a missing folder fails instead of being
    created), or S3-compatible storage (AWS S3, Backblaze B2, Cloudflare R2, Wasabi) through `host/s3.mjs`: our own
    SigV4 signer (checked against AWS's published examples), PUT with the real payload SHA-256, HEAD after each
    upload, ListObjectsV2 with paging, path or virtual-host style, https only except loopback.
  - Schedule every N hours plus once a day; retention keeps the newest N sets and the newest of each day for D days;
    unfinished sets are removed after a day.
  - Encryption with the owner's passphrase (AES-256-GCM, scrypt key; `host/offsite-files.mjs`), on by default for S3.
    The S3 secret key and the passphrase live only in `<dataDir>/offsite-secrets.json` and are write-only in the UI.
  - Download and restore: every object is checked by size and SHA-256 and decrypted before anything changes, and only
    with the game server and the sidecar stopped (the sidecar keeps the identity map in memory). The replaced save,
    player folder and identity map go to `<backupDir>/replaced-<time>`.
  - API: `GET /api/offsite`, `POST /api/offsite/settings|run|restore`. Backups page: an Off-site section.
- **Signed release feed (`host/release-feed.mjs`, `tools/publish-release.mjs`).** An Ed25519-signed manifest (key
  format of `central/keys.mjs`) listing releases `{version, channel, date, notes, url, sha256, size, parts}`.
  - The host polls `releaseFeed.url` (host.json; off until set), verifies against the pinned key
    (`releaseFeed.publicKey`/`publicKeyFile`, or `host/release-feed.pub.pem` in the kit), refuses a feed older than
    one it accepted, downloads the newest release of its channel into `updates/staged` (streamed, capped at the signed
    size, SHA-256 checked; only from the feed's own site or `releaseFeed.downloadOrigins`) and hands it to the Updates
    flow.
  - It installs on its own only with "install automatically when the server is empty" on, when the gateway reports
    0 players, and never an update with website files.
  - `node tools/publish-release.mjs keygen --out <dir>`, then `sign --key <signing-…pem> --tar <kit tar> --version x.y.z
    [--feed feed.json]`.
  - API: `GET /api/feed`, `POST /api/feed/check|settings|download`. Updates page: Release feed and Releases panels.
- **Tests:** `tests/s3-sigv4.test.mjs` (6), `tests/host-offsite.test.mjs` (4), `tests/host-release-feed.test.mjs` (2);
  `npm run test:host` adds the release feed and off-site checks.

## Implemented: the Windows installer

Built 23 October 2026. The kit build, the compiled wrapper and console mode are tested here. The install script is
parsed and dry-run only, because applying it registers a service, which is not allowed on this PC.

- **Change from the plan: no Inno Setup and no WinSW.** Both are third-party downloads. The kit uses only what Windows
  ships:
  - `host/service-wrapper/RustLegacyHostService.cs`, compiled by `tools/build-host-installer.mjs` with the .NET
    Framework 4 `csc.exe`, is a `ServiceBase` service that runs `node host/service.mjs run <host.json>`;
  - the install script is PowerShell, like the setup scripts.
- **The wrapper:**
  - Node and everything the host starts run in a **Job Object** with KILL_ON_JOB_CLOSE. This fixes the slice 1 gap
    where parts outlived a host that was killed hard.
  - Graceful stop: `stop` on Node's stdin (`host/service.mjs` listens for it), up to 25 s, then the job ends.
  - Node is restarted if it exits on its own (5 s, doubling to 60 s).
  - Logs go to `<dataDir>\logs\service-<date>.log`.
  - `--console` runs the same loop for tests and troubleshooting.
- **Kit:** `node tools/build-host-installer.mjs [--with-assets] [--no-zip]` writes `build/host-installer/RustLegacyHost/`
  and a 47 MB zip. It contains:
  - `app\`: the import closure of the host, website, gateway, sidecar and kit installer, their data trees, the setup
    scripts and the needed packages;
  - `node\node.exe` and its licence;
  - `service\RustLegacyHostService.exe`;
  - the install and uninstall scripts and a README.

  The recovered assets stay out unless `--with-assets`, for a private kit.
- **`deploy/host-app/Install-RustLegacyHost.ps1`** (dry run unless `-Apply`, elevated):
  1. Copy the kit to Program Files.
  2. Create the data folder in ProgramData (SYSTEM, Administrators and the service account only).
  3. Write `host.json`: the scripts' layout under `C:\RLB-host` when it exists (shared run state), otherwise no parts
     yet. An empty host is now valid, and the dashboard explains it.
  4. Register the service `RustLegacyHost` under the virtual account `NT SERVICE\RustLegacyHost` (no password, not an
     administrator), with automatic start and restart on failure.
  5. Grant that account read on `C:\RLB-host\config`, `\secrets` and `\central`, and modify on `\logs`, `\run`,
     `\data` and `\central`.
  6. Start the service and print the sign-in link.

  `Uninstall-RustLegacyHost.ps1` reverses it and keeps the data unless `-RemoveData`.
- **The original server under the service.** The host's gate still allows the original only when the host runs as the
  locked-down account, so the service never starts it. The owner starts it with `05-Start-Server.ps1 -ViaTask`, and
  the app adopts it through the shared PID file. Another account's process cannot be inspected or stopped from the
  service, so it shows as "not verified": the watchdog still watches its log and UDP replies, and the owner stops it
  with 06. The next step is to let the service run the RLB-OriginalServer task (17) itself: give the service SID read
  and run rights on the task's security descriptor, then start and end the server through Task Scheduler after the
  same lock-down checks.
- **Tests:** `tests/host-installer.test.mjs` (3):
  - the file list leaves the private assets out;
  - both scripts parse, and the dry run changes nothing;
  - the built kit runs on its own under the wrapper in console mode: dashboard up, the mock server started in the
    job, `stop` shuts everything down, and a hard kill of the wrapper alone ends Node and the server.

## Implemented: save-and-quit, scheduled restarts and wipes

Built 24 October 2026 (HOST-AND-LOADER-BUILD.md H1 and H2) and tested on the mock stack only. The C# changes are not
compiled here.

- **Server-wide commands (`bridge/adapter.mjs` `SERVER_ACTIONS`):** `save`, `broadcast {message}` and `quit`, queued
  by the host over the sidecar's control channel (`server-command`) and picked up by the server plugin's 2 s poll, like
  the website's admin actions. They carry no target. Their results stay in the adapter for the host
  (`server-commands`, with the plugin's last poll and its player count) and never go to central.
- **Both plugins** (`adapter/RustLegacyBrowser.cs`, `adapter/vanilla/RustLegacyBrowserVanilla.cs`) run them before any
  target is parsed: `save` runs the server's own `save.all` console command, `broadcast` sends chat to everyone as
  "Server", and `quit` calls `Application.Quit` a second later, so the result reaches the sidecar first.
- **Save-and-quit (`host/server-control.mjs`):** Stop, Restart, Stop all, the host shutting down, and scheduled
  restarts and wipes send `save`, wait for the server's ` Saved N Object(s)` line (60 s by default), send `quit` and
  wait for the exit (30 s), and only then fall back to the old kill. It is used only while the plugin has polled in
  the last 8 s; otherwise the process is ended as before, and the host log says why. A hang never takes this path.
  The mock server does the same over its stdin. host.json: `components.server.control` (`adapter` or `console`) and
  `gracefulStop {saveSeconds, quitSeconds}`. The Stop dialog says which of the two will happen.
- **Schedule (`host/schedule.mjs`, `<dataDir>/schedule.json`):** daily restart times and a wipe rule (the first to
  fourth or last weekday of each month, or every N days or weeks from a date), in the owner's time zone.
  - In-game warnings by `broadcast` at 30, 15, 10, 5 and 1 minutes and 10 s (configurable), skipped when nobody is
    online; then save-and-quit, the wipe, and start. A restart is skipped when the server was stopped.
  - A world wipe moves `<map>.sav`, its `.old.N` and the save guard's `last-good` copies into
    `backups/wipe-<time>/`; a full wipe also moves `userdata/` (the characters). Nothing is deleted.
  - Turning on a wipe schedule, changing it, or a manual wipe needs a confirmation.
  - "Restart in N minutes" (optionally with a wipe) and Cancel; history and the last wipe in
    `<dataDir>/schedule-state.json`.
- **API:** `GET /api/schedule`, `POST /api/schedule/save|restart-in|cancel`. **Dashboard:** a Schedule page.
- **Website:** the console can queue `restart-in {minutes}` and `restart-cancel` (never a wipe). The relay report's
  `status.schedule.lastWipe.at` is stored as the server's `last_wipe_at` and shown in the public server data as
  `lastWipeAt`.
- **Open:** `save.all` is the Legacy console command as far as we know (`save.autosavetime` is in the same class); no
  decompiled source in this repository confirms the name. The host waits for the save line, so a wrong name only means
  the old kill after 60 s. The vanilla patch polls only after its first hook call, so a server nobody has joined since
  it started cannot be asked to save.
- **Tests:** `tests/host-graceful-stop.test.mjs` (7) and `tests/host-schedule.test.mjs` (4); `npm run test:host` has a
  Schedule step.

## Implemented: the desktop app, boot screen and terminal panel

Built 24 October 2026 (HOST-AND-LOADER-BUILD.md A1, the owner's request: "feel like an actual piece of software").
The page side is tested here in a browser; the C# app and the installer changes are not compiled or run here.

- **Desktop app (`host/desktop/`, .NET 8 WinForms + WebView2, like the game loader).** A window titled "Rust Legacy
  Host" over the service's own dashboard on `http://127.0.0.1:<port>/`. It is a front end, never the engine: closing
  it hides it to the tray, and Quit ends only the app and its shells; the service and the game server keep running.
  - Port: `<dataDir>\host.json` when this account may read it, else `desktop\RustLegacyHost.json` (the installer
    copies the data folder and port there), else 28100.
  - Tray icon in the server's state (running, starting, stopped, crashed, failed, frozen, offline) with Open,
    Start/Stop/Restart server and Quit; a notice when the server crashes, freezes or stops restarting. One instance
    per Windows user; `--tray` starts hidden.
  - The window shows only the dashboard: other links open in the default browser (https only). When the service
    does not answer, a built-in page says so with the fix and opens the dashboard when it comes back. The app never
    starts the service (that needs administrator rights).
  - **Sign-in without the link:** the app reads `<dataDir>\owner.token` and hands it to the page (`app.token`). The
    installer gives the installing account read on that one file. If it cannot be read, the boot screen says why and
    the sign-in form asks for the token.
- **Bridge** (`host/dashboard/desktop-bridge.mjs`, pinned against `MainForm.cs` by `tests/host-desktop.test.mjs`):
  calls `app.info`, `app.token`, `terminal.open {shell, cols, rows} → {tid}`, `terminal.close {tid}`; notices
  `terminal.input {tid, data}`, `terminal.resize {tid, cols, rows}`, `tray.state {state, text}`; events
  `terminal.data {tid, data}`, `terminal.exit {tid, code}`, `tray.action {action}`.
  - The app takes messages only from the dashboard's origin (`e.Source`) and only these methods.
  - The token and the shells go only to a dashboard whose port is held by the RustLegacyHost service's process or its
    child (the listener table, the service's PID and the process snapshot; no rights on the service needed).
    `--dev` skips that for development.
  - `demoBridge()` is the browser stand-in with a fake shell, for the dashboard check.
- **Real shells:** PowerShell and CMD tabs run in a Windows pseudo console (ConPTY), as the Windows account that opened
  the app, in `C:\RLB-host` (else the data folder, else the user's folder). Each runs in a kill-on-close Job Object:
  closing the tab or the app ends its whole process tree. Only in the app: the service's HTTP API has no shell or
  command route, a plain browser shows no shell tabs, and the website console and remote relay are unchanged.
- **Boot screen (`host/dashboard/boot.mjs`).** A full-window terminal that walks the real start-up, each line a real
  check or state:
  - the service answering, signing in, the live stream, host.json's parts;
  - each part in start order, following its SSE state changes while it moves;
  - the watchdog, then the health check row by row with its fixes, and a "ready" line.
  It never blocks (timeouts show what stalled), Skip or Esc opens the dashboard at once, and reduced motion shows
  whole lines with no spinners or scanlines. It runs each time the app opens, and in a browser right after signing
  in. The problems and warnings it found are printed in the terminal's Host tab.
- **Terminal panel (`host/dashboard/terminal.mjs`, xterm.js 6.0.0 and its fit addon, served from node_modules under
  `/vendor/`).** Docked on the right (at the bottom under 1100 px, a sheet on phones), resizable, collapsible with
  Ctrl+\`, its size and state kept per browser.
  - The **Host** tab (`host-commands.mjs`, in the app and in a browser) runs `help`, `status`,
    `start|stop|restart <part|all>`, `logs [part] [-n N] [--follow]`, `health`, `backup now [label]`,
    `restart-in <min>`, `cancel-restart`, `players` and `clear`. Each is a call to an existing API route through
    the dashboard's own `api()` and `act()`, with tab completion and history.
- **App frame:** the rail is the sidebar, a status bar runs along the bottom (server state, players, uptime, the
  website link, the live stream, the terminal button), only the panels scroll, and Ctrl+1 to Ctrl+9 open the pages.
- **CSP:** the dashboard page alone gets `style-src 'self' 'nonce-…'` and `style-src-attr 'unsafe-inline'`.
  - xterm creates its own `<style>` elements; `terminal.mjs` gives them the response's nonce.
  - xterm colours true-colour cells with style attributes.
  - `script-src` stays `'self'`, and every other response keeps the old policy.
- **Installer:** copies `desktop\`, checks the WebView2 and .NET 8 Desktop runtimes (warns; the service works without
  them), grants the token read, writes `desktop\RustLegacyHost.json`, adds the Start menu shortcut, and on request
  `-DesktopShortcut` and `-StartAtSignIn` (HKCU Run, `--tray`). The uninstaller closes the app, removes all three and
  puts the token back to administrators only. `tools/build-host-installer.mjs` publishes the app (needs the .NET 8 SDK;
  `--no-desktop` skips it) and draws its icon from `icon.svg`.
- **Tests:** `tests/host-desktop.test.mjs` (12); the dashboard check has boot screen, terminal and shell-tab steps.

## Implemented: the owner installer, an existing server as it is, and downloads

Built 29 October 2026 on top of the H1–H15 and A1 work. Tested here on fake server folders, a stand-in patcher and a
local website; the installer itself has not yet been run on a clean Windows machine (the VM dry run is next).

An owner now needs no repository, no scripts and no PowerShell:

1. **Download** `RustLegacyHostSetup-<version>.exe` from `/docs/install-the-host-app` (or `/download/host`).
2. **Run it** (UAC asks once). Four pages: welcome (version, signature, its own SHA-256), your server (folder or
   `RustLegacyServer.zip`; SHA-256 and framework checked by the app's own `host/setup.mjs`), options (folders, firewall),
   install. It then opens the desktop app when the kit has it (A1), else the dashboard in a browser, signed in.
3. **Finish on the Setup page.** A server chosen in the installer selects the wizard's third mode, "An existing server,
   as it is", by itself.

**A single .exe instead of Inno Setup.** `host/setup-exe/RustLegacyHostSetup.cs` is compiled by
`tools/build-host-installer.mjs` with the .NET Framework compiler every Windows has, like the service wrapper, and
carries the kit zip as a resource: no third-party installer tool. It is a thin GUI over `Install-RustLegacyHost.ps1`
(still the one place that changes Windows) and `node host/setup.mjs` (the logic).

- `/dashboard` opens the dashboard in a browser, signed in (the Start menu shortcut of a kit without the desktop app).
  `/uninstall` (Windows' list of installed apps) asks whether to put the server's files back and whether to delete
  data, then runs the uninstall script from a copy of itself in `%TEMP%`. `/silent` with `/server=`, `/serverzip=`,
  `/accept`, `/opengateway`, `/blockoutbound`, `/log=` installs unattended (the VM dry run). `/snapshot=<dir>` saves each
  page as a PNG and installs nothing (tests).
- Updating: a newer installer stops the service, replaces `app`, `node`, `service` and `desktop`, and keeps `host.json`,
  secrets, logs and backups. The version is `package.json`'s, the same the release feed uses as the app's own.

**`Install-RustLegacyHost.ps1` additions** (main's desktop app, boot-task and firewall-copy steps unchanged):
`-ServerDir` with `-AcceptServerBuild` (host.json through `node host/setup.mjs init`, modify rights for the service
account), `-OpenGateway` (inbound TCP for the kit's `node.exe`), `-BlockServerOutbound` (outbound block for
`rust_server.exe`), `-SetupExe`, update in place, and an entry in Windows' list of installed apps.
`Uninstall-RustLegacyHost.ps1 -RestoreServer` runs `node host/setup.mjs undo` before node is deleted.

### Setup's third mode: an existing server, as it is (`host/setup.mjs`, `/api/attach`)

OFFSHOOT-COMPATIBILITY-PLAN.md work item 5. `host/wizard.mjs` MODES gains `attach`, which runs no scripts; the Setup
page shows `host/dashboard/attach.mjs` instead of the stepper.

| Step | What it does |
| --- | --- |
| Your server | `inspectServer(dir)`: rust_server.exe's SHA-256 against `settings.json`; the owner's command line from their `Run Server.bat`; the framework: `stock`, `stock-patched` (our patch already on), `oxide` (finds the `oxide/plugins` folder), `fougerite`, `modded`. A build we do not know runs only after the owner accepts it; its hash goes into `host.json` (`components.server.exeSha256`) with their arguments (`args`). Another folder or build asks for the run confirmation again. |
| Browser ready | Stock: copies `RustLegacyBrowser.Vanilla.dll`, runs `VanillaPatcher check/patch/verify` on the owner's own `Assembly-CSharp.dll`, checks the kept original's hash, writes `<datadir>/cfg/rustlegacybrowser.cfg` (sidecar URL, plugin key, LauncherOnly). Oxide: `RustLegacyBrowser.cs` into `oxide/plugins` and `oxide/config/RustLegacyBrowser.json`; their other plugins are never touched. Every file written is recorded with a copy (`<dataDir>/attach/attach.json`); Undo runs `restore` and puts each file back. Fougerite and unknown builds are refused with the reason (the Fougerite adapter is work item 4). |
| Website | One enrolment code. Central's `POST /bridge/enrol {code, hostKey: true}` now also issues the host app key (audited `host-key-issued`, via `enrolment-code`). The app writes the credential and the key, then `sidecar.json` and `gateway.json` in `<dataDir>/config`, and adds both parts to `host.json`. An older website without the option still enrols; the Accounts page then asks for a key. |
| Address | `none` (loopback: reports in, nobody can join), `proxy` (plain on loopback behind the owner's HTTPS proxy or tunnel; `trustedProxies` loopback or cloudflare), `certificate` (TLS on a public port with their .pfx or PEM, stored in `<dataDir>/secrets`). |
| Run | `components.server.confirmRunOriginalBinaries`. |

Secrets (`control.key`, `plugin.key`, `metrics.token`) are generated into `<dataDir>/secrets`. Changes need the game
server stopped; changes to the parts reload the host in place (`startService({configFile})` keeps the log hub, the
sign-in sessions and the listener).

**Run gate (`host/config.mjs`).** Unchanged for the scripts layout (the boot task when the host is the service, else the
locked-down account with every 05 lock-down row). New: outside the scripts layout, an attached server may also run
under the installed app's own virtual service account (SID `S-1-5-80-…`), with the owner's confirmation and the
verified or accepted hash. Its lock-down is that account (not an administrator; rights only on its data and server
folders) and the optional outbound firewall block.

### Releases and the website

- `host/release.mjs`: the installer manifest
  `{format: 'rlb-installer-1', product, version, file, bytes, sha256, signed, signer?, publishedAt}` in the update feed's
  envelope (`rlb-release-feed-1`), signed with the same project release key. The key was made with
  `tools/publish-release.mjs keygen` on the owner's PC: private `%USERPROFILE%\.rust-legacy\release\signing-62672318-….pem`
  (owner only; back it up, never in git), public `host/release-feed.pub.pem`, which the kit now carries, so the update
  feed is pinned to it by default too.
- `node tools/build-host-installer.mjs --release` with `RLB_RELEASE_KEY` writes `build/host-installer/release/`: the
  installer, its `.sha256` and `latest.json`. It refuses without the vanilla adapter (`--adapter <dir>`, default
  `build/vm-test/adapter`).
- Website: `central/downloads.mjs`, on when central's config has `downloadsDir`: `/downloads/host/latest.json`
  (no-cache), `/downloads/host/RustLegacyHostSetup-<v>.exe` (attachment, immutable), `/download/host` (redirects to the
  current installer, or to the docs page when none is published). The docs page shows a download box (version, size,
  signed or not, date, SHA-256). The owner page shows the enrolment code on its own, for pasting into Setup.

### Code signing: what the owner needs

The build signs when one of these is configured (`tools/code-sign.mjs`, Microsoft's `signtool.exe` from the Windows
SDK): the service wrapper, the desktop app, the patcher and the setup program. Otherwise it builds unsigned and says so,
and so do the installer and the download page.

| Option | Cost (check before buying) | Fits this project? | Configure |
| --- | --- | --- | --- |
| **Azure Artifact Signing** (formerly Trusted Signing) | about USD 9.99 a month (Basic, 5,000 signatures) | Only as an **organisation** in the UK (individuals: US and Canada only); validation may ask for about 3 years of verifiable business history | `RLB_SIGN_DLIB` (Azure.CodeSigning.Dlib.dll) and `RLB_SIGN_DLIB_METADATA` (metadata.json) |
| **OV code-signing certificate** (DigiCert, Sectigo, Certum and others) | roughly USD 150–300 a year | Yes, as an individual or a company. It now comes on a hardware token or a cloud signing service, not as a file | `RLB_SIGN_THUMBPRINT` (the token's certificate in the Windows store) |
| A .pfx file | none | Only an older certificate | `RLB_SIGN_PFX` and `RLB_SIGN_PASSWORD_FILE` |

Also set `RLB_SIGN_NAME` (shown on the download page) and, if needed, `RLB_SIGN_TIMESTAMP`. EV certificates no longer skip
SmartScreen's reputation check, so OV is enough; the warning fades as a signed installer gets downloads. Until then the
installer and the docs tell owners to compare the SHA-256 and choose **More info → Run anyway**.

### Tests

- `tests/host-setup.test.mjs` (5): inspect for every framework and the owner's command line; accepting and recording a
  build; the vanilla patch, cfg, refusal while running and exact undo; the Oxide plugin with their plugins untouched;
  one code against a local website, valid gateway configs, the three address modes, the status.
- `tests/host-release.test.mjs` (3): the signed installer manifest and its refusals; the download route, redirect and
  the page's numbers; unsigned unless configured.
- `tests/host-installer.test.mjs`: the kit's contents; the scripts' dry runs with the new options; **the compiled setup
  program**, built without its administrator manifest, unpacks its kit, checks a fake server with `setup.mjs` and saves
  its pages, installing nothing.
- `tests/host-wizard.test.mjs` (the attach mode runs no scripts), `tests/accounts-links.test.mjs` (one code gives the
  credential and the host key), `tests/host-stack.test.mjs` (the run gate for an attached server and the boot task).

**Not done yet:** the dry run on a clean VM (download → install → Setup → "connected" on `/console`); code signing (a
purchase); the Fougerite adapter; desktop players' UDP port for an attached server (left closed); an automatic
certificate (Let's Encrypt) for owners who have none.
