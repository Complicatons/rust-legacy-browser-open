# Anti-cheat and admin tooling plan

19 October 2026 (slice 2: 20 October 2026; slice 7: 22 October 2026). Private design for free, project-owned anti-cheat and server-admin tooling. Slices 1–8 implemented (see the "Implemented in slice N" sections); the rest is planned. Nothing here was tested against the original server: all checks run against the project mock stack only.

## Principle: trust the server path, not the browser

Browser JavaScript is fully inspectable and editable. Anything that runs in the page (obfuscation, integrity checks, devtools detection, "anti-debug" loops) is at most a speed bump that costs honest players performance and is removed by a cheater in minutes. We do **not** rely on it.

What we do control is everything between the browser and the original server:

```
browser ──(JSON commands)──▶ gateway ──(uLink RPCs)──▶ original Legacy server
                               │  sees every command before it becomes a native message
                               └─▶ central (accounts, bans, roles, evidence, audit)
```

The gateway (bridge/gateway-service.mjs, bridge/game-bridge.mjs) already refuses anything that is not a whitelisted command. Anti-cheat adds a per-player **watch** at that choke point: each command is checked against limits recovered from the original game data, impossible commands are dropped before they reach the server, and every suspicious event is recorded as evidence and scored.

Native desktop clients do not pass through the gateway. For them the original server's own TruthDetector and the operator's existing tools (Oxide plugins, rcon bans) remain the protection; this plan does not claim equal coverage for desktop players.

## Server-authoritative checks in the gateway

All limits come from recovered static data (`browser/assets/recovered/player.json`, `items/manifest.json`), never from the browser. Defaults are baked in so a gateway without the assets still checks.

