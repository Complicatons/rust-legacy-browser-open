# Oxide plugins for our Rust Legacy server

Which Oxide plugins found online work on our server version? Each one was compiled against a rebuild of the final Oxide for Rust Legacy (March 2018). Status 2026-10-24.

**Result:** 330 different plugins found (448 unique files). **209 compile and pass every load check**: 115 written for Rust Legacy and 94 universal (Covalence) plugins. 14 more load, but part of what they do never runs. 5 fail only because of their file name (renamed copies are in the bundle). The rest need another server mod (mostly RustExtended), were written for another game, or have compile errors. No plugin was run: "works" means the plugin compiles and loads under Oxide's own rules. Behaviour on a live server is untested.

**Test set the owner picked (2026-10-24):** [docs/oxide-plugins/shortlist.md](docs/oxide-plugins/shortlist.md) (34 plugins + 4 they need, with preset configs; see "The test set" below). Per-plugin table: [docs/oxide-plugins/plugins.md](docs/oxide-plugins/plugins.md) (also `plugins.csv`). Every file and copy: `docs/oxide-plugins/all-files.csv`. To re-run: `tools/oxide-plugin-check/run.sh` ([README](tools/oxide-plugin-check/README.md)).

## Our version

- **Server:** Facepunch's final 2015 Legacy server. The archived Oxide.RustLegacy repository keeps a copy of the stock `Assembly-CSharp.dll`. Its SHA-256 `CE0DD832…ACFBB` is exactly the build in `tools/vanilla-patcher`'s allowlist and `deploy/host-test/settings.json`. So plugins were compiled against our server's own game code. `uLink`, `UnityEngine` and `Facepunch.ID` come from the same copy.
- **Oxide:** the last Oxide for Rust Legacy, built here from its sources: [Oxide.RustLegacy](https://github.com/OxideMod/Oxide.RustLegacy) `eff84ea` (2018-03-02, archived) with Oxide.Core `601a58d`, Oxide.CSharp `7b0d01c`, Oxide.Unity, Oxide.MySql and Oxide.SQLite at their commits from that date. Oxide's NuGet feed (myget) is gone, so nothing prebuilt was used. The `Assembly-CSharp` copy gets Oxide's own patch changes from `RustLegacy.opj`: `NetUser.avatar`, `NetUser.fLastChat` and `VoiceCom.playerList` made public, plus the `NetUser.IPlayer` field. These are what plugins compile against on a real Oxide server.

## Where Legacy plugins are online

oxidemod.org, the original home, is gone. umod.org still hosts the old Legacy pages, but this sandbox's network policy blocked umod.org and web.archive.org, so everything came from GitHub. A GitHub code search for `RustLegacyPlugin` finds about 440 hits in these collections:

| Collection | What it is | Legacy C# files |
|---|---|---|
| [Calytic/oxideplugins](https://github.com/Calytic/oxideplugins) (2016) | Mirror of the oxidemod.org catalogue, with each plugin's description/config page (`.json`, `.md`) | 66 (+ 24 Lua), plus universal |
| [Crushedice/LatestPlugins](https://github.com/Crushedice/LatestPlugins) (2017) | The same mirror, a few months later | 66 |
| [RustServers-IO/oxideplugins](https://github.com/RustServers-IO/oxideplugins) (2018) | Later oxidemod/umod mirror; most universal plugins come from here | 23, plus universal |
| [strykes/Oxide2Plugins](https://github.com/strykes/Oxide2Plugins) | Reneb's own repository (Kits, ZoneManager, RemoverTool, AntiCheat, CopyPaste…) | 31 |
| [KichDM/RustLegacyPlugins](https://github.com/KichDM/RustLegacyPlugins) | Large Brazilian community dump: Oxide 2.0 plugins plus Oxide 1.18, Fougerite, Magma and RustExtended material and whole server packages | 212 |
| [erikmoch/OxidePlugins](https://github.com/erikmoch/OxidePlugins), [upperking/Old-Rust-Legacy-Plugins](https://github.com/upperking/Old-Rust-Legacy-Plugins), [g-arezi/RustLegacy---Plugins-C-](https://github.com/g-arezi/RustLegacy---Plugins-C-), [victor-0x29a/rust-legacy-plugins](https://github.com/victor-0x29a/rust-legacy-plugins) | Small personal collections | 33, 3, 4, 1 |
| [shadowfearzxc/RustExtended-plugins](https://github.com/shadowfearzxc/RustExtended-plugins) | Oxide plugins for RustExtended servers | 4 |

Many copies are identical, so identical files were merged. When a plugin has several versions, the report keeps the one that works and has the highest version. Ties go to the oxidemod mirrors, then the author's own repository, then community dumps. Universal (Covalence) plugins count only when their page lists Rust Legacy or they sit in a `universal` folder. Oxide 1.x (Lua-only, older framework), Fougerite, Magma and RustExtended's own plugin formats are not Oxide 2 plugins and were left out.

## How each plugin was checked

The rules are taken from that Oxide's source (`Oxide.CSharp` `Compilation.cs`, `CompiledAssembly.cs`, `CompilablePlugin.cs`):

1. **Compile** with Mono's C# compiler, against the same references Oxide gives a plugin: mscorlib/System/System.Core/System.Data, every loaded Oxide extension and the assemblies it references, each `// Reference:` or `using Oxide.X.Y` assembly with the assemblies *it* references, `// Requires:` plugins compiled alongside, and `#define RUSTLEGACY`. The one-level reference expansion matters: SetHome and AntiCheat reference `Facepunch.MeshBatch` and get `Facepunch.HitBox` through it.
2. **Sandbox**: Oxide rewrites any plugin method that touches System.IO, System.Net, System.Threading, reflection emit, PInvoke and so on into one that throws "System access is restricted". The compiled IL is scanned with the same list. No plugin in the set trips it; a test plugin that writes a file is caught.
3. **Load rules**: the class name must equal the file name (Oxide looks up `Oxide.Plugins.<FileName>`), the class needs an `[Info]` attribute and a public constructor.
4. **Hooks**: a hook method that our Oxide never calls compiles fine but silently never runs. Plugin methods named `On…`/`Can…`/`Modify…` are compared with the 35 hooks patched into the server by `RustLegacy.opj` and the 43 more Oxide's own code calls. Hooks other plugins raise (ZoneManager's `OnEnterZone`, for example) count as known.
5. **All together**: the 227 bundle files also compile as one assembly, so they don't clash with each other's type names.

Our own adapter (`adapter/RustLegacyBrowser.cs`) passes the same check. This is its first compile against real Oxide rather than `adapter/compile-check/OxideStubs.cs`: 0 errors, one warning that `webrequest.EnqueuePost` is deprecated in favour of `Enqueue`.

## What came out

| Status (best copy of each plugin) | Rust Legacy | Universal | Meaning |
|---|---|---|---|
| works | 115 | 94 | Compiles, loads, and every hook it defines is one our Oxide calls |
| loads-with-warnings | 11 | 3 | Loads, but some hooks never fire, or it has no Legacy code (below) |
| wont-load | 5 | 0 | Compiles, but the file name doesn't match the class. Renaming fixes it; the bundle has renamed copies |
| needs-RustExtended | 79 | 0 | Uses the RustExtended server mod's API. Our stock server doesn't have it |
| needs-other-server-mod | 1 | 0 | `Itens.cs` needs `NBSLegacy` |
| other-game | 0 | 9 | Filed as universal but uses Rust/Hurtworld/Reign of Kings types (`BasePlayer`, `PlayerSession`, `ServerUsers`…) |
| old-oxide-api | 2 | 1 | Written for 2015–2016 Oxide 2 (`using Oxide.RustLegacy;`, `UserData`, `Oxide.Ext.*`), removed by 2018 |
| compile-error | 4 | 6 | Plain bugs in that copy: syntax errors (Noname, KeyStock, AntiCheat1), a missing `using` (Slack*, NoSuicide), an older game API (teleport) |

The working set covers what Legacy servers ran: Reneb's Kits, RemoverTool, CopyPaste, AntiGlitch, Share/DoorShare, Jail, TimeManagement, ResourceManager, GatherMultiplier, AdminTeleportation, Spawns/SpawnsManager, LootSpawnLists, CraftingController and DeathMessages. It also has Gute's and BDM's admin tools (AdminGod, AdvGod, AdminList, AdvShop, AdvZap, AdvMetabolism), Mughisi's KickBan, Announcer and FamilyShareBlocker, copper's Antiflyfall and banip, plus universal ones: BetterChat, Clans, Economics, Friends, HelpText, TimedPermissions, Whitelist, Discord and Slack relays.

**Hooks that never fire on our Oxide** (the plugin loads, but that feature does nothing):
- `OnStructurePlaced`, `OnItemDeployedByPlayer`: the 2018 Oxide only has `OnStructureBuilt`/`OnItemDeployed`. ZoneManager's no-build zones and StructureLimiter's limits don't run.
- `OnPlayerDisconnect` (SetHome, TPR) and `OnPlayerDisconected` (a typo: ChatAPI, Damage, Essentials, PvpStart): the hook is `OnPlayerDisconnected`, so their disconnect cleanup never runs.
  Fixed in the bundle copies: the misspelled method is renamed to `OnPlayerDisconnected` (same `uLink.NetworkPlayer` argument), and the fixed SetHome and TPR were checked to now define the hook Oxide calls.
- `OnPlayerInit`/`OnUserInit` (Autokick, BetterChatMute): Rust Experimental hooks. `OnDeny` (AntiCheat, AdminCompanion), `OnGodCommand`: never called by anything.

**Universal plugins with nothing to do on Legacy:** AutoDoors only has door code for Rust and Hurtworld (`#if RUST`/`#if HURTWORLD`). Rename calls `IPlayer.Rename`, which Oxide for Rust Legacy left empty ("TODO"). Other universal plugins skip only extras on Legacy: Logger's crafting logs, Friends' turret sharing, Healer's metabolism reset (it still heals).

## The test set

The owner picked 34 plugins to try on a server (`tools/oxide-plugin-check/shortlist.txt`). `report.py` builds them into `bundle-shortlist/oxide/` with the 4 plugins they call (Share, PlayerDatabase, Spawns, ZoneManager), and `check_bundle.py` compiles the 38 together: 0 load problems. Choices made while putting it together:

- **No BetterChat.** On Legacy, Oxide sends every Covalence chat line as `chat.add "Server" "<line>"` (`RustLegacyPlayer.Message`), so with BetterChat every message would read "Server: Bob: hi". The original chat window can't colour names either: `lblChatName` has markup processing off, only `lblChatText` has it on (`browser/chat.mjs`, from the client prefab). **EasyChat** (Legacy-native) is in instead: it colours the message text by rank (Owner red, Moderator yellow, VIP blue; no tags) through the preset `presets/oxide/config/EasyChat.json`. Ranks come from the permissions `owner_chat`, `mod_chat` and `vip_chat`; everyone else chats in white. BetterChatFlood needs BetterChat, so there's no chat flood limit beyond the game's own.
- **Casper ported** (`patches/Casper.cs.diff`): `/casper` makes an admin invisible and silent to other players. It parks the admin's character 500 m up for everyone else and ignores the admin's moves until `/casper` again teleports them back to where they started. Reneb wrote it for an `OnGetClientMove` hook the 2018 Oxide no longer has; the port uses `OnPlayerMove(NetUser, Vector3)`, which `RustLegacyCore.IOnGetClientMove` calls, with the same RPC to other players. Because the server still thinks the admin is at the starting spot, the admin only receives players in the cull-grid cells around it (200 m cells, 3 x 3), so watch from near where you switched it on. Voice still carries; don't talk while invisible. Untested in game.
- **Presets:** SetHome allows 4 homes (`Sethome: Max Allowed Homes`, default 3). AntiCheat reports detections to admins only: no kicks, no bans and no public "X was caught hacking" broadcast, until it has been tested with browser players. Kits come with none; admin-only kits are made in game with `/kit add "name" "description" -admin` (items from your inventory).
- **SetHome and TPR** use the disconnect-hook fix above.

## Browser players

Server-side plugins run for browser players too, because to the server they are ordinary uLink players (OFFSHOOT-COMPATIBILITY-PLAN.md). Two groups behave differently for them, and an operator should configure these before turning them on (the `browser_players` column in `plugins.csv`):

- **Steam account checks**: FamilyShareBlocker, VACKicker, SteamChecks, SteamGroups, SteamReport, Autokick, EnhancedBanSystem. Browser players carry website user IDs, not Steam IDs. Steam's web API has no profile for them, and depending on settings these plugins may kick them.
- **IP-based actions**: Banip, Banvpn, CountryBlock, CountryBlocker, IPBlacklist, VPNBlock, EnhancedBanSystem, and the auto-bans in Antiflyfall, AdminCompanion, ServerTest and AdminPunishment, which ban the IP too. Browser players connect through our gateway on the same machine, so the server sees one IP for all of them. An IP ban on one browser player bans every browser player, and country/VPN checks judge the gateway's address.

28 of the plugins in the bundle send web requests to outside services: Discord, Slack, Pushover/Pushbullet, ip-api/iphub, Yandex/Microsoft/Google translate, Cloudflare, Twitch, rusted.store, google-analytics and oxide.laserhydra.com (UpdateChecker). Some of those services may no longer exist. None of the plugin code was security-reviewed. Read a plugin before putting it on a server.

## Limits

- Compile and load checks only. No plugin ran, and no Oxide server was started, because the game DLLs are never loaded (HANDOFF rule). Runtime errors, wrong game behaviour and config mistakes can still happen. The next step is a run on the VM test server (SERVER-TESTING-PLAN), starting with the plugins operators ask for.
- C# only. The 24 Lua plugins for Legacy (oxidemod mirror) all pass `luac -p`, but whether they use the Lua API correctly is unchecked, and Oxide.Lua was not built. JavaScript/Python plugins were not checked.
- Not every Legacy plugin is on GitHub. The umod.org archive may have plugins or newer versions that are missing here.
- This cloud run had no copy of our server's own `Managed` folder. The four main game DLLs came from Oxide's archived copy (the hash above). The other stock DLLs that plugins name in `// Reference:` (Facepunch.MeshBatch, Facepunch.HitBox, Google.ProtocolBuffers…) came from a Legacy server package in KichDM/RustLegacyPlugins, whose `uLink`, `UnityEngine` and `Facepunch.ID` are byte-identical to ours. They were used only as compile references. On the PC, run with `MANAGED=analysis/server-audit/rust_server_Data/Managed` to use our own files.
- Third-party plugin sources are not copied into this repository. The report links each one at a pinned commit, and `run.sh` fetches them.
