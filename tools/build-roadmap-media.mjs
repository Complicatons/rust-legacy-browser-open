// Builds the /roadmap pictures and clips into site/generated/media/roadmap/ (ignored by git: they are captures of our
// port, which shows recovered game assets). Sources are our own captures under analysis/ and the public journal checkout;
// a missing source is skipped and the page leaves that picture out. Needs ffmpeg on PATH.
//   node tools/build-roadmap-media.mjs           build only what is missing: a published picture stays as it is, even
//                                                when a check run has since re-captured its source (checks overwrite
//                                                their screenshots on every run)
//   node tools/build-roadmap-media.mjs --only a.jpg,b.mp4   also rebuild these from their current sources
//   node tools/build-roadmap-media.mjs --refresh  rebuild everything older than its source
//   node tools/build-roadmap-media.mjs --force   rebuild everything
//   node tools/build-roadmap-media.mjs --check   list roadmap media named in site/content/roadmap that has no source here
// Clips: 1280 px wide H.264, 30 fps, 96 kb/s AAC game audio, at most 16 s, plus a <name>.poster.jpg frame. Pictures: 1280 px JPEG.
import {existsSync,statSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readRoadmap} from '../central/roadmap.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const OUT=path.join(root,'site/generated/media/roadmap');
const CLIPS='analysis/public-captures/final2',CAP='analysis/public-captures',QA='analysis/browser-qa',SITE='analysis/site-qa';
const JOURNAL=process.env.RLB_JOURNAL??'../rust-legacy-browser/assets/screenshots';
const J20=JOURNAL+'/2026-10-20',J19=JOURNAL+'/2026-10-19';

