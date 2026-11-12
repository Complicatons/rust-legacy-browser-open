# 2016–2018 RustBuster client vs the 2015 client (static comparison)

Date: 2026-10-17 · Method: static only (hashes, 7-Zip listing CRCs, UnityPy object parsing, ILSpy decompilation). Nothing from either package was executed.

- **New package:** `<workspace>\2016-2018 game\Rust_RustBuster2018-2.0.4\Rust_RustBuster2016` (RustBuster 2.0.4, `version.txt`; files dated 2015–2019).
- **Baseline:** the 2015 installer payload (`analysis/installer-payload/Setup.bin`) and its extracted client (`analysis/client-audit`), which the port is built from.
- Local evidence (ignored `analysis/version-comparison/`): `code-file-comparison.json` (DLL/EXE hashes), `data-file-comparison.json` (every file's CRC vs the 2015 payload), `data-object-comparison.json` (per-object Unity diff), `assembly-csharp-diff-files.txt`, `decompiled-new/` (ILSpy output of the changed and new assemblies).

## Verdict

**The 2016–2018 package is the same Rust Legacy game as our 2015 client, with the RustBuster client mod added. It contains no game content, items, rules, map changes or features that our port is missing.** It is a client only: there is no server, and in Legacy the server decides damage, crafting, loot and explosions. Nothing in it changes gameplay rules.

## Game content (bundles and assets)

| What | Result |
| --- | --- |
| Map: terrain, textures, shaders, animations, fonts, GUI skins, text assets | **Byte-identical** |
| Items/datablocks (59), loot lists and other scriptable objects (312), character traits, NGC prefab registry, physic materials, mesh batch models | Every object differs only in internal script references renumbered by the rebuilt `Assembly-CSharp.dll`; **no value changes** |
| Prefabs (`gameobject.000`, 2,225 changed components) | Reference renumbering only; 2 skinned renderers differ in reference bytes |
| Models (`mesh.000/.001`) | Same vertices and triangles; 6–8 header bytes differ per mesh |
| Sounds | Same, except two clips (garage door shut, one music track) with small byte differences — no gameplay effect |
| Scene (`scenes.unity3d`) | Same content. Real differences: the stats URL `admin.playrust.com/api/info/client` → `gameapi.facepunchstudios.com/api/info/client/?game=rust`, float rounding in two transforms, and re-packed static-batch "Combined Mesh" objects (same geometry, different batching) |
| Materials | 11 duplicate-named materials got new asset IDs (rebuild noise) |
| Startup data (`mainData`, `sharedassets0`) | Only Unity Cloud Analytics script entries added (telemetry); no new objects |

## Code

- Unchanged: Facepunch.* libraries, Google.ProtocolBuffers, LitJSON, Mono/System, EasyRoads3D, dfScriptLite, Boo.
- Changed: `Assembly-CSharp.dll` (168 of 1,266 classes), firstpass, UnityScript, `uLink.dll`, `UnityEngine.dll`, `librust.dll`, `mono.dll`, `rust.exe`. `RustProtect.dll` is gone.
- The `Assembly-CSharp` changes are a **binary patch by RustBuster**, not a newer Facepunch version:
  - Hook calls into `RustBuster2016.Hooks` inserted at: weapon/shotgun/bow fire, grenade/C4/supply-signal explosion effects, structure damage, client hurt, player move, crafting start, research, item use, inventory toggle, loot window open/close, death screen and respawn requests, chat, console, main menu, loading screens, server browser, connect/disconnect, config save, quit.
  - Many private fields/methods made public so the mod can reach them; extension-method calls rewritten as static helpers (`SoundPool.Play`, `CurveUtility.*`); attribute order shuffled. These are side effects of patching, not behaviour changes.
  - Where readable, the hook bodies repeat the original 2015 logic and add an event that RustBuster plugins can change (for example `BulletWeaponFireEvent` can alter recoil pitch/yaw or cancel recoil, fire animation or head bob).
  - Six hook bodies (`OnClientHurt`, `GrenadeExplosion`, `C4Explosion`, `OnStructureDMG`, `OnStartCrafting`, `OnPlayerMove`) are virtualized by the **Agile.NET** protector and cannot be read without devirtualizing it. They replace only client-side effects (explosion visuals and physics push, the client's damage timestamp, the crafting request); server outcomes are unaffected.
- `GameConfig` accepts the response from the new stats URL without the old `status`/`data` wrapper.

## What RustBuster adds (not part of Rust Legacy itself)

- **Plugin system:** servers push `RustBusterPlugin` client plugins and downloadable files to players; about 30 client events (weapon fire, explosions, crafting, research, loot windows, chat, death screen, inventory, movement) plus messaging to the server.
- **Anti-cheat/admin tools:** `TakeManualScreenshot` (captures the player's screen for the server), player list, keyboard input API.
- **Launcher/Steam replacement:** `RustBuster.exe`, helper/updater executables, LumaEmu Steam emulator (`LumaGameLauncher_*.dll`, `steamclient*.dll`, `x86/Legacy/Steam.dll`), `NameChanger.exe`, a `VAC2.dll` copy, Unity Cloud Analytics.
- **Security note:** heavily obfuscated (Agile.NET virtualization, encrypted strings), an `mscorwks.dll` placed inside `rust_Data/Managed`, screen capture to servers, an auto-updater. Do not run any of it on the host; keep the same no-execution rule as the original packages.

## Impact on the port

- Nothing to add for game fidelity: keep the 2015 client as the content and rules source.
- Optional, only if wanted later: RustBuster-style server-to-client plugin/event hooks for modded servers (a design feature, not original Facepunch behaviour), and the newer stats URL (irrelevant offline).
- Remaining open item: the six virtualized hook bodies were not devirtualized; all evidence (unchanged data, readable hooks mirroring the original, client-only scope) indicates they wrap the original client effects.
