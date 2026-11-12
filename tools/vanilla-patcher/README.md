# Vanilla server patcher (servers without Oxide)

Adds browser admission to the operator's **own** copy of the vanilla Rust Legacy server. Oxide servers use
`adapter/RustLegacyBrowser.cs` instead. Pilot: verified statically (patched IL decompiles as intended), never run
on a live server yet.

What it changes in `rust_server_Data/Managed/Assembly-CSharp.dll` (one supported build, checked by SHA-256):

| Method | Injected call |
|---|---|
| `ConnectionAcceptor.uLink_OnPlayerApproval` | `else if (!Hooks.OnUserApprove(connection, approval, this)) { …native… }`, after the native full/protocol/ban/duplicate checks |
| `ConnectionAcceptor.uLink_OnPlayerConnected` | `Hooks.OnPlayerConnected(player)` before each return |
| `ConnectionAcceptor.uLink_OnPlayerDisconnected` | `Hooks.OnPlayerDisconnected(player)` at entry |
| `chat.say` | `if (Hooks.OnChat(ref arg)) return;` at entry (`/browserlink` is answered privately) |
| `Inventory.ITMV` / `ITMG` | `Hooks.OnSlotMoveBefore(this, toInvID, fromSlot, toSlot, info)` at entry, `Hooks.OnSlotMoveAfter(this)` before each return (item-transfer facts) |
| `Inventory.ISMV` / `ITSM` / `ITSP` | `Hooks.OnSlotOp(info)` at entry (counted for inventory spam) |
| `DropHelper.DropItem(inv, slot, out pickup)` | `Hooks.OnDropItemAfter(inv, pickup)` before each return |
| `DropHelper.DropInventoryContents(inv, out to)` | `Hooks.OnDeathDropBefore(inv)` at entry, `Hooks.OnDeathDropAfter(to)` before each return |
| `ItemPickup.PlayerUse` | `Hooks.OnPickupBefore(this, controllable)` at entry, `Hooks.OnPickupAfter(this)` before each return |
| `Bullet`/`Shotgun`/`Melee`/`BowWeaponDataBlock.DoAction1` | `Hooks.OnWeaponAction(this, rep)` at entry (arrival time of each attack) |
| `BulletWeaponDataBlock.ApplyDamage` | `Hooks.OnBulletHit(this, hitObj, endPos, bodyPart, rep)` at entry (hit facts with the server's own line of sight) |

The evidence hooks (slice 8, `adapter/vanilla/RustLegacyBrowserVanilla.Evidence.cs`) only read and report facts with the
next sidecar poll; they never change what the server does. Overloads are matched by exact parameter types, so another
build fails `check` instead of patching the wrong method. `verify` expects 21 hook sites. A copy patched by an older
patcher must be restored (`restore`) and patched again.

`Hooks` lives in `RustLegacyBrowser.Vanilla.dll` (`adapter/vanilla`). Logins without an `RLBA` envelope return
straight to the native code, so desktop players authenticate exactly as before.

## Checking a build that isn't on the allowlist yet

`dotnet run --project tools/vanilla-patcher -- probe <folder>/Managed` runs the same read-only hook-site search as
`check`, but against **any** build, allowlisted or not — it never writes `Assembly-CSharp.dll`, `.rlb-original` or
the `supported` dictionary. Use it to see whether our pattern still finds all 21 sites in a community's own modified
build (a Fougerite-patched server, say) before deciding to add its SHA-256 to `supported` in `Program.cs`. Exit code
0 means every site matched.

## Steps

1. Stop the server and back up the whole server folder.
2. Build the adapter against the server's own assemblies:
   `dotnet build adapter/vanilla -c Release -p:RefDir=<server>/rust_server_Data/Managed`
3. Copy `adapter/vanilla/bin/Release/net35/RustLegacyBrowser.Vanilla.dll` into that `Managed` folder.
4. `dotnet run --project tools/vanilla-patcher -- check <server>/rust_server_Data/Managed` (dry run), then `patch`,
   then `verify`. The original is kept as `Assembly-CSharp.dll.rlb-original`; `restore` puts it back.
5. Start the sidecar (`deploy/README.md`) and put its plugin key in `<server datadir>/cfg/rustlegacybrowser.cfg`
   (`serverdata/cfg/…` by default; created with blank values on first browser join):
   ```
   SidecarUrl=http://127.0.0.1:28090/plugin
   PluginKeyHex=<64+ hex chars, same as the sidecar's plugin key>
   ```
   Until a valid key is set, every browser join is refused.

Never redistribute a patched `Assembly-CSharp.dll`; each operator patches their own copy. A server update replaces
the DLL: run `check` again (an unsupported build is refused rather than patched blindly).
