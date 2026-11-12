# Rust Legacy browser recovery

[![Tests](https://github.com/OWNER/rust-legacy-browser/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/OWNER/rust-legacy-browser/actions/workflows/test.yml)

Browser port in progress using the supplied original Rust Legacy world and recovered behaviour. The local prototype includes movement, loot, gathering, wildlife, survival, building and combat; it is not a complete playable release. Original client/server executables, DLLs and bundled scripts must not be run on this computer. Read `PORT-STATUS.md` for the original-content/fidelity boundary and next implementation steps.

## Run

From this project directory, run `npm.cmd start`, then open <http://127.0.0.1:4173>. The server binds only to loopback and serves the browser directory plus four explicitly mapped Three.js modules. It does not serve the extracted analysis tree.

WASD moves, drag looks, Shift sprints, Space jumps and Ctrl crouches. Walk mode uses recovered player settings with a browser collision/movement adaptation; Unity physics parity is unfinished. In walk mode, look at one of the 32 original doors within 3 m and tap E to open or close it (original Use bind and quick-tap rule). Tap E at one of the original loot crates to search it; click items to take them. Left click swings the selected belt tool (the default Rock): hit original wood piles, ore nodes and terrain trees to gather, and hunt the original wildlife (harvest corpses by hitting them). Wolves and bears hunt you; if you die, Respawn places you at an original spawn point. Select a camp fire, furnace, storage box, sleeping bag or workbench in the belt to see a placement preview and click to place it; tap E at a fire to ignite/extinguish it (or hold E for its menu), add wood and raw meat to cook, and tap E at a box to search it. Structure items (foundations, pillars, walls, doorways, ceilings…) snap to the original building grid; right click or the mouse wheel turns them, and doors snap onto doorway hardpoints. Firearms, bows and grenades use the original rules: click to fire (hold for automatics; hold and release to draw a bow or throw a grenade), right mouse aims and R reloads. Explosive charges stick to walls and doors and go off after five seconds. Drag armour into the equipment slots to wear it. Hunger, regeneration, bleeding and poison follow the original Metabolism: right-click food or medical items in the inventory to eat or use them, or press the belt key of a bandage or medkit. Q/E changes altitude in developer fly mode. Tab opens the local inventory and 1–6 selects belt slots. Click an item and then a destination slot to move it. Reset restores a view of the original warehouse compound. The location selector visits recovered buildings using their actual geometry bounds. Click the game to capture the mouse; Escape or the assigned F2/F3/F4 key releases it. Options includes a saved Field of View slider (60–120), synchronized with `render.fov N` in the F1 console. Fullscreen is available in Options or with Alt+Enter. Desktop keyboard/mouse controls are required.

The recovered day/night cycle now controls lighting and night cold. Cold burns extra calories; a lit fire warms you and clothing reduces cold. Original radiation zones build rads, with radiation armour reducing exposure and anti-radiation pills helping remove accumulated rads. The HUD shows the clock, Cold/Warm and accumulated rads. Entering water below the original water line kills the player, matching HumanController; swimming is not implemented.

## GitHub and publication

This repository holds the project source only. Original game packages, decompiled source, recovered assets, credentials and player data are not included and must never be committed; you need your own copy of the original game files to regenerate the recovered data (below).

## Regenerate recovered data

The original game code can be decompiled to readable C# for reference with `dotnet tool install -g ilspycmd` then `node tools/decompile.mjs` (static: assemblies are read, never loaded or run). Output goes to ignored `analysis/decompiled/`.

The existing extracted bundles must be in `analysis/world-source/bundles/`. Install project dependencies with `npm.cmd ci`. For a fresh Python tools directory:

```powershell
C:\Python314\python.exe -m pip install --target .tools/python UnityPy==1.25.4 numpy==2.5.4
C:\Python314\python.exe tools/export_world.py
C:\Python314\python.exe tools/export_scene.py
C:\Python314\python.exe tools/recover_player.py
C:\Python314\python.exe tools/export_items.py
C:\Python314\python.exe tools/export_loot.py
C:\Python314\python.exe tools/export_resources.py
C:\Python314\python.exe tools/export_animals.py
C:\Python314\python.exe tools/export_deployables.py
C:\Python314\python.exe tools/export_viewmodels.py
C:\Python314\python.exe tools/export_headbob.py
C:\Python314\python.exe tools/export_rpos.py
C:\Python314\python.exe tools/export_players.py
```

The exporters statically read Unity data. They export the 2049² float height grid, original splat textures and blend map, four vegetation models and atlases, 29,050 original tree placements, original scene geometry/materials and active solid collider definitions. Outputs stay in ignored `browser/assets/recovered/`; do not publish them or add original packages to Git. Manifests include source/output SHA-256 hashes, scene hierarchy, dimensions and height validation results. PNGs are decoded by UnityPy with its default vertical flip; Three.js reverses that image flip during upload so original Unity UVs remain valid. X/Y are retained, Z and mesh triangle winding are reflected. Static batches use the source's assigned submeshes and batch-root space.

`tools/export_scene.py` reads visuals from the client installer payload: extract `bundles\scenes.unity3d`, `mesh.000`, `material.000`, `texture.000`–`texture.004`, `shader.000` and `gameobject.000` into `analysis/client-source/bundles/`, and `rust_Data\resources.assets`, `sharedassets0.assets` and `Resources\unity default resources` into `analysis/client-source/data/` (data files only). Colliders and doors additionally use the server bundles. Older notes: scene regeneration additionally needs `texture.001.unity3d`, `material.000.unity3d`, `mesh.000.unity3d`, `resources.assets`, `sharedassets0.assets` and `unity default resources` alongside the existing bundles. Door sounds need `audioclip.000.unity3d`. Items need `datablock.000.unity3d`. `tools/export_animals.py` needs the client `animationclip.000/.001`, `scriptableobject.000` and `audioclip.000` bundles in `analysis/client-source/bundles/`. `tools/export_resources.py` also needs `ngcconfiguration.000.unity3d` and `texture.003.unity3d`, plus the client `scenes.unity3d` and `mesh.000.unity3d` extracted from the installer payload into `analysis/client-source/bundles/`. Player/items recovery also needs `gameobject.000.unity3d`, `gameobject.001.unity3d`, `scriptableobject.000.unity3d` and `editorbundle.txt`. These are data files extracted from the supplied server ZIP, not executable dependencies. Missing references are recorded in export reports; do not treat an incomplete export as the complete original scene.

## Verification

`npm.cmd test` checks coordinates, geometry/hashes, original static-batch building placement, real imported collision geometry, source player settings, wall/ceiling/stair/crouch/slope behaviour, inventory/recipe rules and HTTP access restrictions. It requires exported assets.

`npm.cmd run test:browser` uses installed Microsoft Edge through Playwright Core. It creates an ephemeral loopback server, checks rendering, movement, jump/crouch, reset, original-building navigation, inventory slot moves and desktop layout. It captures screenshots and fails on browser errors or external requests. Evidence is in ignored `analysis/browser-qa/`.

On Windows gameplay, online, startup/save/repair and viewmodel checks use hardware graphics by default. Set `$env:REQUIRE_GPU='1'` to require hardware renderer evidence, or `$env:BROWSER_SOFTWARE='1'` for software rendering in cloud environments. `BROWSER_PATH` selects another Chromium/Edge executable. The local RTX 4090 checks pass, including online server-controlled fire particles/light. Online QA uses our UDP server mock through the full website/gateway/sidecar stack; native-server compatibility remains untested.

`npm.cmd run test:multiplayer` tests our server-authoritative movement transport with two isolated Edge clients on this PC. The test starts an ephemeral loopback server and cleans it up afterward. Evidence is in `analysis/multiplayer-qa/`. This is **not** an original uLink/1069 compatibility test, and connected peers are not rendered in the explorer yet. No supplied original client/server code is executed by any test.

## Current limits

Crafting now supports batch quantities, the original category grouping and Ctrl/Shift quantity shortcuts. Jobs consume ingredients at completion; cancelling preserves them. Nearby workbenches speed offline crafting threefold, and required jobs stop after leaving the bench's one-second grace. Online inventory and job completion still wait for server snapshots. Batch progress survives offline saves. Window placement and ingredient-panel visuals remain adapted.

- Render mesh is 513² vertices, sampled from the full recovered grid. Walking uses that same mesh. Original tree bases use full-resolution source heights and can differ slightly from the coarse terrain.
- Nearby vegetation uses original meshes with instancing, a 950 m radius and a maximum of 1,200 instances per species. There is no distant tree LOD or occlusion system yet.
- The sea is at the original water plane height (252.4 m) but drawn flat. The original clock and sun/moon light rules now drive lighting; sky, fog and material response remain presentation approximations. The original sky scattering, clouds/stars, normal maps, grass details and tree animation are not reproduced. Screenshot inspection establishes rendering, not visual parity with the original game.
- Visible world geometry comes from the client copy of the original scene: 8,739 objects, including the coastal cliffs and rock formations the server copy lacks, drawn with instancing. Colliders, doors and interactions come from the server copy. Initially inactive/disabled objects and engine-effect/context-marker surfaces are reported separately.
- Original solid colliders are connected to walking, and the 32 original doors open/close with moving collision and original sounds. Water/vegetation collision, the hold-E door context menu and full Unity/CCTotem physics fidelity are unfinished.
- Offline GenericSpawners create original resource nodes and eight animal species; wolves and bears use the exported original navmesh. Terrain trees use the client's original tree colliders. Physics/nav-agent fidelity remains unfinished.
- Offline crates, inventory, crafting, deployables, buildings, locks, decay and saves are connected. Original first-person models, clips, torch/muzzle effects, camera sway, movement/shot head-bob, weapon mods and the vitals HUD render. Remaining RPOS windows, animation layers, impacts/decals and exact shader/physics fidelity remain unfinished. See `HANDOFF.md` for current verified checkpoints and restore overlays.
- Online joins use the website, account service, gateway and operator adapter. Original player bodies, server armour changes, unarmed movement clips, wildlife movement/attack/death, buildings/resources/doors/fire, loot sacks and clothed sleepers render. Sleeper ragdoll physics and full player animation blending remain unfinished.
- Online inventory reads full/dirty server snapshots (including condition/mods); moves, looting, take-all, split/menu, belt use and crafting send requests. Server updates own item counts and craft completion. Health, bleeding and metabolism use native server snapshots; death/respawn waits for server creation and placement. Mock-server GPU checks cover these flows and active held-model selection. Original HUD styling, combat and placement routing remain unfinished; offline simulation is suppressed online.
- The online stack is mock-tested on this PC. Native authentication/uLink interoperability still needs a real server on a permitted isolated host; production hosting is not configured. The separate two-client harness tests movement/transport only.
- Original binaries remain unexecuted. Read `HANDOFF.md` for prior security findings and the unresolved native/protection dependencies.

See `PORT-STATUS.md` for source evidence, known gaps and the next implementation order.