// Output file -> source (relative to the repo unless absolute; see also sourceFor below). `vf` adds an ffmpeg filter before scaling; `at` picks the poster time.
export const MEDIA={
 // The clips cut from the showcase tour (analysis/public-captures/final2, one file per segment).
 'aerial.mp4':{src:`${CLIPS}/aerial.mp4`},'gather.mp4':{src:`${CLIPS}/gather.mp4`},'wildlife.mp4':{src:`${CLIPS}/wildlife.mp4`},
 'build.mp4':{src:`${CLIPS}/build.mp4`,at:12},'hut.mp4':{src:`${CLIPS}/hut.mp4`},'campfire.mp4':{src:`${CLIPS}/campfire.mp4`},
 'door.mp4':{src:`${CLIPS}/door.mp4`},'guns.mp4':{src:`${CLIPS}/guns.mp4`},'bow.mp4':{src:`${CLIPS}/bow.mp4`},
 'night.mp4':{src:`${CLIPS}/night.mp4`},'craft.mp4':{src:`${CLIPS}/craft.mp4`},'multiplayer.mp4':{src:`${CLIPS}/multiplayer.mp4`,at:6},
 'menu.mp4':{src:`${CLIPS}/menu.mp4`},'coast.mp4':{src:`${CLIPS}/coast.mp4`},'airdrop.mp4':{src:`${CLIPS}/airdrop.mp4`},
 'plane.mp4':{src:`${CLIPS}/plane.mp4`},'crate.mp4':{src:`${CLIPS}/crate.mp4`},'raid.mp4':{src:`${CLIPS}/raid.mp4`},
 'arrive.mp4':{src:`${CLIPS}/arrive.mp4`},'end.mp4':{src:`${CLIPS}/end.mp4`,at:3},
 // 16 Oct: the first captures of the island and the animals.
 'rocks-16oct.jpg':{src:`${QA}/rocks-wide.png`},'rocks-close-16oct.jpg':{src:`${QA}/rocks-close.png`},
 'wolf-16oct.jpg':{src:`${QA}/animal-wolf_prefab.png`},'bear-16oct.jpg':{src:`${QA}/animal-bear_prefab.png`},
 // Clean captures (public-captures and the journal's 2026-10-20 set).
 'town-aerial.jpg':{src:`${CAP}/town-aerial.png`},'town-evening.jpg':{src:`${CAP}/town-evening.png`},'stag.jpg':{src:`${CAP}/stag.png`},
 'wolf.jpg':{src:`${CAP}/wolf.png`},'night-sky.jpg':{src:`${CAP}/night-sky.png`},'forest-morning.jpg':{src:`${CAP}/forest-hill-morning.png`},
 'grass-meadow.jpg':{src:`${CAP}/grass-meadow.png`},'coast-sunset.jpg':{src:`${CAP}/coast-sunset.png`},'m4-holo.jpg':{src:`${CAP}/m4-holo-aim.png`},
 'm4-flashlight.jpg':{src:`${CAP}/m4-flashlight-night.png`},'revolver.jpg':{src:`${CAP}/revolver.png`},'hatchet.jpg':{src:`${CAP}/hatchet.png`},
 'torch-night.jpg':{src:`${CAP}/torch-night.png`},'options-fov.jpg':{src:`${CAP}/options-fov-fps.png`},'options-graphics.jpg':{src:`${CAP}/options-graphics.png`},
 'main-menu.jpg':{src:`${J20}/main-menu.jpg`},'server-browser.jpg':{src:`${J20}/server-browser.jpg`},'chat.jpg':{src:`${J20}/chat.jpg`},
 'f1-console.jpg':{src:`${J20}/f1-console.jpg`},'context-menu.jpg':{src:`${J20}/context-menu.jpg`},'door-code-lock.jpg':{src:`${J20}/door-code-lock.jpg`},
 'repair-bench.jpg':{src:`${J20}/repair-bench.jpg`},'harvest-chicken.jpg':{src:`${J20}/harvest-chicken.jpg`},'inventory-crafting.jpg':{src:`${J20}/inventory-crafting.jpg`},
 'remote-armor.jpg':{src:`${J20}/remote-player-armor.jpg`},'remote-firing.jpg':{src:`${J20}/remote-player-firing.jpg`},'voice-chat.jpg':{src:`${J20}/voice-chat.jpg`},
 'hit-marker.jpg':{src:`${J20}/hit-marker.jpg`},'c4-explosion.jpg':{src:`${J20}/c4-explosion.jpg`},'campfire-soft.jpg':{src:`${J20}/campfire-soft-particles.jpg`},
 'in-game-fantastic.jpg':{src:`${J20}/in-game-fantastic.jpg`},'raid-metal-door.jpg':{src:`${J20}/raid-metal-door.jpg`},
 'dropped-item.jpg':{src:`${J19}/dropped-item.png`},'compound-17oct.jpg':{src:`${JOURNAL}/compound.png`},
 // Our test runs (developer overlay visible) and isolated test scenes.
 'door-garage.jpg':{src:`${QA}/door-garage-open.png`},'loot-window.jpg':{src:`${QA}/loot-window.png`},'eat-menu.jpg':{src:`${QA}/survival-eat-menu.png`},
 'hut-test.jpg':{src:`${QA}/structures-hut.png`},'campfire-test.jpg':{src:`${QA}/deployables-campfire.png`},'breached-wall.jpg':{src:`${QA}/combat-breached-wall.png`},
 'mock-player.jpg':{src:`${QA}/online-player.png`},'online-gun.jpg':{src:`${QA}/online-gun-aim.png`},'online-sleeper.jpg':{src:`${QA}/online-sleeper-loot.png`},
 'online-fire.jpg':{src:`${QA}/online-fire.png`},'online-bow.jpg':{src:`${QA}/online-bow-draw.png`},'m4-flash.jpg':{src:`${QA}/viewmodel-m4-flash.png`},
 'tracer-impact.jpg':{src:`${QA}/tracer-impact.png`},'rpos-tooltip.jpg':{src:`${QA}/rpos-item-tooltip.png`},'animation-walk.jpg':{src:`${QA}/animation-walk.png`},
 'ragdoll.jpg':{src:`${QA}/ragdoll-settled.png`},'surface-wood.jpg':{src:`${QA}/surface-wood.png`},'menu-scene.jpg':{src:`${QA}/original-menu-background.png`},
 'ktx2-world.jpg':{src:`${QA}/ktx2-on-world.png`},'fullscreen-play.jpg':{src:`${QA}/fullscreen-play.png`},'online-c4.jpg':{src:`${QA}/online-c4-explosion.png`},
 // The website (analysis/site-qa from npm run test:site; the tall pages are cropped to their first screen).
 'site-home.jpg':{src:`${SITE}/home-1440.png`,vf:'crop=iw:min(ih\\,iw*0.625):0:0'},'site-register.jpg':{src:`${SITE}/register-1440.png`,vf:'crop=iw:min(ih\\,iw*0.625):0:0'},
 'site-servers.jpg':{src:`${SITE}/servers-1440.png`,vf:'crop=iw:min(ih\\,iw*0.625):0:0'},'site-server.jpg':{src:`${SITE}/server-1440.png`,vf:'crop=iw:min(ih\\,iw*0.625):0:0'},
 'site-island.jpg':{src:`${SITE}/island-1440.png`,vf:'crop=iw:min(ih\\,iw*0.625):0:0'},'site-island-crate.jpg':{src:`${SITE}/island-crate-1440.png`,vf:'crop=iw:min(ih\\,iw*0.625):0:0'},
 'site-wiki.jpg':{src:`${SITE}/wiki-1440.png`,vf:'crop=iw:min(ih\\,iw*0.625):0:0'},'site-wiki-item.jpg':{src:`${SITE}/wiki-item-1440.png`,vf:'crop=iw:min(ih\\,iw*0.625):0:0'},
 'site-updates.jpg':{src:`${SITE}/updates-1440.png`,vf:'crop=iw:min(ih\\,iw*0.625):0:0'},'site-admin.jpg':{src:`${SITE}/admin-evidence-1440.png`,vf:'crop=iw:min(ih\\,iw*0.625):0:0'},
 'site-admin-actions.jpg':{src:`${SITE}/admin-actions-1440.png`,vf:'crop=iw:min(ih\\,iw*0.625):0:0'},
 // Leaderboards (tools/leaderboard-preview.mjs sample data, built-in browser captures at 1440 × 900 and 375 × 812).
 'site-leaderboard.jpg':{src:`${SITE}/leaderboard-1440.png`},'site-player.jpg':{src:`${SITE}/player-1440.png`},'site-leaderboard-phone.jpg':{src:`${SITE}/leaderboard-390.jpg`},
 // Server management (tools/console-preview.mjs sample data, Edge captures at 1280 × 800 and 390 × 844).
 'site-console.jpg':{src:`${SITE}/preview-site-console.jpg`}, 'site-staff.jpg':{src:`${SITE}/preview-site-staff.jpg`}, 'site-listing-form.jpg':{src:`${SITE}/preview-site-listing-form.jpg`}, 'site-list-your-server.jpg':{src:`${SITE}/preview-site-list-your-server.jpg`}, 'site-docs.jpg':{src:`${SITE}/preview-site-docs.jpg`}, 'site-console-phone.jpg':{src:`${SITE}/preview-site-console-phone.jpg`},
 // Sign-in page after Discord removal (tools/central.mjs analysis/site-preview/central.json, built-in browser capture at 1440 x 900).
 'signin-steam-only.jpg':{src:`${SITE}/preview-signin-steam-only.jpg`},
 'site-admin-desktop.jpg':{src:`${SITE}/admin-desktop-1440.png`,vf:'crop=iw:min(ih-200\\,iw*0.625):0:200'},
 // EU 1's own public server page, the first real server, captured live from the built-in browser (29 Oct).
 // The drawbox covers the listing-tag row, whose "official" badge the website no longer shows (servers are community-run).
 'site-eu1-live.jpg':{src:`${SITE}/preview-site-eu1-live.jpg`,vf:'drawbox=x=558:y=328:w=230:h=28:color=black:t=fill'},
 // The admin page during a mock-stack run of the matrix's Admin tools rows (tools/check-native.mjs --mock, 1440 x 900).
 'admin-desktop-players.jpg':{src:`${SITE}/admin-matrix-desktop-1440.png`},'admin-reports-in-game.jpg':{src:`${SITE}/admin-matrix-reports-1440.png`},
 'site-launch.jpg':{src:`${SITE}/launch-1440.png`,vf:'crop=iw:min(ih\\,iw*0.625):0:0'},'site-launch-done.jpg':{src:`${SITE}/launch-done-390.png`},
 'site-calculator.jpg':{src:`${SITE}/calculator-1440.png`,vf:'crop=iw:min(ih\\,iw*0.625):0:0'},'site-wiki-menu.jpg':{src:`${SITE}/wiki-menu-1440.png`,vf:'crop=iw:min(ih\\,iw*0.625):0:0'},
 // Desktop launcher window in its demo host (tools/capture-launcher.mjs).
 'launcher-servers.jpg':{src:`${SITE}/launcher-servers.png`},'launcher-playing.jpg':{src:`${SITE}/launcher-playing.png`},
 'site-signups.jpg':{src:`${SITE}/signups-1440.png`,vf:'crop=iw:min(ih\\,iw*0.625):0:0'},'share-launch.jpg':{src:'site/generated/media/share-launch.jpg'},
 // The detailed Modern island map (browser screenshots of /island at 1440 x 900 under analysis/map-captures).
 'map-modern-compound.jpg':{src:'analysis/map-captures/map-modern-compound.png'},'map-modern-cliffs.jpg':{src:'analysis/map-captures/map-modern-cliffs.png'},
 'map-modern-coast.jpg':{src:'analysis/map-captures/map-modern-coast.png'},'map-modern-compare.jpg':{src:'analysis/map-captures/map-modern-compare.png'},
 // The wiki resource calculator (browser screenshot at 1440 x 900 under analysis/site-captures).
 'wiki-calculator.jpg':{src:'analysis/site-captures/wiki-calculator.png'},
 'wiki-cooking.jpg':{src:'analysis/site-captures/wiki-cooking.png'},'wiki-calculator-cooking.jpg':{src:'analysis/site-captures/wiki-calculator-cooking.png'},
 // The original placement preview in our port (tools/_capture-placement.mjs, normal entry, offline island, 1600 x 900).
 'placement-foundation.jpg':{src:`${QA}/placement-game/foundation-valid.jpg`},'placement-invalid.jpg':{src:`${QA}/placement-game/foundation-invalid.jpg`},
 'placement-wall.jpg':{src:`${QA}/placement-game/wall-valid.jpg`},'placement-box.jpg':{src:`${QA}/placement-game/storage-box.jpg`},
 'placement-c4.jpg':{src:`${QA}/placement-game/c4-carrier.jpg`},
 // Thrown grenade frames (tools/_capture-thrown.mjs; four 640 x 360 crops 0.3 s apart, tiled with ffmpeg).
 'grenade-roll.jpg':{src:`${QA}/thrown-game/grenade-sequence.jpg`},
 // A crouched Rock swing at the ground (tools/_capture-melee-ground.mjs).
 'melee-ground.jpg':{src:`${QA}/melee-game/rock-ground.jpg`},
 // The menu and the island right after a join (tools/check-load.mjs LOAD_SHOTS=analysis/browser-qa/load).
 'load-menu.jpg':{src:`${QA}/load/menu.png`},'load-in-world.jpg':{src:`${QA}/load/in-world.png`},
 // After the faster world build (tools/check-load.mjs LOAD_SHOTS=analysis/browser-qa/load-build).
 'load-build-in-world.jpg':{src:`${QA}/load-build/in-world.png`},'load-parallel-in-world.jpg':{src:`${QA}/load-parallel/in-world.png`},'load-scene-in-world.jpg':{src:`${QA}/load-scene/in-world.png`},'load-shared-in-world.jpg':{src:`${QA}/load-shared/in-world.png`},
 // The P5 matrix against the original server (tools/check-native.mjs; headless Edge, 960 x 600).
 'native-inventory.jpg':{src:'analysis/native-runs/2026-10-21T20-01-58/inventory.move-moved.png'},
 'native-gather.jpg':{src:'analysis/native-runs/2026-10-22-gather-node-2/gather.node-gathered.png'},
 // The server-owner host app on its demo stack (tools/check-host-dashboard.mjs HOST_SHOTS=analysis/host-qa, 1440 x 900).
 'host-overview.jpg':{src:'analysis/host-qa/overview-1440.png'},'host-going-quiet.jpg':{src:'analysis/host-qa/going-quiet-1440.png'},
 'host-hang-recovered.jpg':{src:'analysis/host-qa/hang-recovered-1440.png'},'host-logs.jpg':{src:'analysis/host-qa/logs-1440.png'},'host-scripts-adopted.jpg':{src:'analysis/host-qa/scripts-adopted-1440.png'},'host-accounts.jpg':{src:'analysis/host-qa/accounts-1440.png'},'host-anticheat.jpg':{src:'analysis/host-qa/anticheat-1440.png'},'host-backups.jpg':{src:'analysis/host-qa/backups-1440.png'},'host-updates.jpg':{src:'analysis/host-qa/updates-1440.png'},'host-fresh-install.jpg':{src:'analysis/host-qa/fresh-install-1440.png'},
 // Host app, 24 Oct (tools/check-host-dashboard.mjs, demo stack, 1440 x 900) and the loader's Create account screen
 // (tools/capture-launcher.mjs, 440 px window).
 'host-schedule.jpg':{src:'analysis/host-qa/schedule-countdown-1440.png'},'host-health.jpg':{src:'analysis/host-qa/health-1440.png'},
 'host-player-history.jpg':{src:'analysis/host-qa/player-history-1440.png'},'host-settings.jpg':{src:'analysis/host-qa/settings-1440.png'},
 'host-plugins.jpg':{src:'analysis/host-qa/plugins-1440.png'},'host-health-check.jpg':{src:'analysis/host-qa/health-check-1440.png'},
 'host-offsite.jpg':{src:'analysis/host-qa/backups-offsite-1440.png'},'host-update-feed.jpg':{src:'analysis/host-qa/updates-feed-1440.png'},
 'host-setup.jpg':{src:'analysis/host-qa/setup-1440.png'},'host-setup-paste.jpg':{src:'analysis/host-qa/setup-handoff-1440.png'},
 'launcher-signup.jpg':{src:`${SITE}/launcher-signup.png`},
 'host-boot.jpg':{src:'analysis/host-qa/boot-mid-1440.png'},'host-terminal.jpg':{src:'analysis/host-qa/terminal-host-1440.png'},
 'make-your-server-browser-ready.jpg':{src:'analysis/browser-qa/operator-guide/make-your-server-browser-ready.png'},
 // Stage 3 on the Azure VM: the installed host app's dashboard with the original server (headless Chromium on the VM, 1440 x 900).
 'vm-host-overview.jpg':{src:'analysis/vm-stage3/host-overview-1440.png'},'vm-host-watchdog.jpg':{src:'analysis/vm-stage3/host-overview-1440.png',vf:'crop=720:420:240:360'},
 // The owner installer (RustLegacyHostSetup.exe /snapshot) and Setup's "existing server" steps, on a stand-in server folder.
 'host-installer-server.jpg':{src:'analysis/host-qa/installer-server.png'},'host-attach.jpg':{src:'analysis/host-qa/attach-1440.png'},
 // Third gap-audit round fixes (tools/check-presentation.mjs; GPU Edge, 1440 x 900).
 'm4-aim-sights.jpg':{src:'analysis/browser-qa/presentation/m4-aim.png'},'explosion-flash.jpg':{src:'analysis/browser-qa/presentation/explosion-flash.png'},
 // Final client pass (tools/check-presentation.mjs, tools/check-near-plane.mjs; GPU Edge, 1440 x 900).
 'metal-spark.jpg':{src:'analysis/browser-qa/presentation/metal-spark.png'},'near-plane-wall.jpg':{src:'analysis/browser-qa/near-plane/wall.png'},
 // Online interpolation (tools/check-online.mjs; GPU Edge, 1280 x 720, crop away from the dev panel).
 'online-remote-smooth.jpg':{src:'analysis/browser-qa/online-player.png',vf:'crop=800:450:440:120'},'online-wolf-smooth.jpg':{src:'analysis/browser-qa/online-wolf.png',vf:'crop=800:450:440:120'},
 // Use-hover label (tools/check-browser.mjs; GPU Edge, 1440 x 900, centre crop away from the dev panel).
 'use-hover-door.jpg':{src:'analysis/browser-qa/door-garage-closed.png',vf:'crop=720:450:360:225'},'use-hover-campfire.jpg':{src:'analysis/browser-qa/use-hover-campfire.png',vf:'crop=720:450:360:225'},
 'resource-stage-dust.jpg':{src:'analysis/browser-qa/resource-stage-effect.png',vf:'crop=800:450:300:150'},'drag-icon.mp4':{src:'analysis/browser-qa/rpos-drag-icon.mp4',at:2.2},
 'revolver-idle-walk.jpg':{src:'analysis/browser-qa/viewmodel-revolver-walk.png',vf:'crop=800:450:640:450'},'revolver-idle-frame.jpg':{src:'analysis/browser-qa/viewmodel-revolver-idle-frame.png',vf:'crop=800:450:640:450'},
 // One account per person + admin screenshots: a capture by browser/admin-capture.mjs on the offline island
 // (analysis/game-capture.mjs, GPU Edge) and the admin page from tools/admin-preview.mjs (1440 x 900, sample data).
 'game-capture.jpg':{src:'analysis/site-captures/game-capture.jpg'},'admin-screenshots.jpg':{src:'analysis/site-captures/admin-screenshots.png'},'admin-alts.jpg':{src:'analysis/site-captures/admin-alts.png'},
 // Full-loop playtest (tools/playtest/session.mjs steps; headless GPU Edge, 1280 x 720).
 'playtest-raid.jpg':{src:'analysis/playtests/2026-10-22/43-blast.png'},'playtest-repair.jpg':{src:'analysis/playtests/2026-10-22/44-repaired.png'},
 // RPOS list scrolling and button colours (tools/check-rpos-scroll.mjs, 1280 x 720).
 'rpos-scroll-craft.jpg':{src:`${QA}/rpos-craft-list-scrolled.png`},'rpos-craft-hover.jpg':{src:`${QA}/rpos-craft-hover.png`},'rpos-scroll-crate.jpg':{src:`${QA}/rpos-crate-scrolled.png`},'rpos-loot-closed.jpg':{src:`${QA}/rpos-loot-closed.png`},'rpos-repair-bench.jpg':{src:`${QA}/rpos-repair-bench.png`},
 // Our own artwork.
 'firefox-island.jpg':{src:'analysis/browser-qa/firefox/island.png'},'animals-walking.jpg':{src:'analysis/browser-qa/roadmap-world/animals.png'},'rock-buried.jpg':{src:'analysis/browser-qa/roadmap-world/rock-buried.png'},'rock-formation.jpg':{src:'analysis/browser-qa/roadmap-world/rock-formation.png'},'rock-slide.jpg':{src:'analysis/browser-qa/roadmap-world/rock-slide.png'},'rpos-craft.jpg':{src:'analysis/browser-qa/roadmap-world/rpos-craft.png'},'island-view.jpg':{src:'analysis/browser-qa/roadmap-world/island-view.png'},'rock-top.jpg':{src:'analysis/browser-qa/roadmap-world/rock-top.png'},'rock-face.jpg':{src:'analysis/browser-qa/roadmap-world/rock-face.png'},
 'discord-icon.jpg':{src:'branding/discord/rust-legacy-icon-512.png',vf:'pad=iw*16/9:ih:(ow-iw)/2:0:0x0a0a0a'},
 // 22 Oct: a matrix bot on the original server (check-native join.website shot, analysis/native-runs/2026-10-22T11-18-23).
 'original-server-belt.jpg':{src:'analysis/browser-qa/native/original-server-belt.png'},
 // 22 Oct: gameplay-matrix bots against the mock server (check-native --mock shots, analysis/native-runs/2026-10-22-gameplay-mock).
 'matrix-base.jpg':{src:'analysis/browser-qa/native-gameplay/build.base-base.png'},'matrix-campfire.jpg':{src:'analysis/browser-qa/native-gameplay/deploy.campfire-after.png'},
 'matrix-loot.jpg':{src:'analysis/browser-qa/native-gameplay/combat.death-loot.png'},'matrix-door-code.jpg':{src:'analysis/browser-qa/native-gameplay/door.lock-target-opened.png'},
 // 23 Oct: the same bots on the original server (analysis/native-runs/2026-10-23-gameplay-real-slice8, -two-b).
 'real-campfire-cooked.jpg':{src:'analysis/browser-qa/native-gameplay/real-campfire-cooked.png'},'real-other-player.jpg':{src:'analysis/browser-qa/native-gameplay/real-other-player.png'},
 'real-killed-by-rock.jpg':{src:'analysis/browser-qa/native-gameplay/real-killed-by-rock.png'},'real-hunt.jpg':{src:'analysis/browser-qa/native-gameplay/real-hunt.png'},
 // 23 Oct: a soak bot on the original server at +500 ms latency, 5 % loss (tools/soak-bots.mjs --net --shots, netC run).
 'bad-network-500ms.jpg':{src:'analysis/browser-qa/native/bad-network-500ms.png'},
 // 23 Oct: the original laser sight at night (tools/check-laser.mjs, dev header and panel hidden).
 'laser-night.jpg':{src:'analysis/browser-qa/roadmap-world/laser-night.png'},
 // 23 Oct: terrain detail before/after Unity's heightmapPixelError rule, high view at noon (tools/check-terrain-lod.mjs).
 'terrain-lod-before.jpg':{src:'analysis/browser-qa/terrain-lod/before-high.png'},'terrain-lod-after.jpg':{src:'analysis/browser-qa/terrain-lod/after-high.png'},
 // 23 Oct: chat typed over the open inventory, rock taken out with key 1 (tools/check-frontend.mjs, normal entry).
 'chat-over-rpos.jpg':{src:'analysis/browser-qa/frontend/chat-over-rpos.png'},
 // 23 Oct: a death message with [color] markup on the original death screen (tools/check-ui-edge-cases.mjs, dev panel hidden).
 'death-reason-colours.jpg':{src:`${QA}/ui-edge-cases/death-reason-markup.png`},
 // 23 Oct: item edge cases: a holo sight fitted to the held M4 redraws it (tools/check-item-edge-cases.mjs, offline, dev header and panel hidden).
 'm4-holo-redraw.jpg':{src:`${QA}/item-edge-cases/m4-holo-redrawn.png`},'m4-holo-drawing.jpg':{src:`${QA}/item-edge-cases/m4-holo-drawing.png`},
 // 23 Oct: audit round 4: a burning torch held at night (tools/check-audit-round-4.mjs, offline, dev header and panel hidden).
 'torch-burning.jpg':{src:`${QA}/audit-round-4/torch-night.png`},
 // 29 Oct: audit round 5: another player's torch lit at night from the server's relayed Action2 (tools/check-online.mjs, mock server, dev header and panel hidden).
 'remote-torch-night.jpg':{src:`${QA}/online-remote-torch-night.png`},
 // 29 Oct: audit round 5 (A5-18): a thrown flare, now held back until the server's own Create stamp catches up (tools/check-online.mjs, mock server).
 'online-flare-glow.jpg':{src:`${QA}/online-flare.png`},
 // 23 Oct: full-loop playtest, offline game reopened after closing it on the death screen, before and after the fix.
 'dead-save-before.jpg':{src:'analysis/playtests/2026-10-23/run2/76-loaded-dead.png'},'dead-save-after.jpg':{src:'analysis/playtests/2026-10-23/run2/76-after-fix-load.png'},
 // 23 Oct: release readiness: the start-up panel without WebGL 2, the panel after a GPU reset, and the site's home on a phone
 // (scratchpad game audit and check-site captures, copied to analysis/browser-qa/release/).
 'release-no-webgl.jpg':{src:`${QA}/release/no-webgl2.png`},'release-gpu-reset.jpg':{src:`${QA}/release/context-lost-panel.png`},'release-site-phone.jpg':{src:`${QA}/release/site-home-390.png`},
 // 23 Oct: sounds and effects round: wood chips from a hatchet hit on a trunk stand-in, and the Uber Hunting Bow arrow (tools/check-sound-effects.mjs).
 'melee-wood-chips.jpg':{src:`${QA}/sound-effects/tree-wood-impact.png`},'uber-arrow.jpg':{src:`${QA}/sound-effects/uber-arrow.png`},
 // Back-filled media for entries that had none (analysis/browser-qa/roadmap-media/): our port on the offline island
 // (GPU Edge, 1280 x 720, dev header and panel hidden; clips from a DevTools screencast) and our site on a local test
 // stack with sample names (central + site with the dev sign-in, as tools/check-site.mjs; 1440 x 900).
 'animals-move.mp4':{src:`${QA}/roadmap-media/animals-move.mp4`,at:3},'animal-kill.jpg':{src:`${QA}/roadmap-media/animal-kill.png`},
 'gunfire.mp4':{src:`${QA}/roadmap-media/gunfire.mp4`,at:2},'m4-burst.jpg':{src:`${QA}/roadmap-media/m4-burst.png`}, // m4-burst: a frame of gunfire.mp4 (2.82 s)
 'walk-jump.mp4':{src:`${QA}/roadmap-media/walk-jump.mp4`,at:4},
 'crafting-window.jpg':{src:`${QA}/roadmap-media/crafting.png`},
 'roadmap-page.jpg':{src:`${QA}/roadmap-media/site-roadmap.png`},'roadmap-search.jpg':{src:`${QA}/roadmap-media/site-roadmap-search.png`},
 'site-live-home.jpg':{src:`${QA}/roadmap-media/site-home.png`},
 'wiki-mutant-sack.jpg':{src:`${QA}/roadmap-media/site-mutant-sack.png`},'wiki-recipe-m4.jpg':{src:`${QA}/roadmap-media/site-recipe-m4.png`},
 'wiki-weapon-mods.jpg':{src:`${QA}/roadmap-media/site-weapon-mods.png`},'wiki-radiation.jpg':{src:`${QA}/roadmap-media/site-radiation.png`},
 'launcher-code.jpg':{src:`${QA}/roadmap-media/site-launcher-code.png`},'launcher-approved.jpg':{src:`${QA}/roadmap-media/site-launcher-approved.png`},
 'account-launchers.jpg':{src:`${QA}/roadmap-media/site-account-launchers.png`},
 'admin-anticheat-notes.jpg':{src:`${QA}/roadmap-media/site-admin-anticheat.png`},'signin-limited.jpg':{src:`${QA}/roadmap-media/site-signin-limited.png`},
 'servers-london.jpg':{src:`${QA}/roadmap-media/site-servers.png`},'server-page.jpg':{src:`${QA}/roadmap-media/site-server-detail.png`},
 // GAP-AUDIT T4: our port at the two run-two-e spots the original server rolled back (build/capture-terrain-surface.mjs
 // in the worktree that made them; GPU Edge 1280 x 720, offline island, dev header and panel hidden).
 'terrain-gully-6390.jpg':{src:`${QA}/terrain-surface/slope-6390.png`},'terrain-slope-5002.jpg':{src:`${QA}/terrain-surface/slope-5002.png`},
 // GAP-AUDIT "Third-person and online timing": a remote player's held M4 firing from its own muzzle (check-online, mock
 // server, headless Edge 1280 x 720, 2026-10-23).
 'online-remote-gunfire.jpg':{src:`${QA}/online-timing/remote-firearm.png`,vf:'crop=560:315:510:170'},
 // GAP-AUDIT "Gateway and server-message edge cases" G7: the original's kick text in our page after a gateway kick
 // (check-online, mock server, headless Edge 1280 x 720, dev header and panel hidden, 2026-10-23).
 'gateway-kick-text.jpg':{src:`${QA}/gateway/online-kick.png`},
 // Owner playtest fixes (2026-10-29): the loot window open alongside the player's own inventory, ready for a
 // shift-click quick-move between them (built-in browser, offline island).
 'inventory-shift-quickmove.jpg':{src:`${QA}/inventory/shift-click-quickmove.jpg`},
 // Owner playtest fix (2026-10-29): the one-time, dismissible tip on join pointing at fullscreen or the Crouch
 // rebind in Options (built-in browser, offline island).
 'join-controls-tip.jpg':{src:`${QA}/controls-tip/join-tip.jpg`},
 // Live day fixes (2026-10-30): the live /downloads page and the live /play server browser, signed out (headless Edge
 // 1280 x 720 against https://your-domain.example).
 'site-downloads.jpg':{src:`${SITE}/preview-site-downloads.png`},'play-server-tab.jpg':{src:`${SITE}/preview-play-official.png`},
};