| Check | Source values | Gateway behaviour |
| --- | --- | --- |
| **Horizontal speed** | CCMotor `maxForwardSpeed 4`, `maxSidewaysSpeed 4`, `maxBackwardsSpeed 3`; HumanControlConfiguration sprint curve 0→1 over 0.4 s, `sprintScalars (0.2, 1)` → 8 m/s forward sprint | Leaky movement budget: credit refills at 8 m/s × 1.25 tolerance (capped at ~1 s of travel so TCP bunching is absorbed). Overspending > 1.5 m flags `speed`. Moves still forwarded (the server's TruthDetector also sees them). |
| **Teleport** | same | One step > 25 m beyond the travel budget flags `teleport` (severity 40) and the move is **dropped**, so the server never sees the jump. |
| **Fly / noclip upward** | `jumpBaseHeight 1` + `jumpExtraHeight 0.5`, controller `m_StepOffset 0.5`, `m_SlopeLimit 65°` | Rise above the lowest point of the last 2 s must be ≤ jump + step + horizontal distance × tan(65°) + 0.5 m. Rising with no matching horizontal travel flags `fly`. |
| **Fall speed** | `maxFallSpeed 80` | Falling faster than 80 m/s × 1.25 flags `speed`. |
| **Under terrain** (optional) | recovered 2049² heightmap | When the operator loads the heightmap, feet > 3 m below the terrain flag `under-terrain` (Legacy has no caves). |
| **Fire rate** | per-weapon `fireRate` (M4 0.125 s, MP5 0.115 s, P250/9mm 0.05 s semi, Bolt 2.2 s, Hatchet 0.9 s, …) via the held item view's datablock UID (ItemRepresentation initialData) | Token bucket per item view, refill 1/fireRate × 1.15, burst 2. A shot without a token is **dropped** and flagged `fire-rate`. Unknown items fall back to a 20 shots/s global cap. |
| **Pellet count** | `numPellets` (Shotgun 12, Pipe Shotgun 8, HandCannon 12; others 1) | More hit records than pellets: dropped, flagged `pellet-count` (severity 50). |
| **No reload** | `maxClipAmmo` | More shots than a clip between reloads flags `no-reload`. The server's own ammo accounting remains authoritative. |
| **Hit range** | `bulletRange` (M4 140, Bolt 250, Shotgun 30 m, …) | Bullet hit on a player view whose last known position (from `ReadClientMove`/create events the gateway already relays) is beyond range × 1.1 + 5 m flags `hit-range`. |
| **Head-shot ratio** | BodyPart enum: Neck 8, Head 9, Scalp 10, Nostrils 11, Jaw 12, Tongue 13–14, Brain 16, Eyes 20–21 | After ≥ 15 player hits, a head ratio > 65 % flags `headshot-ratio` (once per minute). |
| **Command flood** | gateway 60 commands/s | Rate-limit hits flag `command-flood` (low severity). |
| **Wall-shot** (slice 2) | recovered collision (scene colliders, tree colliders, heightmap) + NGC structure pieces; bullet mask `406721553` (layers 0 4 10 12 17–21 27 28) | Each bullet hit on a player is traced from the shooter's eye (player.json eyes 1.65 m standing, 0.87 m crouched) to the target at 0.3/1.0/1.6 m over its last 0.6 s of positions (the shooter sees an interpolated, older target) plus ±0.45 m to the side. Only when **every** pair is blocked: `wall-shot` (25). Flagged, not dropped (stale positions can mislead; the server decides the damage). |
| **Wall-use** (slice 2) | same, bullet mask | `Context:A` queries on NGC entities and players: eye → target +0.5/+1.0 m (and a tracked piece's bounds centre), 0.75 m end margin; all blocked → `wall-use` (20). Doors (prefabs with MovingDoor) are checked only while known closed and settled (slice 7); open or swinging doors are exempt. Scene doors (slice 8): `Context:A` on a manual door view targets the panel's closed-pose bounds (centre, 1 m above its bottom, 0.3 m below its top) with the door's own body ignored, same closed-and-settled rule; detail `targetKind: scene-door`. |
| **Noclip** (slice 2) | TruthDetector trace (old + 0.5 m up → new) with its mask `538444803` (layers 0 1 10 19 20 29) | Every accepted move outside the reset grace is traced the same way; crossing a wall, structure, closed door or the terrain (sampled every 2 m, 0.25 m below the surface) flags `noclip` (30). Not dropped: the server's own TruthDetector rolls it back. |
| **Melee, NGC and animal hits** (slice 7) | bullet mask and wall-shot margins; `MeleeWeaponDataBlock.DoAction1` (server: ignores hits on objects ≥ 6 m from the attacker, no trace) | `melee-hit`, and bullet hits on animals (`:wolf_prefab`…, positions from `GetNetworkUpdate`) and NGC entities (NetEntityID group → `!Ng` carrier), get the wall-shot test: eyes → recent positions at body heights plus side points (animals ±0.9 m), or an NGC piece's bounds centre, root heights and the client's hit point when it lies on the piece (bullet records are entity-local: `ReadHitInfo` `TransformPoint`). `wall-shot` detail names `attack` (bullet/melee/arrow) and `targetKind`. A melee hit > 6 + 2 m away flags `hit-range` with `range: 6`. Players' and animals' client hit points are never sight targets (one on the near side of a wall would clear a hidden target). |
| **Arrows** (slice 7) | `BowWeaponDataBlock.DoAction2` (server: only checks an arrow is in flight); client `ArrowMovement`: speed (Hunting Bow 80, Uber 128 m/s), 5°/s pitch-down, 4 s life | `bow-fire` records origin and rotation per bow; `bow-hit` lands the oldest arrow (≤ 5 s) and traces the arrow's own arc (closed form, chords ≤ 0.25 s) from the origin to its closest approach to the target. Blocked → `wall-shot` (`attack: arrow`, `flight`, `offPath`). A target > 4 m from every point of the path → `arrow-path` (20). An origin > 2 m from every gateway eye at the shot is replaced by the nearest eye (`originOffset`). `bow-miss` lands an arrow without a check. |
| **Doors in the trace world** (slice 7) | `BasicDoor`: NGC doors send a buffered `DOo(open, ms)`; static scene doors send `DOc(open)` on connect and `DOo` to others on toggle; recovered `MovingDoor` durations (wood/metal door, wood gate: 0.3 s open, 0.45 s close) | NGC doors and gates (one box at the closed pose, layer 20) are lent to the shared world like structures, start in their prefab default (closed), follow `DOo`/`DOc` from any session, and block only when closed and settled (close duration − the call's age + 1 s slack). Open, opening, closing or unknown doors never block. Scene doors (32, manual view IDs 3–62 from the scene export) start unknown and follow `DOc`/`DOo` on their view the same way. |
| **Hover** (slice 7) | recovered heightmap + collision world, TruthDetector mask | When the terrain alone says the feet are > 3 m up, one probe ray down through the colliders, structures and closed doors (≤ 1 per 0.25 s) finds the highest surface under them. Above it by > 3 m for 2 s while sinking < 2 m → `hover` (25) with height, seconds, drop and surface. Legacy has no swimming, ladders or vehicles, and the server never moves a character itself. Deployables (boxes, shelters) joined the probe world in slice 8; the 3 m height stays until real traffic says otherwise. |
| **Yaw snap** (slice 2) | send interval = 1 / worldInfo.sendRate | Yaw change > 90° between two moves ≤ 1.5 send intervals apart, followed within 0.35 s by a bullet or melee hit on any target: `yaw-snap` (15) with degrees, timing and `aimError` (snapped yaw vs the target's bearing; ≈0 = landed on the target). Cleared by server-originated positions. |
| **Command rate** (slice 2) | browser command families | Token buckets per session: inventory `ITMV/ITMG/ITSM/ISMV/ITSP` 10/s burst 20, craft `CRFS` 2/s burst 4, `TakeAll` 2/s burst 3, `Context:A` queries 5/s burst 10. Excess is **dropped** (`command-rejected` `command-rate`) and flagged `command-rate` (10) at most once per 5 s. |

Resets: the baseline is reset (2 s grace) on every server-originated position: own `:player_soldier` create (spawn/respawn) and `ReadClientMove` sent to the owner (TruthDetector rollback, admin `teleport.topos`/`toplayer`). The gateway never invents corrections.

**Still planned:**

- ~~The browser does not follow or open scene doors online yet~~ Done 2026-10-23 (`0a70b2c`, `tests/scene-doors-online.test.mjs`).
- ~~Deployables (boxes, shelters, barricades) are not in the trace world~~ Done in slice 8: every `;deploy_` prefab with solid colliders on a masked layer is lent to the shared world like a structure, one body per collider layer (`deployableShapes`), so they block sight, wall-use, noclip and count as ground for hover. Sleepers and loot sacks stay out (they are targets).
- Pitch outside ±89.9° (player.json `_maxPitch`) is already impossible to encode honestly; nothing to add unless the encoding changes.

**Ruled out: server-sampled positions for browser players.** The original `HumanController.GetClientMove` stores the client's origin as is (`character.origin = origin`) unless TruthDetector moves the player back, and then it sends `ReadClientMove` to the owner as well (`RPCMode.Others`). Admin and unstick teleports arrive as `UnstickMove`. The gateway already resets on both. The server runs no movement of its own for characters, so a server-side sample of a browser player (the adapter poll, slice 5) can only repeat what the gateway forwarded, 2 s later. It adds no detection, so browser players stay out of the adapter's position samples.

## Suspicion scoring, evidence and replay

Each player watch keeps:

- **Score**: sum of flag severities with exponential decay (10 min half-life). `review` at 50 (highlighted in the admin page), optional `autoKick` at 150 (operator policy, off by default; a false positive must never silently remove honest players).
- **Evidence**: every flag has `{kind, severity, at, detail}` with the measured numbers (e.g. step length, budget, weapon, interval) so an admin sees *why*, not just a number.
- **Replay buffer**: the last 20 s of accepted moves and shots (positions, angles, weapon, hit targets/body parts). It is attached to the first flag after crossing the review score and to every high-severity flag (≥ 40), capped at 200 samples. This is enough to plot a path or replay a fight in an admin viewer later.

The gateway reports a roster snapshot (subject, name, score, per-kind counts) and new evidence to central every 5 s (`POST /bridge/report`). Central stores evidence durably (`anticheat_flags`) and keeps the live roster in memory.

## Account-level bans enforced centrally

A ban targets the **central account** (the permanent player UUID behind the Steam/Discord sign-in), not a display name, IP or per-server character.

- **Server ban**: blocks that account on one server. Issued by that server's staff.
- **Network ban** (`scope: global`): blocks the account on every server. Platform staff only.
- **Temporary or permanent**: `expires_at` or null; revocable with an audit entry.

Enforcement points (all server-side): join-ticket issuance refuses `banned`; `/bridge/redeem` refuses `banned` even for a ticket issued just before the ban; every gateway report is checked against active bans and banned players in the roster are kicked within one report interval. A cheater therefore cannot re-join any server with the same account, and cannot dodge by switching browser, IP or server.

Ban evasion with a fresh account is the remaining hole. The owner's rule (22 Oct 2026): **everyone can play, cracked desktop players and players without Steam included; Steam is never required by default.** So evasion is made expensive with layered identity instead (slice 6, `central/identity.mjs`, HOSTING-ACCOUNTS-BRIDGE-PLAN §3a):

- **Linked-identity bans.** An active ban covers every identifier the banned account has used: canonical email, Discord, Steam, verified phone, browser device token, desktop hardware ID (all stored as HMACs). At every join (ticket, redemption, desktop pass) central looks for active bans in scope on other accounts sharing one of the joiner's identifiers. A shared hard identifier (email, Discord, Steam, phone, hardware ID) refuses with `identity-banned`; a shared device token only holds with `held-for-review`. Each match is an audited `identity_holds` row; server admins clear holds from server bans, platform staff from network bans; lifting the ban lifts every hold. Sign-ups and links with a hard identifier a network-banned account used are refused outright.
- **Browser device signals** (device token, UA/screen/timezone/WebGL hash, IP hash, hosting/VPN network label) feed **admin "possible alt" notes only**: shared device, shared signals + IP, shared hard identifier, item transfers between accounts under 7 days old (`item-transfer` adapter events from the vanilla adapter's evidence hooks, slice 8), and whether the two accounts were ever online together. They never ban anyone.
- **Per-server opt-in strictness** (join policy): minimum account age, verified phone (`central/phone.mjs`, provider-agnostic; console provider until an SMS provider is chosen), linked Steam, and Steam quality through the Steam Web API (account age, level, VAC bans, game bans, days since last ban; private profiles fail age/level checks; Steam unreachable fails closed for that server only). All shown in the server list's `requirements`.
- Sign-up refuses throwaway email domains (`central/data/disposable-domains.txt`, re-read on change, plus staff additions) and folds Gmail dots/`+tags` so one mailbox is one account.

Device, browser-signal and IP-hash matches still never ban anyone on their own; they only inform a human. Admins can now ban an IP address deliberately (next section).

Desktop players: a server ban can be mirrored to the game server's own ban list (`native: true`). The plugin calls the same `BanList.Add/Save` the original `banid` command uses, with the server identity the adapter maps to that account (a linked desktop character or the browser identity). It never guesses IDs. Lifting the ban queues `BanList.Remove`. Network bans are not mirrored.

## Owner direction (2026-10-24): IP logging and IP bans

> "we need to be able to IP ban cheaters and log IP's" (owner, 2026-10-24)

This replaces the earlier rule that IP addresses are only kept hashed and never banned. Built in `central/ip-bans.mjs`:

- **Logging.** Raw addresses (IPv4-mapped IPv6 folded to IPv4) per account and source: `website` (signed-in pages via `POST /account/device`, and every join-ticket request), `game` (the browser's WebSocket address, which the gateway passes to `POST /bridge/redeem` as `ip`), `launcher` (the launcher's address at `POST /desktop/admit`). Desktop players known only by handle: the server adapters now report `ip` (`netUser.networkPlayer.externalIP`) for each native player. `bridge/adapter.mjs` keeps it for desktop players only (a browser session's native address is the gateway's own) and the gateway report carries it to central's `native_ip_log`. Rows are deleted `ipRetentionDays` after they were last seen (central config `ips.retentionDays`, default 90).
- **Who sees addresses.** Server owners and admins see their own server's `game`/`launcher` and desktop rows. Platform staff also see `website` rows and every server. Moderators see none. The live roster (moderator page) never carries addresses. API: `GET /admin/servers/{id}/ips?player=|handle=`, `GET .../ip-lookup?ip=`.
- **Bans.** `POST /admin/servers/{id}/ip-bans` with `{ip}` (an address, an IPv4 range of /16 or narrower, or an IPv6 range of /32 or narrower), `{player}` or `{handle}` (that player's addresses on this server in the last 30 days), `scope` (`server`, or `global` for platform staff), `minutes` (null = permanent) and a required `reason`; `POST .../ip-unban`. Account bans take `banIps: true` to add the account's game addresses with the same scope and expiry. Admin role minimum, every action audited with the address. Private, loopback, link-local and CGNAT addresses are refused (`unbannable-ip`): the gateway reaches the game server over them, so such a ban would hit every browser player.
- **Enforcement.** A join ticket from a banned address is refused (`ip-banned`), and so is a redemption whose gateway-reported game address is banned. Each gateway report kicks browser players whose latest game address on that server is banned, and queues one `kick-native` per minute for a desktop handle reporting a banned address (actor: the ban's author). A new ban also queues kicks at once for browser players already on a matching address.
- **Limits.** Desktop players who join without the launcher are kicked after they connect (by the next report), not refused at the door: the adapters do not check addresses at approval. Shared connections (households, schools, mobile CGNAT) are banned together, so ranges should be short bans. Oxide IP-ban plugins (Banip and the like) still see the gateway's address for browser players: use the website for those players.



- **Original TruthDetector** (server build, `TruthDetector.cs`, `truth.cs`): speed > 20 m/s (100 m/s falling) adds the speed to `violation`; a blocked movement trace (mask 538444803) adds 100 and rolls the player back; −1 per move; kick when > `truth.threshold` (400) if `truth.punish` (true). Operators should keep `truth.punish true` and may lower `truth.threshold` (e.g. 200). It applies to desktop and browser players alike.
- **Original admin console** (`global.cs`, `teleport.cs`, `RCon.cs`): `status`, `users`, `kick`, `ban`, `banid`, `removeid`, `banlist`, `teleport.toplayer`, `teleport.topos`, `rcon.login`/`rcon.password`. Our admin tools call these through the adapter rather than reimplementing them.
- **Oxide (Legacy) plugins**: community anti-cheat/admin plugins for Legacy (speedhack/wallhack/fly detectors, admin teleport/spectate, ban managers, report systems) remain usable by operators for desktop players. The adapter is planned as an Oxide-compatible plugin or small server patch (BROWSER-SERVER-DECISION.md), so these coexist. We do not vendor or require any third-party plugin; operators choose.
- **Server logs and rcon**: existing log parsers and rcon clients keep working; the gateway adds Prometheus metrics (`/metrics`, aggregate only).

## What we do NOT rely on

- Client obfuscation, minification or "hidden" checks in the browser bundle.
- Devtools/debugger detection, timing traps, focus/blur heuristics, automation detection.
- Client-reported "I am not cheating" signals or self-reported integrity hashes.
- Automatic IP or user-agent bans. IP bans exist since 2026-10-24 (below), but only as a human decision: shared connections and changing addresses make them a supplement to account bans, not a replacement.
- Any automatic permanent ban from heuristics alone: heuristics flag and may auto-kick (opt-in); bans are a human decision with evidence and an audit trail.

## Admin permissions model

Roles are per server, stored in central (`server_roles`); the server owner (`servers.owner_uuid`) is implicitly `owner`. Platform staff (`platform_staff`, set only by direct database action) can act on every server and issue network bans.

| Ability | moderator | admin | owner | platform staff |
| --- | --- | --- | --- | --- |
| Live player list with scores/flags, evidence | ✓ | ✓ | ✓ | ✓ |
| Kick | ✓ | ✓ | ✓ | ✓ |
| Temporary server ban (≤ 24 h) | ✓ | ✓ | ✓ | ✓ |
| Permanent / long server ban, unban | | ✓ | ✓ | ✓ |
| Handle player reports | ✓ | ✓ | ✓ | ✓ |
| View audit log | | ✓ | ✓ | ✓ |
| Grant/revoke moderator | | ✓ | ✓ | ✓ |
| Grant/revoke admin | | | ✓ | ✓ |
| Network-wide ban / unban | | | | ✓ |

Staff cannot ban or kick themselves or anyone of equal or higher rank on that server. Every admin action (kick, ban, unban, role change, report resolution) writes an `audit_events` row with actor, server, target player and reason; the audit log is append-only from the API.

In-game abilities (slice 3) go through the adapter control channel as a fixed action list, never as console strings:

| Action | Role | Plugin implementation (original server APIs, by user ID) |
| --- | --- | --- |
| `teleport-to` (spectate stand-in: Legacy has no spectator mode) | moderator | `RustServerManagement.TeleportPlayerToPlayer(admin, player)` |
| `bring` | admin | `TeleportPlayerToPlayer(player, admin)` |
| `message` (private warning) | moderator | `rust.SendChatMessage(player, "Admin", text)` |
| `ban-native` / `unban-native` | via ban/unban | `BanList.Add`+`Save` (+ kick if online) / `BanList.Remove`+`Save` |

Path: website → central `admin_commands` (audited) → next gateway report reply → adapter queue (subjects resolved to server identities; teleports need the admin's own character on that server) → plugin polls every 2 s → result → adapter outbox → next gateway report → central status (`done`, `failed (reason)`, `expired`, `no-result`). In-game `/report <exact name> <text>` follows the outbox path. It works only for characters mapped to a website account (accountable), once a minute, with the target resolved by user ID when online.

**Desktop players (slice 4).** They connect straight to the game server, so the gateway never sees their moves. Every 10 s the plugin lists connected players (native ID and name) in its poll. The adapter turns each native ID into an opaque per-server **handle** (HMAC-SHA256 of the ID under the control key, 16 base64url characters) and reports desktop players only: browser sessions are already in the gateway roster. Each entry carries the linked website account when there is one. Central and the admin page only ever see handles, never SteamIDs. Admins act by handle: message, teleport-to, bring, `kick-native` (moderator, reason required), and `ban-native`/`unban-native` on the game server's own ban list (admin, because an unlinked desktop player's rank is unknown). A linked desktop character is treated as its account, so rank checks apply. Server-list bans can be lifted later by handle while the sidecar remembers it. After a sidecar restart, an operator uses the original `removeid`.

**Desktop movement scoring (slice 5).** Each poll (about every 2 s) now carries each desktop player's server-side character position: the `Character` transform that `ServerManagement.GetOrigin` reads, plus a `life` id, the character object's instance id, which changes on respawn. Browser sessions are left out. The adapter runs the gateway's `PlayerWatch` on these samples, with `DESKTOP_LIMITS` (movement credit covering 3 s, rise window 4 s): `speed`, `teleport`, `fly` and, with a heightmap, `under-terrain`. A new `life` resets the baseline, so respawns and sleeping bags are not teleports. Flags travel as `desktop-flag` outbox events, by handle, with evidence and replay, into central's `desktop_flags` table. Scores and per-kind counts ride on the desktop roster. Not covered: an admin console `teleport.topos` keeps the same character and can raise one `teleport` flag; positions are what the server accepted, so TruthDetector rollbacks never appear as movement. Shots and hits: see desktop combat (slice 8) below.

The real-server matrix (`tools/check-native.mjs`, system "Admin tools") has rows for every command, `/report`, the desktop panel and the join policy; they pass against the mock stack only.

**Desktop combat checks (slice 8, vanilla adapter only).** The patcher adds read-only hooks in the server's own weapon code: `OnWeaponAction` at the entry of `Bullet`/`Shotgun`/`Melee`/`BowWeaponDataBlock.DoAction1` records each attack's arrival time per player and weapon (with the datablock's `fireRate`), and `OnBulletHit` at the entry of `BulletWeaponDataBlock.ApplyDamage` (reached only after the server's own `ValidatePrimaryMessageTime`, ammo and death checks; shotguns call it per pellet, one fact per target per frame) records hits on players, sleepers and animals: the shooter's server `eyesOrigin`, the target's server position, the client's `endPos`, the body part, `GetBulletRange(rep)` and the server's own line of sight: `Physics.RaycastAll` from the eye to the end point (when within 2.5 m of the target) and to the target at 1.0/1.6/0.3 m (animals 0.6 m) on the bullet mask, ignoring triggers, the shooter, the target and any other character, stopping 0.3 m short. Facts go out with the next poll; `bridge/desktop-combat.mjs` scores them on the desktop player's `PlayerWatch`: `fire-rate` (token bucket on arrival times, refill 1/fireRate × 1.15, burst 3: the server's own check uses the client's timestamps, which a client can space out), `hit-range` (GetBulletRange × 1.1 + 5 m), `wall-shot` (every sight line blocked: blocker name, layer and point from the server's physics, doors and deployables included), `headshot-ratio` (as browser players), and `command-rate` for more than 10/s × window + 20 inventory slot operations (`OnSlotOp` on ISMV/ITSM/ITSP plus ITMV/ITMG: dupe-style split/merge spam). Detail carries `source: server`. Not covered: melee and arrow sight (the server caps melee at 6 m; bow hits go through `TakeDamage.Hurt` without a hook); the Oxide plugin (no matching hooks written). Flags only; nothing is dropped.

Still planned: freeze (no original API). Server-sampled positions for browser players were ruled out (slice 7: the server's character position is the gateway's forwarded move or a rollback the gateway already sees).

## Admin screenshots (slice 6)

RustBuster-style screenshots for browser players. In the browser this is the game canvas plus the HTML HUD drawn over it, never the screen: a full-screen capture would need a `getDisplayMedia` prompt.

- **Request.** Staff of the server (moderator and up, rank rules as for kicks) press Screenshot on a live player: `POST /admin/servers/{id}/screenshot`. One pending per player, 30 s between manual requests per player, 30 per staff member per hour. Anti-cheat asks automatically when a gateway flag reaches the server's `screenshotAutoSeverity` (join policy, default 40 = teleport, pellet-count): one per player per 10 minutes, at most 200 per server per day.
- **Delivery.** Central → `/bridge/report` reply `screenshots:[{id, subject}]` → gateway `service.capture()` → the player's socket `{type:'capture', id}` → `browser/admin-capture.mjs` copies the next rendered frame (same task as the render; the WebGL buffer is not preserved), paints the visible overlays in DOM order, stamps the request id and time in a corner, shrinks to ≤ 1280×720 JPEG ≤ 350 KB → `{type:'capture', id, ok, image, meta}` (the only WebSocket message allowed above 4 KB, and only while that capture is pending) → gateway adds its own pose at request and reply and the latency → `POST /bridge/screenshot`. No prompt for the player.
- **Storage.** `screenshots` + `screenshot_images` (SQLite blobs). Checked as a complete JPEG within 64–1920 px and 400 KB. Kept `screenshotRetentionDays` (default 30) then deleted with a `screenshots-expired` audit entry; failed requests are pruned on the same clock. Requests, every viewer (once per 10 min each) and deletions (admin and up) are audited.
- **Hard to fake cheaply, still not proof.** The page is player-controlled code, so a screenshot is evidence for a human. What raises the cost: requests are unannounced with a one-use id and a 60 s deadline; the id is stamped into the image; the page's camera position and yaw are compared with the gateway's own view (`position ±m`, `aim ±°` tags); identical images are marked as duplicates; blank frames, hidden tabs and slow answers are shown; no answer is itself recorded (`no-response`, `tab-hidden`, `no-frame`).
- Desktop players are not covered (no project code runs in their client).

## Group and player destroys release line-of-sight structures (2026-10-23)

`PlayerWatch.observe` handled only `destroy` kinds `view` and `all`, so DestroyInGroup (the player left a network cell) and DestroyByPlayerID (an owner disconnected) left that session's NGC walls retained in the shared reference-counted line-of-sight world: later shots through the spot could be flagged `wall-shot`, and the 20 000 `maxEntities` filled up over a long session. The bridge now lists the view IDs a player/group destroy removed (`views`, stripped before the page sees the event) and `PlayerWatch.forget` releases each view's entities, positions, items and group mapping. Tests: two in `tests/gateway-hardening.test.mjs` (mock DestroyInGroup through the gateway; player destroy on `PlayerWatch`).

## Implemented in slice 8

- **Item transfers (vanilla adapter).** Hooks (all read-only, `adapter/vanilla/RustLegacyBrowserVanilla.Evidence.cs`, injected by `tools/vanilla-patcher`): `Inventory.ITMV`/`ITMG` before/after (source and destination inventory, slots, item, amount actually moved, the looter), `DropHelper.DropItem` (a dropped `ItemPickup`), `DropHelper.DropInventoryContents` (death sack), `ItemPickup.PlayerUse` before/after. Each side names its owner when it is a player's own inventory (`Character.netUser`) or a sleeper (`SleepingAvatar.creatorID`). Facts ride on the next poll (`moves`, at most 300 per poll; `lost` counts overflow). `bridge/item-transfers.mjs` stamps container slots with the player the items came from (a deposit, a drop, a death sack; moving them between boxes keeps the origin), and items from player A reaching player B's own inventory become one `item-transfer` outbox event `{from?, to? (accounts), fromHandle, toHandle, fromName, toName, item, amount, via: container|drop|corpse|sleeper|direct}`. Location-based: a shuffle inside a container (ISMV) loses the stamp; stamps expire after 6 h (50 000 kept). Central logs every event in `item_transfer_log` (by account and/or handle), still adds account-to-account ones to `item_transfers` (alt links between new accounts), and serves `GET /admin/servers/{id}/transfers[?player=|?handle=]` (moderator and up). Admin page: an Item transfers panel and an Item transfers list in Evidence (browser and desktop players).
- **Desktop combat checks** (vanilla adapter): see "Desktop combat checks (slice 8)" above.
- **Deployables in the trace world (gateway).** `loadLineOfSight` builds `deployables` (handle → one def per collider layer, layers outside both masks dropped): boxes, large storage, shelters, barricades, spike walls, gateways, workbench, repair bench, furnace, bed, window bars (layer-20 bars for bullets, layer-29 PlayerClip box for TruthDetector's mask only), stash, sleeping bag, fires. `retain` lends them like structures (`what: deployable`, the entity's own bodies ignored for its own checks); they count against `maxStructures`. Tests: two in `tests/anticheat.test.mjs` (synthetic bars and box: mask per layer, ground probe on a box top, a wall-shot through bars; the recovered prefabs and a large wood storage box).
- Sidecar poll body limit 256 KB. `adapter.stats().evidence` counts the last poll's facts.
- Tests: `tests/item-transfers.test.mjs` (tracker: box, drop, death sack, sleeper, box to box, expiry, bounds; sidecar poll → events by account and handle; central log, staff route, alt link), `tests/desktop-combat.test.mjs` (fire rate on bunched and rapid arrivals, range, server sight, head-shot ratio, inventory spam, adapter events by handle, and a source check that the patcher passes every evidence hook exactly the parameters its C# signature takes). Built: `dotnet build adapter/vanilla -c Release` against the server's reference assemblies (0 warnings); the patcher's `check`, `patch` and `verify` run on a scratch copy of those assemblies (21 sites) and the patched methods decompile (ILSpy) as intended. Never run on a server; the VM test copy must be restored and re-patched to get the hooks.
- Wall-use on scene doors: `LineOfSight.sceneDoorTarget(viewId)` (panel points and closed state) and `blocked({ignoreBody})`; `PlayerWatch.sceneDoor` resolves a `Context:A` on a manual door view that no create event placed. Tests: two in `tests/anticheat.test.mjs` (synthetic door behind a wall, open/closing/unknown exempt, own panel never the blocker; the recovered BlueDoor_94 through the warehouse roof). Mock/unit only.

## Implemented in slice 7

- `bridge/line-of-sight.mjs`: NGC doors and gates (`doors`: the three recovered `MovingDoor` prefabs) and scene doors with a known view ID (`sceneDoors`) in the shared trace world; `ngcDoor`/`sceneDoor` set state from `DOo`/`DOc` (age from the call's ms stamp and the server clock), `doorBlocks` (closed and settled + 1 s `doorSlack`); hits report `blockedBy: door`. `groundBelow` (terrain plus one downward ray), `center`, `near`, `localToWorld` for tracked pieces. The loader builds scene door bodies only for doors with `viewID`. `useExempt` is gone.
- `bridge/anticheat.mjs`: `resolve` (players, animals, NGC entities by carrier group), `sightTargets`, `hiddenHit` (wall-shot for bullets, melee and NGC/animal targets), `meleeHit` (6 m server reach), `arrowLanded` with the exported `arrowPath`, `hover`; new kinds `hover` (25) and `arrow-path` (20); limits `hover*`, `melee*`, `arrow*`, `originSlack`, `pointSlack`; `weaponsFromItems` reads `arrowSpeed`.
- `tools/export_scene.py`: records each door's manual view ID (`doors[i].viewID`). Re-run 2026-10-22 (`RLB_EXPORT_OUT` to a fresh folder; only `scene/manifest.json` changed: 32 `viewID`s, nothing else): all 32 doors have one, the gateway loads 32 scene door bodies, and `tests/anticheat.test.mjs` drives a real one (BlueDoor_94, view 38) through `GameBridge` and `PlayerWatch`.
- Tests: five more in `tests/anticheat.test.mjs` (doors, melee, NGC/animal bullets, arrows, hover); the recovered-world test also places a recovered wooden door.
- Cost: one probe ray per 0.25 s while airborne high; a melee check costs the same rays as a wall-shot check; an arrow check costs one ray per 0.25 s of flight. All come out of the same per-session ray budget.
- Not tested against the original server or real play; thresholds (hover 3 m / 2 s / 2 m, arrow 4 m, melee 6 + 2 m, door slack 1 s) need real traffic. `autoKick` stays off.

## Implemented in slice 6

- `central/identity.mjs`, `central/phone.mjs`, `central/steam-quality.mjs`, `central/screenshots.mjs`; new tables in `central/db.mjs` (identifiers, device_sightings, identity_holds, blocked_email_domains, play_sessions, item_transfers, screenshots, screenshot_images) and policy columns.
- Routes: `POST /account/device`, `POST /account/phone/start|verify`, `GET .../alts?player=`, `GET .../holds`, `POST .../clear-hold`, `POST .../screenshot`, `GET .../screenshots`, `GET /admin/screenshots/{id}/image`, `POST /admin/screenshots/{id}/delete`, `GET|POST /staff/email-domains`, `POST /bridge/screenshot`; `POST .../policy` takes the new fields.
- Gateway: `capture()` and the capture message in `bridge/gateway-service.mjs`; upload in `bridge/gateway-launcher.mjs` and `bridge/remote-account.mjs`; `rlb_gateway_screenshots_total`.
- Browser: `browser/admin-capture.mjs` and three lines in `browser/main.mjs`. Website: `site/js/device.mjs`, account phone section, server-list requirement tags, admin Screenshots / Linked-account holds / Possible alts / extended Join policy / staff email domains.
- Tests: `tests/identity.test.mjs`, `tests/screenshots.test.mjs`.

## Implemented in slice 5

- Both adapters send desktop players with `pos` and `life` on every poll (sidecar body limit 128 KB).
- `bridge/adapter.mjs`: `watchDesktop` (a PlayerWatch per desktop player on the sample clock, forgotten when they leave), `DESKTOP_LIMITS`, `desktop-flag` events, and `score`/`flags` on `desktopRoster()`; `desktopAnticheat: false` turns it off.
- Central: `desktop_flags` table, `GET /admin/servers/{id}/desktop-flags?handle=`, and score/flags/review on desktop rows.
- Admin page: Score and Flags columns and Evidence for desktop players (replay plot included).
- Tests: two more in `tests/admin-commands.test.mjs` (adapter scoring with respawn and teleport, central evidence), plus a site-check step.

## Implemented in slice 4

- `bridge/adapter.mjs`: `setRoster`, `desktopRoster` (handles, 30 s staleness, bounded handle map), commands by `handle`, `kick-native`. The sidecar accepts `players` in the plugin poll (body limit raised to 64 KB).
- Both server adapters: `adapter/RustLegacyBrowser.cs` (Oxide) and `adapter/vanilla/RustLegacyBrowserVanilla.cs` (patched DLL, starts on its first hook call) send the player list every fifth poll and run the same command set. The vanilla adapter also gained the admin poll, the commands and `/report`. Oxide type-checks with the stub project; vanilla builds in Release against the server reference assemblies. Neither has run on a server.
- Gateway forwards the adapter's desktop roster in each report. Central adds a `native_commands` table, `desktop` in `GET .../players`, and handle targets in `POST .../command`; the command list merges both tables.
- Admin page: Desktop players panel (Message, Go to, Kick, Ban), desktop-specific action form, Lift for server-list bans in In-game actions.
- Tests: three more in `tests/admin-commands.test.mjs` (adapter handles, central roles/lift, full stack), plus site-check steps. A fourth reads both adapter sources and checks they handle exactly `ADMIN_ACTIONS`, make the same original calls per action and return the same failure reasons, so the two cannot drift apart unnoticed (neither can run on the host).
- Request ordering (2026-10-21): the sidecar refuses a `seq` at or below the last one, so both adapters now queue their sidecar requests and keep one in flight, stamping `seq` as each one goes out (vanilla: one ThreadPool sender with blocking requests; Oxide: the next request starts from the previous reply callback). Before this, a poll, a command result and an approval sent close together could overtake each other and the earlier-numbered one was refused. At most 256 requests wait; beyond that a request fails at once. Pinned by a source test in `tests/admin-commands.test.mjs`; the refusal itself is tested in `tests/sidecar.test.mjs`.
- Admin teleports and the gateway (2026-10-21): `RustServerManagement.TeleportPlayerToWorld` (Go to, Bring, the `teleport` console command) sends `UnstickMove` on the ServerManagement view, not `ReadClientMove` on the character, and `PlayerWatch` only reset its movement baseline on the latter. A teleported browser player's every later move was dropped as `teleport` (+40 each), so they froze and, with auto-kick, were kicked. `PlayerWatch.observe` now resets on `UnstickMove` too (`tests/anticheat.test.mjs`). The matrix's `admin.teleport-to`/`admin.bring` rows now walk the players 30 m apart (past the 25 m drop limit), walk on after arriving and fail on any new movement flag; they failed before the fix (32 teleport flags) and pass after it. For desktop players (slice 5 scoring from 2 s server samples), the adapter marks the character it hands a Go to/Bring to the plugin for, and its next sample becomes the new baseline instead of a scored move (`tests/admin-commands.test.mjs`). A teleport by the original `teleport` console command on a desktop player is still scored as a jump.

## Implemented in slice 3

- `bridge/adapter.mjs`: `ADMIN_ACTIONS`, command queue (60 s TTL, 100 max, delivered once), outbox (results, reports), `/report` rules; `bridge/sidecar.mjs`: plugin `poll`, `command-result`, `report`.
- `adapter/RustLegacyBrowser.cs`: 2 s poll loop, `RunCommand` with the APIs above, `/report`. Type-checked with `dotnet build adapter/compile-check -p:RefDir=analysis/server-audit/rust_server_Data/Managed`; never run on a server.
- Gateway report loop drains the adapter outbox into `/bridge/report` and forwards returned commands; undeliverable commands come back as failed results.
- Central: `admin_commands`, `server_policies`; `POST /admin/servers/{id}/command`, `GET .../commands`, `GET|POST .../policy`; `native` bans; in-game reports stored as reason `in-game`; policy checks on tickets and redemption.
- Admin page: Go to / Bring / Message actions, native-ban checkbox, In-game actions table, Join policy form.
- Tests: `tests/admin-commands.test.mjs` (adapter, central, full stack with the plugin played by the test); `npm run test:site` drives the new controls.

## Implemented in slice 2

- `bridge/line-of-sight.mjs`: one gateway-wide `LineOfSight` shared by every session. `loadLineOfSight(recoveredDir)` puts the recovered scene colliders on layers inside both server masks into the static `CollisionOctree` (other masked layers become their own bodies; `MovingDoor` colliders are left out), the tree colliders (`GridBody` + capsules, optional with `trees:false`), the 2049² heightmap and the 16 recovered structure prefabs (shapes shared by all instances). NGC structure pieces seen in `ngc-create` are reference-counted across sessions in a 16 m x/z grid and released on `ngc-destroy`, carrier destroy or session end, so the world never keeps a piece that no connected session knows about. Queries take Unity points and return `{what: world|terrain|structure, distance, total, at}`.
- `PlayerWatch`: `wall-shot`, `wall-use`, `noclip`, `yaw-snap` and `command-rate` as in the table above. `tools/gateway.mjs` loads the world when `recoveredDir` is set (`anticheat.lineOfSight:false` / `anticheat.trees:false` opt out); the gateway passes the server's send interval and disposes each watch on disconnect.
- **Bounded cost per session:** a ray budget (80 rays/s, burst 160; one wall-shot check is at most 2 eyes × (3 heights × trail points + 4 side points), and pellets on one target share one check). When the budget runs out the check is skipped (`losSkipped`), never guessed. NGC entity positions are capped at 20 000, target trails at 8 points / 0.6 s, plus four fixed rate buckets. Measured on the recovered island: load about 2.5 s, about 0.5 GB RSS with trees (0.36 GB without), 15–50 µs per ray.
- Tests: `tests/anticheat.test.mjs` (masks; segments vs wall, terrain and structures; structure refcount and cap; wall-shot with interpolation trail and ray budget; wall-use with the door exemption; noclip vs a wall and a terrain ridge; yaw-snap with expiry and reset; rate buckets; recovered world: warehouse roof and a recovered foundation) and `tests/anticheat-stack.test.mjs` (mock stack: a shot through a wall and inventory split spam reach the admin's evidence; over-rate splits never reach the native server).
- Not tested against the original server or real play: thresholds and margins need tuning with real traffic; keep `autoKick` off until then.

## Implemented in slice 1

- `bridge/anticheat.mjs`: limits derived from recovered player/item data, `PlayerWatch` with movement budget, teleport (dropped), fly rise, fall speed, optional under-terrain, per-weapon fire rate (dropped), pellet count (dropped), no-reload, hit range, head-shot ratio, command flood; decaying score, evidence ring, replay buffer.
- Gateway: watch per in-game session; dropped commands answer `command-rejected`; `kick(subject)`; roster/evidence reporting to central with kicks in the reply; optional `autoKick` policy.
- Central: `server_roles`, `platform_staff`, `bans`, `anticheat_flags`, `player_reports` tables; `/admin/...` API (players, flags, kick, bans, unban, roles, audit, reports) with the permission matrix above; `/servers/{id}/reports` for players; ban checks on join tickets, redemption and live rosters; `/bridge/report`.
- Site: `/admin` page listing your servers, live players with score/flags, evidence, kick/temp/perma ban, bans with unban, reports and the audit log.
- Tests: `tests/anticheat.test.mjs` (detector units), `tests/admin.test.mjs` (central roles/bans/audit/reports), `tests/anticheat-stack.test.mjs` (full mock stack: teleport and fire-rate flags reach the admin list, kick disconnects the browser, ban blocks re-join).
