# What is left before the port is 100 %

One list per area of `site/content/progress.json`. Sources: `PORT-COVERAGE.md` (class ledger: 0 open), `GAP-AUDIT.md`, `SERVER-TESTING-PLAN.md`, `ANTICHEAT-ADMIN-PLAN.md`, `HANDOFF.md`. Started 2026-10-22; keep it current: when an item is done, mark it with the commit and update the area's figure in `progress.json`.

Who can do it: **A** an agent session, **O** needs the owner (decision, account, hardware or a step on the VM), **B** blocked (no source or no way to measure here).

Order of work (owner rule): game-breaking first, then big systems, then small bugs.

## Plan to 100 % (2026-10-23; this week)

Agent work runs in fresh sessions/agents, 3–4 at once; owner steps are the one list at the top of HANDOFF.md "Owner steps still needed".

| Area (now) | What closes it | Who | When |
|---|---|---|---|
| First real server (50) | P5 rows all pass on the VM (combat.death with the 30 s sack lock, build-gated rows); P6 two-browser rows (pass since walk-to-meet `ae3052f`); P7 cheat tests from a modified browser + truth.enforce, no false positives; P8 soak on the new movement; P9 write-up | A (gameplay-rows, vm-scale-tests, a P7 cheat-harness agent) | Now, on kit `rlb-kit-update-20261023-090004` |
| | P5 admin rows, P6 desktop client, P7 console kick/ban | O: HANDOFF owner steps 1–2 | When the owner does them |
| | First public server on the OVH game VPS | O says go, then the hosting session (runbook phases 2.5–7) | After P5–P8 pass |
| Online play (90) | Fix everything the P5–P8 runs find; G7 proven by those runs | A | Rolling |
| Anti-cheat and admin (70) | P7 data → thresholds tuned (flag-only stays until real players); desktop-player screenshots stay impossible (no project code in their client) | A, then O with real players | After P7/P8 |
| Performance and polish (75) | Release-readiness audit + fixes (running); iGPU numbers | A; B (owner's laptop) | Now |
| World and graphics (92) | Native-frame comparisons: W5 lighting, terrain detail meshes, engine particle rules | B until the owner's desktop client runs in the VM (owner step 2), then A captures and compares | After owner step 2 |
| Survival/wildlife (95), Building (93), Combat (92), Menus (97) | Third audit round (sounds, effects, third-person animation) + fixes; anything the P5/P6 runs show | A | Now |
| Website (85) | Email, Steam/Discord sign-in, map credit/place names | O (owner steps 3–4) | When the owner does them |

## First real server (SERVER-TESTING-PLAN P1–P9)

P1 baseline, P3 handshake and P4 first browser join passed on the Azure VM (2026-10-21).

| Item | Who | Status |
|---|---|---|
| P5 gameplay matrix: every row run against the original server, failures filed or fixed | A | Clean rerun on a quiet VM 2026-10-29: 11 pass, 1 skip (`move.fall`, needs rcon), 0 error — `join.facing` (GAP-AUDIT A4-5) confirmed live, not just the mock. `analysis/native-runs/2026-10-29-gameplay-real-single-f/` |
| P5 admin rows (Go to/Bring/Message, `/report`, website ban → server, join policy) | O | Needs the rcon password and an admin role for the test account on the VM's website |
| P6 two browsers see each other (position, animation, held items, deaths, chat, voice) | A | Done 2026-10-29: clean rerun on a quiet VM, 8 of 8 pass (`join.website,mixed.*,combat.*`); the earlier "no copy of the other player" run was VM load, not a regression. `analysis/native-runs/2026-10-29-gameplay-real-two-o/` |
| P6 browser + native desktop client | O | Owner runs the desktop client in the VM |
| P7 `truth.enforce` on + gateway checks: no false positives in normal play; deliberate cheats flagged; kick/ban from admin page and server console | A + O | Cheat and clean rows automated (`p7.*`, SERVER-TESTING-PLAN P7): 11/11 on the mock, 0 flags in 3 min of normal play, hover edge false positive fixed. VM run needs the kit with the fix, rcon (range rows) and a moderator role for the test account; console kick/ban steps need rcon |
| P8 soak: bots for 1–3 h, reconnect cycles, flat memory/CPU, no server errors; then bad-network runs | A | **Done 2026-10-29** (build 314a5bc, SERVER-TESTING-PLAN.md "Soak on build 314a5bc" + "Bad network re-confirmed on build 314a5bc"): 2 h clean soak (0 drops, 0 corrections); bad-network re-run at +100/+250/+500 ms RTT with 1/2/5 % loss — 0 drops, 0 kicks, 6/6 reconnects eventually succeeded, inventory unchanged after rejoin. Matches the 22 Oct baseline on the current build |
| P9 write-up: findings into HANDOFF.md and GAP-AUDIT.md | A | After P5–P8 |
| First public server on the game VPS (OVH, Windows Server 2022) | O + A | Untouched; hosting runbook phases 2.5–7 |

## Online play

| Item | Who | Status |
|---|---|---|
| G7 server-side combat/building/survival rules online | A | Proven only by the P5 run above |
| Fixes for whatever the P5/P8 runs find | A | Open until the runs end |
| Static scene doors online: the browser follows DOc/DOo on the 32 manual door views and opens them with Context:A on that view | A | Done 2026-10-23 (`tests/scene-doors-online.test.mjs`; mock/unit only, not run against the original server) |
| Third-person and online timing O1-O7 (GAP-AUDIT 2026-10-23): one server clock for snapshots and timed events, death hit boxes off at arrival, old held representations until InterpDestroy, held items kept until RAG, local death ragdoll from the animated pose, censor rebinds corpses, first move after Create not a goal | A | Done 2026-10-23 (`tests/online-timing.test.mjs`; unit only; check on the next P6 two-browser run) |
| Audit round 5, online message coverage (GAP-AUDIT A5-1-A5-18, ONLINE-RPC-COVERAGE.md): every RPC the original client receives and sends checked; ClientFirstReady after the world loads, remote torch/flare light from Action2/3, RigidObj on the server clock, SVUF on our Create, correction look | A | Done 2026-10-29 (6 Fixed, 11 Faithful, 1 Open: A5-17 late events dropped by design; A5-18 RigidObj Create hiding fixed, see HANDOFF); mock/unit only, not yet on the original server |
| `npm run test:online` stopped at `check-online.mjs:200` (door "Close" use-hint never showed), also on `da46b21` | A | Done 2026-10-23 (`4f33fd9`): test geometry after the terrain diagonal fix (spawn ground 367.97 -> 368.43 m put the door past ContextProbe's 3 m ray), not a port bug; the check's cancel-craft step updated to the original (E5). Passes end to end, remote-death steps included |

## Anti-cheat and admin tools (ANTICHEAT-ADMIN-PLAN "Still planned")

| Item | Who | Status |
|---|---|---|
| Hover detection with a collision-world ground probe (structures make terrain-only checks unreliable) | A | Done (`58285a8`, slice 7; mock/unit only) |
| Line of sight for melee hits, arrows (`bow-hit` after flight) and hits on NGC targets/animals | A | Done (`58285a8`, slice 7; mock/unit only) |
| Doors in the trace world: scene `MovingDoor` colliders and NGC doors/gates once their state is followed | A | Done: NGC doors/gates (`58285a8`); scene doors 2026-10-22: `scene/manifest.json` re-exported with all 32 doors' manual view IDs (3–62), loaded as 32 door bodies and driven by DOc/DOo (unit test on BlueDoor_94, view 38; mock/unit only) |
| Wall-use check on scene doors: Context:A on a manual door view resolves to no tracked position, so `PlayerWatch.context` skips it (the door bodies are in `LineOfSight.sceneDoors`) | A | Done 2026-10-23 (slice 8): `PlayerWatch.sceneDoor` resolves the view to its panel (`LineOfSight.sceneDoorTarget`), traced while closed and settled, the door's own panel ignored (`tests/anticheat.test.mjs`, synthetic + BlueDoor_94; mock/unit only) |
| Deployables (boxes, shelters, barricades, benches, window bars) in the trace world: they blocked neither sight nor counted as ground for hover | A | Done 2026-10-23 (slice 8): lent to the shared world like structures, one body per collider layer (`tests/anticheat.test.mjs`; mock/unit only) |
| Server-sampled positions as an extra check for browser players | A | Ruled out (`58285a8`): the server stores the client's move as is; its only own positions (rollbacks, teleports) already reach the gateway |
| Thresholds tuned with real traffic before automatic kicks | A + O | Needs P7/P8 data, then real players |
| Freeze (no original API); desktop combat checks (server-side hooks) | B / A | Freeze: no original API. Desktop combat done 2026-10-23 (slice 8, vanilla adapter): fire rate on arrival times, hit range, the server's own line of sight and head-shot ratio from hooks in `DoAction1`/`ApplyDamage` (`tests/desktop-combat.test.mjs`; built and patched on a scratch copy, never run on a server; VM test copy needs re-patching; Oxide plugin not done) |
| SMS provider; server plugin `item-transfer` events; screenshots of desktop players | O / A / B | Provider is the owner's choice; desktop client has no project code. `item-transfer` done 2026-10-23 (slice 8, vanilla adapter): slot moves, drops, death sacks and pickups → sidecar provenance → central log, alt links and an admin Item transfers view (`tests/item-transfers.test.mjs`; never run on a server; VM test copy needs re-patching; Oxide plugin not done) |

## Performance and release polish

| Item | Who | Status |
|---|---|---|
| Join: "loading shared" stage, serial `await`s in `main.mjs` loops (deployable/resource prefab parts, `createAnimalRenderer`) | A | Done: queued per loop (`ef8c4e4`), now queued right after the scene import with clips/navmesh/Rapier (HANDOFF "Join: the shared templates' files load during trees and collision", 2026-10-22): stage 1.3–1.7 → 0.35–0.43 s warm |
| Join: scene import and tree stage (largest loopback stages), "Preparing shaders", collision | A | Scene import done (`d09a9b1`). Rest measured and ruled out (same entry): collision ~0.55 s is the exact octree build on the main thread; "Preparing shaders" has ~16–40 ms of program-status wait left; a 12-wide prefetch queue was inside the noise |
| Versioned CSS `url()` sprites in `hud.mjs`/`rpos.mjs`/`frontend-skin.mjs` (2 revalidations per join) | A | Done (`d09a9b1`, `cssUrl`): 0 revalidations per warm join |
| HTTPS (HTTP/2, service worker) on the public site | O + A | HTTPS/HTTP/2 via Cloudflare + Caddy (live). Service worker decided against 2026-10-23 (GAP-AUDIT R12): warm joins already download 0 MB from immutable versioned URLs |
| P5 integrated-GPU numbers | B | Needs an iGPU machine (owner's laptop) |
| Release readiness audit, game (GAP-AUDIT "Release readiness 2026-10-23" R1, R6, R9-R16, R22-R24) | A | Done 2026-10-23: no-WebGL 2 and failed-start panel, GPU-reset panel after 10 s, game page never framed, Basis worker revalidates; measured cold join 19.9 s / warm 2.8 s (0 MB), every quality preset 1.1-8.0 ms mean frame on the RTX 4090 with 0 hitches, 10-min soak heap 131.5 → 141.6 MB flat, listeners flat |
| Phones / tablets: the original menu is cut off at 390 px (dfGUI height scaling) | O | Parked until the game is finished (owner); measured in R22 |

## Original world and graphics

| Item | Who | Status |
|---|---|---|
| W5 deferred-lighting parity | B | Needs frames from the original client |
| World clocks under 20 fps: time of day, clouds, water and ambient/music fades used the 0.05 s movement step | A | Done 2026-10-23: own `worldDt` (Unity deltaTime, 1/3 s maximum) |
| Water reflection mirrored about the surface instead of surface + clipPlaneOffset (PlanarReflection.RenderReflectionFor) | A | Done 2026-10-23 (`water4.mjs`) |
| Terrain LOD by `heightmapPixelError` 30 (screen-space error) instead of fixed distance rings (`terrain-lod.mjs`) | A | Done 2026-10-23 (`ce10cb0`): per chunk/level max height error vs full resolution, coarsest level within 30 px at the camera's FOV and viewport height, heightmapMaximumLOD 0; `tools/check-terrain-lod.mjs` |
| Unity terrain detail meshes (Tallgrass 3/13): TerrainControl.ReassignTerrainData restores detailObjectDistance 134.6 about 2 s after FPGrass zeroes it, so they are probably drawn in the original | A + B | Open (L): confirm with a native frame first; placement inside patches is native |
| Laser beam, remaining particle approximations (whats-coming) | A | **Done 2026-10-23** (laser: `LaserGraphics.RenderBeam` geometry, both dot quads, range colours, the shipped LaserBeam/LaserDot programs with BlendOp Max, first-person `V_MUNITY_MATRIX_P`, Alpha8 mip chains; flashlight radial/remote spot in the view-model pass; soft-particle depth without the forward-only tree leaves/billboards; (Front) view-model particles' ZTest Always confirmed from source). `tools/check-laser.mjs` PASS on GPU |
| Particle/laser rules in native engine code: legacy ParticleAnimator sizeGrow/damping and EllipsoidParticleEmitter radii, Shuriken death sub-emitter bursts, Color→ColorRGBA32 rounding | B | Needs native frames (no managed source); everything else in the laser and particle code is ported from source |

## Survival, gathering and wildlife

| Item | Who | Status |
|---|---|---|
| G6 NavMeshAgent native constants (crowd avoidance, detail heights) | B | No source (Unity native) |
| Wildlife/survival pass W-1–W-9 (online slope tilt, Warm plaque latch, chicken/wolf materials, attack clips, `pull_out`, online death timing and goal, move-clip speed, sounds following animals, `wildlife.hunt` row) | A | Done 2026-10-23 (GAP-AUDIT "Wildlife and survival pass"; unit tests + mock stack; not run against the original server) |
| `wildlife.hunt` rerun on the VM with the crouched approach | A | Done 2026-10-29: passed on the quiet-VM rerun (rabbit, 2 hits, harvested). `analysis/native-runs/2026-10-29-gameplay-real-single-f/` |
| Player movement rules (GAP-AUDIT P3-14/P3-14b): slope speed, sprint cancels, jump buffer/cooldown, airborne clears, landing penalty, crafting slow, air blend, too-steep sliding, idle timers, movement flag | A | Done 2026-10-23 (`290d229`; `tests/motor-rules.test.mjs`; node + offline GPU `test:motor` only, not yet against the original server) |
| Audit round 4 (GAP-AUDIT "Audit round 4, 2026-10-23" A4-1-A4-24): offline save loads like a server start (deployable decay no longer frozen after a reload, bases keep their decay delay instead of a full reset, fires and bag cooldowns restart), the held Torch burns 1 use/s, a new character looks along its spawn rotation (offline and online), metabolism/bleeding/food/drowning ignore armour, HUD food/rads/plaques at the 2 s tick, no calories for swings rejected at 6 m | A | Done 2026-10-23: 8 fixed, 16 faithful (metabolism, radiation, warmth, falls, cooking, research kit, respawns, loot, resource nodes, airdrops, environment, sleepers, death sacks, save contents); `tests/audit-round-4.test.mjs`, `npm run test:audit-round-4`; online spawn facing confirmed on the original server 2026-10-29 (`join.facing` row, see HANDOFF) |

## Building and raiding · Weapons and combat

No open client items (GAP-AUDIT rounds closed). What remains is the online proof in P5.

| Item | Who | Status |
|---|---|---|
| GAP-AUDIT "Sounds and effects, 2026-10-23" S1–S9 (melee impact effects incl. WoodImpact on trees, Explosion1/signal smoke/flare rolloff and loops, disabled WoodPile_Death source, equal-power panning, SoundPool 2 × max cull for mod clicks, attached gunshots and mod clicks, Uber Hatchet/Hunting Bow held models) | A | Done 2026-10-23: 9 fixed (unit tests; WoodImpact and the Uber arrow rendered). Left: the Uber Hatchet held-rep hum loop; in-game listening of the rolloff changes |
| GAP-AUDIT round 2026-10-23 C1–C12 (PlayerClip layer, offline death ragdoll and camera, melee deploy/AltFire, pellet tracers, fire pitch, shotgun wildlife, grenade force on corpses, effect point, tracer push range, bow punch, remote InterpTimedEvents) | A | Done 2026-10-23: 11 fixed, C12 faithful as shipped. C11 (remote actions, InterpDestroy, RAG, DMG on the interpolation clock) only unit-tested; check in the P6 two-browser run |
| Offline building/deployable rules: small spike wall capsule, spike damage back to melee/arrow attackers, 5 m radial check on placed containers, fire out 0.25 s after its fuel is taken, repair bench window labels/button, no client placement notice, decay rays over the whole collision world with the Door tag id, no carrier touch on placement, door direction in offline saves | A | Done 2026-10-23 (GAP-AUDIT B1–B9; unit tests, repair bench window checked rendered offline) |

## Menus, HUD and social

| Item | Who | Status |
|---|---|---|
| Menus, HUD, console and chat C1-C10 (chat and F1 console usable over RPOS, F1 console from boot with LoadingScreen lines, belt keys with RPOS open, drag-only cells, no Tab/belt behind the menu or while loading, Escape as MainMenu.Update/HumanController, tooltip at the cursor, drag on first move, console without history/clear/trim and with CaptureLog colours, Unity yellow) | A | Done 2026-10-23 (GAP-AUDIT "Menus, HUD, console and chat, 2026-10-23"; `tests/menus-hud-console.test.mjs`; client only, not yet on the original server) |
| UI edge cases U1-U13 (held keys through RPOS/chat/console, cursor relock on RPOS/console/lock entry/respawn, item menu on its own item, focus loss is not Escape, death reason markup, online belt gate, HUD belt click gate, drag vs GNUP, chat IME, stale context selection, lock entry kept while dead, context popup re-centres, popup caps) | A | Done 2026-10-23 (GAP-AUDIT "UI edge cases, 2026-10-23"; `tests/ui-edge-cases.test.mjs`, `npm run test:ui-edge-cases`) |
| Items, crafting and inventory I1-I7 (blueprints kept on death, active item put away when moved/tossed/used up/broken, no Take all, furnace loot window online, FindItem largest-stack-first for reload/arrows/repair, research kit workbench grace, craft panel without title or disabled Craft) | A | Done 2026-10-23 (GAP-AUDIT "Items, crafting and inventory, 2026-10-23"; `tests/items-crafting-gaps.test.mjs`; mock stack, not yet against the original server: next P5 run should drag loot out of a box and a death sack) |
| Item edge cases E1-E6 (reload gives the Rock back, save keeps only the avatar vitals/items/blueprints, held gun re-drawn after a mod, melee wear on crates/sacks/pickups, online cancel crafting clears at once, transientMode items never dropped/moved/saved; E7 the held weapon stays out behind RPOS/chat/console) | A | Done 2026-10-23 (GAP-AUDIT "Item edge cases, 2026-10-23"; `tests/item-edge-cases.test.mjs`; E3 rendered check passed 2026-10-23, `npm run test:item-edge-cases`; E7 found by it and fixed: a window no longer puts the held weapon away) |
| M3 close-button tweens and UIButton colours | A | Done 2026-10-22 (`1dd09e7`; the 'still open' line in HANDOFF's 2026-10-21 round predates it). Fire/loot/repair close buttons ×1.1 / ×1.05 in 50 ms with Tap; crafting/armor ones inactive in the original, not drawn; colours from the exported UIButton/UIButtonColor data |
| M4 NGUI list scrolling | A | Done 2026-10-22 (`1dd09e7`): `browser/rpos-scroll.mjs`, UIDraggablePanel + UIScrollBar port; `npm run test:rpos-scroll` |
| Loot window close button: original `CloseButtonClicked` → `HideOrClose` for the loot case | A | Done 2026-10-22 (GAP-AUDIT M7): `LootClosed`, StopLooting sent, RPOS stays open, crafting hidden until its bumper |
| M3b bumper bar visibility | A | Answered 2026-10-22 (GAP-AUDIT M3b, `1dd09e7`): `RPOSBumper.buttonPrefab` is the active project prefab, so the original shows the bar; the port draws it with the exported geometry. No owner question left |

## Website, accounts and server list

| Item | Who | Status |
|---|---|---|
| Forum (website phase 2) | A | Built 2026-10-22: `central/forum.mjs`, `/forum` page, staff moderation and posting bans; 14 node tests. live on your-domain.example since the 37565d7 redeploy |
| Forum rendered check (`npm run test:site`, now covers `/forum` and the Forum tab widths) | A | Done 2026-10-22: passes at 1440×900 and 390×844 plus the width sweep |
| Leaderboards (gateway stats, `/leaderboard`, profiles, hide toggle) | A | Built and live 2026-10-23, browser-checked at desktop and phone width, roadmap entry added; the gateway part reaches the VM with the next kit. Desktop players are not counted yet |
| Release readiness audit, website (GAP-AUDIT "Release readiness 2026-10-23" R2-R5, R7, R8, R17-R21) | A | Done 2026-10-23: robots.txt, sitemap.xml (372 URLs), canonical links, noindex on flow pages, HSTS/X-Frame-Options/Permissions-Policy/COOP, 500 page, favicon, immutable versioned CSS; CLS /updates 0.352 → 0.079 and /servers (390 px) 0.108 → 0, /roadmap TBT 601 → ~300 ms (390 px, 4× CPU), WebP pictures (/updates 2.6 → 0.9 MB, title hero 378 → 213 KB, 81 KB on phones), contrast fixes; `test:site` checks a11y basics and headers. Live after the next redeploy (code + `site/generated` WebP files) |
| Signed-out pages log one console error (`GET /me` 401) | A | Left: the API's "not signed in" answer; changing it touches every client |
| Email (password reset, verification, opening-day mail) | O | Built; needs a mail provider and DNS records |
| Steam API key, Discord app | O | Owner accounts |
| Classic map author credit, community place names | O | Owner to provide |

## Parked by the owner until the game is finished

Host app, desktop launcher, tablets/controllers/phones.