// Media for a name: the table above, or guide-<file>.jpg for a wiki guide picture (site/generated/media/guides/, built
// by the guides step of npm run build:site).
export function sourceFor(name){
 if(MEDIA[name])return MEDIA[name];
 const g=/^guide-([a-z0-9-]+\.jpg)$/.exec(name);return g?{src:`site/generated/media/guides/${g[1]}`}:null;
}
const abs=p=>path.isAbsolute(p)?p:path.join(root,p);
function ffmpeg(args){const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{encoding:'utf8'});if(r.error)throw r.error;if(r.status!==0)throw Error(r.stderr.trim()||'ffmpeg failed');}
const filters=(m,w)=>[m.vf,`scale='min(${w},iw)':-2:flags=lanczos`].filter(Boolean).join(',');

export function buildRoadmapMedia({force=false,refresh=false,only=[],log=console.log,names=[]}={}){
 mkdirSync(OUT,{recursive:true});
 const done={built:0,fresh:0,missing:[]};
 const all=new Map(Object.entries(MEDIA));for(const n of names)if(!all.has(n)&&sourceFor(n))all.set(n,sourceFor(n));
 for(const [name,m] of all){
  const src=abs(m.src),out=path.join(OUT,name);
  if(!existsSync(src)){done.missing.push(name);continue;}
  if(!force&&!only.includes(name)&&existsSync(out)&&!(refresh&&statSync(out).mtimeMs<statSync(src).mtimeMs)){done.fresh++;continue;}
  if(name.endsWith('.mp4')){
   ffmpeg(['-i',src,'-t','16','-c:a','aac','-b:a','96k','-ac','2','-vf',filters(m,1280)+',fps=30','-c:v','libx264','-preset','slow','-crf','27','-pix_fmt','yuv420p','-movflags','+faststart',out]);
   ffmpeg(['-ss',String(m.at??1),'-i',src,'-frames:v','1','-vf',filters(m,1280),'-q:v','4',out.replace(/\.mp4$/,'.poster.jpg')]);
  }else ffmpeg(['-i',src,'-frames:v','1','-vf',filters(m,1280),'-q:v','3',out]);
  done.built++;log(`  ${name}`);
 }
 return done;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {entries,errors}=readRoadmap(path.join(root,'site/content/roadmap'),OUT);
 for(const e of errors)console.error('roadmap content: '+e);
 const named=new Set(entries.flatMap(e=>e.files)),unknown=[...named].filter(f=>!sourceFor(f));
 for(const f of unknown)console.error(`roadmap content names ${f}, which has no source in tools/build-roadmap-media.mjs`);
 if(process.argv.includes('--check'))process.exit(errors.length||unknown.length?1:0);
 const arg=process.argv.indexOf('--only'),only=arg>0?(process.argv[arg+1]??'').split(',').filter(Boolean):[];
 for(const n of only)if(!sourceFor(n))console.error(`--only ${n}: no source in tools/build-roadmap-media.mjs`);
 const r=buildRoadmapMedia({force:process.argv.includes('--force'),refresh:process.argv.includes('--refresh'),only,names:[...named]});
 console.log(`roadmap media: ${r.built} built, ${r.fresh} kept,${r.missing.length} without a source here${r.missing.length?' ('+r.missing.join(', ')+')':''}`);
}
