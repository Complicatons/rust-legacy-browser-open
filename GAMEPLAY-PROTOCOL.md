# Rust Legacy gameplay messages over uLink (static reconstruction, in progress)

Private working notes for HANDOFF queue item 5 (gameplay message catalogue). They build on `ULINK-PROTOCOL.md`, which covers transport, handshake and uLink headers. Source: the user's decompiled server/client `Assembly-CSharp` and server data bundles. Nothing was executed or captured.

## Three ways game state moves

| Mechanism | Wire form | Used for |
| --- | --- | --- |
| uLink `Create` (internal 9) | On the new view's ID: `uint16 owner`, `uint16 group`, `Vector3 pos` (3 × float32), `Quaternion rot` (x, y, z, w float32), `string proxyPrefab`, `string ownerPrefab`, `string serverPrefab`, `varuint length + initialData bytes`. Buffered, so it carries a 40-bit timestamp; type-unsafe. | Rust "classic"/dynamic objects: `NetCull.InstantiateClassic*` / `InstantiateDynamic*` with `:`-prefixed or plain prefab names. NetCull passes the same name for all three prefab slots and serialises the args into initial data. Example: on connect, `ServerManagement.CreatePlayerClientForUser` instantiates `":client"` owned by the player, with args `(ulong userId, string displayName)`. |
| uLink RPC by name | Header flags `0x08` (or `0x18` buffered) + `uint16 viewID` + `string methodName` [+ timestamp], then the arguments, each through its `BitStreamCodec` (type code only if the RPC is type-safe; server `rpcTypeSafe=0`) | Methods marked `[RPC]` on classic network views (player controller, inventory, crafting, loot, workbench, …) |
| NGC (Rust's own layer) | uLink RPCs on the NGC view: **`A(byte[])`** instantiate (server only), **`C(byte[])`** call, **`D(ushort)`** destroy | Static entities: structures, deployables, resources, sleepers, … `;`-prefixed handles; `NetCull.Instantiate` routes `;` names to `NGC.Instantiate` (static calls only) |

Value layouts (uLink `BitStream`, untyped): `float` = 4 raw bytes LE; `Vector3` = 3 floats; `Quaternion` = 4 floats (x, y, z, w); `Color` = 4 bytes /255; `bool` = **one byte**; `NetworkViewID`/`NetworkPlayer`/`NetworkGroup` = uint16; `string` = varuint length + UTF-8; `byte[]` = varuint length + bytes; a `uLink.BitStream` parameter is appended raw when last (see `ULINK-PROTOCOL.md`). Rust types with custom codecs: `ContextMenuData` (`ContextMenuData.cs:85`) and NGC `Block`s (`NGC.cs`); `NetEntityID` and `Angle2` codecs still need reading.

## NGC in detail (`Assembly-CSharp/NGC.cs`, `NGCView.cs`, `NGCConfiguration.cs`)

- **`A` instantiate payload** (`NGC.Add`, little-endian .NET byte layout, not bit-packed): `int32 prefabIndex`, `uint16 innerID` (entity ID within this NGC view), `float32 x, y, z` position, `float32 x, y, z` Euler rotation (degrees, `Quaternion.Euler`), then optional initial data as an untyped `uLink.BitStream`. Accepted only from the server.
- **`C` call payload** (`NGC.RPCData` / `Message`): `int32 (innerID << 16) | messageID` (little-endian), then the argument bytes.
- **Wire names.** The server gives each buffered carrier RPC its own name so it can remove it later: an add is **`"A" + innerID.ToString("x")`** (`NGC.GenerateRPCName`, sent `AllBuffered`, e.g. `A1f`), a buffered call **`"C" + innerID hex + "_" + messageID hex`** (`NGCView.GetBufferedCallRPCName`, e.g. `C1f_3`); unbuffered calls are plain `C`, destroys plain `D` (`Others`). The client's `NGCInternalView.OnRPC` dispatches on the **first character only** (`"NGC:" + rpcName[0]`); `ngcAction` in `bridge/ulink/rust.mjs` does the same. Until 2026-10-22 the bridge matched exact `A`/`C`/`D` and dropped every NGC entity from the original server (resources, structures, deployables, sleepers).
- **`D(ushort innerID)`** destroys.
- **Prefab index** = `NGCConfiguration.PrefabEntry.HashCode`. Split `guidText` into 32-bit hex words from the end; reorder `[w0, w5, w4, w2, w3, w1]` (missing words = 0); take `MurmurHash2` over the six ints with seed `2260766486` and treat it as signed. The handle registered is `";" + name` (`NGCConfiguration.cs:135`).
- **Message IDs.** `NGC.Prefab.Installation.Create` walks the prefab's serialized `NGCView.scripts` array in order. For each script type it takes instance methods (public and non-public; inherited non-private ones included by `GetMethods`) with `[RPC]` (skipped if `[NGCRPCSkip]` without `[NGCRPC]`) or `[NGCRPC]`, sorted by `String.CompareTo` (**culture-sensitive**), then concatenates them. The message ID is the index into that list. Method flags derive network flags: `FLAG_INFO 1`, `STREAM 2`, `ENUMERATOR 4`, `FORCE_UNBUFFERED 8`, `FORCE_INSECURE 16`, `FORCE_NO_TIMESTAMP 32`, `FORCE_UNRELIABLE 64`, `FORCE_TYPE_UNSAFE 128`.
- **Registry export:** `python -I tools/export_ngc_registry.py` writes the ignored `browser/assets/recovered/ngc/registry.json`. It currently resolves **42 prefabs and 237 messages, with no issues**. It records each prefab's index, scripts, per-message script/class/name/parameter types, and `cultureOrderDiffersFromOrdinal`. Culture ordering changes the table only for `DeployableObject` (`Client_OnKilled` before `ClientHealthUpdate`) and `SleepingAvatar`. The exporter's key approximates .NET culture order (`_` before letters, case-insensitive first); confirm it with the first authorised trace.

## RPC catalogue (classic views)

`python -I tools/rpc-catalogue.py analysis/decompiled analysis/rpc/catalogue.json` lists every `[RPC]` method with its owning type (file name), wire parameter types and **direction**. Each build keeps an empty body for RPCs it never receives, so a non-empty body marks the receiving side. Current output: 121 names, 135 handlers: **25 client→server**, **53 server→client**, 56 with code in both builds (case-by-case), 1 unknown (`FallDamage.ReadFallImpact`).

Client→server (what a browser client may send, each still to be validated server-side): `HumanController.GetClientMove(Vector3 origin, int encodedAngles, ushort stateFlags)`, `ServerManagement.ClientFirstReady()`, `ServerManagement.RequestRespawn(bool)`, `Inventory.ITMV/ITMG/ITSM/ITSP/ISMV/SVUC/SVUF`, `InventoryHolder.DoBeltUse(int)`, `InventoryHolder.TOSS(BitStream)`, `CraftingInventory.CRFS(int,int)/CRFX()`, `Context.A(NetEntityID)/B()/C(int)/D()`, `LootableObject.TakeAll()`, `WorkBench.TakeAll()`, `RepairBench.DoRepair()`, `Controllable.CLD()`, `ConsoleNetworker.SV_RunConsoleCommand(string)`, `VoiceCom.clientspeak(int, byte[])`, `FallDamage.fIm(Vector3)`.

## Join sequence (server side, this build)

1. uLink approval → `ClientConnectResponse` (`ULINK-PROTOCOL.md`).
2. `ConnectionAcceptor.uLink_OnPlayerConnected` → `new NetUser` → `ServerManagement.CreatePlayerClientForUser` → uLink `Create` of `":client"` (owner = the player, args `userId`, `displayName`) → `OnUserConnected`.
3. The client sends RPC **`ClientFirstReady`** to the server; a second call is ignored. The server calls `ConnectUserToGame` → `NetUser.InitializeClientToServer()`: load the avatar from `userdata/<id>/avatar.bin`, `SpawnPlayer`, … (next to trace: which `Create`/RPC messages follow, in order).

## Player spawn

`NetUser.InitializeClientToServer` (after `ClientFirstReady`) loads the avatar and calls `ServerManagement.SpawnPlayer(playerClient, useCamp:false, avatar)`. Position comes from the saved avatar (if it has position and angle and is not NaN); otherwise a camp or random spawn (`SpawnManager.GetRandomSpawn`). The server calls `truthDetector.NoteTeleported(pos)` and `Character.SummonCharacter(player, ":player_soldier", pos, rot)`, which becomes `NetCull.InstantiateDynamic` → a uLink `Create` named `":player_soldier"` owned by the player. `LoadAvatar(character)` (`AvatarSaveRestore`) then restores inventory, vitals and so on. Their RPC sequence is still to be traced.

## Movement (`HumanController`, client-authoritative with server checks)

- **Client → server:** RPC `GetClientMove(Vector3 origin, int encodedAngles, ushort stateFlags)` to `NetworkPlayer.server`, sent by `SendToServer()` at the network send rate. It must carry a uLink timestamp (default RPC flags).
- **`encodedAngles`** = `(Encode360(yaw) << 16) | Encode360(pitch)`. `Encode360(x)`: take `DeltaAngle(0, x)` into 0..360, then per 45° octant `k`: `RoundToInt((x − 45k) × 182.04444444444445) + 8192k`, with octant 8 → 0. `Mathf.RoundToInt` is round-half-to-even. Decode: `k = v / 8192`, angle = `45k + (v − 8192k) / 65536 × 360`, minus 360 if ≥ 180.
- **`stateFlags` parity bits `0x6000`:**
  - First send: no parity bits; both sides seed `p = (userName.GetHashCode() & 1) == 1`.
  - Each later send: OR in `0x2000` if `p`, else `0x4000`, then `p = !p`.
  - `Time.timeScale ≠ 1` sends `0x6000`.
  - The server mirrors this, but **the resulting flag is not acted on in this build** (`badPacketCount > 10` has an empty body).
  - `userName` is the login display name. `GetHashCode` is Mono's string hash; believed to be Mono 2.x `h = (h << 5) − h + c` over UTF-16 code units with int32 wraparound. Verify before relying on it; only the low bit matters.
- **Server checks:**
  - Sender must own the view.
  - `NetClockTester` timestamp validity: monotonic, spacing ≥ 0.9 × `NetCull.sendInterval`, not more than 3 s ahead of server time.
  - `NetCull.VerifyRPC`: if dropped, the server sends the owner `ReadClientMove` with its own state once.
  - `TruthDetector.NoteMoved`: speed over **20 m/s** (100 m/s while moving down) adds `speed` to `violation`. A raycast from `old + 0.5 m up` to the new position against layer mask `538444803` adds **100** and rolls back to an earlier snapshot (`Moved` → the corrected position is broadcast to everyone, owner included). `violation` decreases by 1 per move; **kick when > 400** (`truth.threshold`, `truth.punish = true`). `NoteTeleported` resets it.
- **Server → others:** `ReadClientMove(Vector3 origin, int encodedAngles, ushort stateFlags, float timeAfterServerReceived)` with `RPCMode.OthersExceptOwner`, or `Others` after a correction.
- **Implication for the browser client:** the existing browser motor stays the authority for the local player, as in the native client. The gateway turns browser input snapshots into `GetClientMove` at the send rate, with timestamps on the server-synchronised clock (`ClientConnectResponse.serverNowMs` + uLink clock resync), and applies `ReadClientMove` corrections.

## Clock

The client sets its server-time offset from the `ClientConnectResponse` exchange (`O1947.O2168`): t0 = request sent (client), t1/t2 = server receive/send, t3 = response received. Then `transit = (t3 − t0 − (t2 − t1)) / 2` and `offset = t2 + transit − t3` (uint64 wraparound); server time = local ms + offset. `ResyncClockRequest` (`uint64 t0`) and `ResyncClockResponse` (`t0, t1, t2`) use flags 31 (unreliable, unbuffered, no timestamp, untyped). The client keeps the lowest-transit sample over the window. Rust resyncs automatically from `PlayerClient.Update` (window `3 s + min(lag, 0.5 s)`) and when the server sends RPC `ServerManagement.RS(float durationSeconds)`. Codec: `clockOffset`/`serverTimeMs` in `bridge/ulink/ulink.mjs`.

## Inventory (`Inventory.GNUP(byte[])`, server → owner/looters)

The payload is an untyped BitStream (`Inventory.GenerateInvBitStream`):

- `byte capacity`, then `bool full` (one byte).
- **Full:** for each slot `0..capacity-1`: `bool present`; if present, `int32 datablockUniqueID` then the item state.
- **Dirty:** `byte count`; then per changed slot: `bool present`, `byte slot`, and if present `int32 datablockUniqueID` + item state.
- **Item state** (`InventoryItem.SerializeSharedProperties`): `byte uses` (`WriteInvInt` = one byte); if the datablock loses condition (`ItemDataBlock.DoesLoseCondition`), `float condition`, `float maxCondition`.
- **`HeldItem`s** (weapons and tools) add `byte totalModSlots`, `byte usedModSlots`, then `usedModSlots × int32 modUniqueID`. Ammo in a clip is `uses`.

Item datablock unique IDs and the condition flag are in the existing item export (`browser/assets/recovered/items`; verify the field names when wiring).

## Streaming and generic RPC decoding

- **NGC carriers per group:** `NGC.Instantiate` keeps one NGC object per uLink group, creating `NetCull.InstantiateClassic("!Ng", …, group)` on first use. Groups are `CullGrid` cells. The server subscribes each player to nearby cells, and uLink only delivers messages for subscribed groups, so the browser renders exactly what it receives. The gateway does not need to replicate the cull-grid maths.
- **Custom codecs:**
  - `NetEntityID`: `uint16 p1`; if `p1 == 0`, `uint16 viewID` (classic view); else `uint16 p2` (NGC entity).
  - `Angle2`: int32 encoded angles.
  - `ContextMenuData`: `int32 count` × (`int32 name`, `uLinkExtentions.WriteByteArray_MinimumCalls` UTF-8 text). That helper writes `int32 length`, then the array **backwards from the end** in chunks (odd byte, uint16, uint32, uint64…), each little-endian over its slice.
- **`bridge/ulink/rpc-schema.json`** (committed; regenerate with `python -I tools/rpc-catalogue.py analysis/decompiled analysis/rpc/catalogue.json bridge/ulink/rpc-schema.json`): 119 RPC names → handlers {class, params, direction}. `rust.mjs` `readArgs`/`writeArgs` cover all 17 parameter types in it.

## Systems in network mode (HANDOFF item 9)

What the native client sends and receives per action, so the browser systems can switch from local outcomes to server requests. Bridge support marked ✓ exists in `bridge/game-bridge.mjs`.

- **RPC name forms.** Most RPCs use the bare method name. The native code calls `Context`, `Controllable` and `VoiceCom` RPCs as **`"Class:Method"`** (e.g. `"Context:A"`, `"Controllable:ID1"`), and that string is what travels. ✓ The bridge decodes by class and sends prefixed names for these classes.
- **Interaction: doors, loot, deployables, any `Contextual`.** ✓ `context` command. Scene view **998 `CONTEXT`**. The client sends `Context:A(NetEntityID target)` to query. The server validates the line of sight from the player's eyes (bounds/linecast/15 m forward ray, mask `-201523205`) and replies to the sender with one of:
  - `Context:E(ContextMenuData)` show menu;
  - `F` no-op, `G` cancel/error, `H` immediate fail, `I` immediate success, `J` selection fail, `K` selection success, `L` stale selection.

  Follow-ups: `Context:B()` quick use, `Context:C(int option)` menu choice, `Context:D()` cancel.
  - **`NetEntityID`:** classic view `{p1: 0, viewId}`; NGC entity `{p1: carrier group (the `!Ng` view's group), p2: innerID}`. `NetEntityID.cs` is an explicit 4-byte layout: `p2` is the low half and `p1` the high half of `(group << 16) | innerID`. `isNGC` = `p1 != 0`.
- **Doors.** After the server toggles (`BasicDoor.ToggleStateServer`, locked doors pop "The door is locked!"), it broadcasts `DOo(sbyte state, ulong timestampMs)`: 0 closed, 1 open, 2 open reversed. Static scene doors use `RPCMode.Others`; deployable doors use `OthersBuffered` (previous call removed). `DOc(sbyte)` is the connect-time setup. The browser `LegacyDoor` port takes the state and the timestamp.
- **Loot.** Context on a `LootableObject` → server `SetLooter(NetworkPlayer)` to others (buffered), `Inventory.GNUP` to the looter (`SendAllDataToAuthorizedLooter`). The client ends with `StopLooting()` and the server clears with `ClearLooter()`. Take-all: `LootableObject.TakeAll()`.
- **Inventory operations** (client → server on the player's `Inventory` view; the server answers with dirty `GNUP`):
  - `ITMV(NetEntityID toInventory, byte fromSlot, byte toSlot)` move to another inventory;
  - `ITMG(NetEntityID, byte, byte, bool tryCombine)` merge;
  - `ITSM(byte, byte, bool)` same-inventory move/merge;
  - `ITSP(byte slot)` split;
  - `ISMV(byte, byte)`;
  - `SVUC(byte cell)`, `SVUF()`;
  - `InventoryHolder.DoBeltUse(int beltNum)` takes **0..5**, corresponding to inventory slots 30..35; the server adds 30. `InventoryHolder.TOSS(BitStream)` drops an item.

  Server → owner: `IACT(byte slot, byte action)`, `IAST(byte slot, NetworkViewID itemRep)` (held item representation), `CLEV(byte event, int uniqueID)`, `ITDE()`.
- **Crafting** (`CraftingInventory`): client `CRFS(int amount, int blueprintUID)` start, `CRFX()` cancel; server `CRFU(float ×4, int, int)` progress, `CRFC()` clear the craft queue; `wbi(bool)` workbench in range.
- **Combat** (client-side hit detection, server-verified). Firing sends `Action1B(byte[])` on the held item's representation view (`ItemRepresentation.ActionStream`; `Action1/2/3` with `BitStream` are the server-side forms). For bullets (`BulletWeaponDataBlock.WriteHitInfo`), an untyped stream:
  - hit on a networked object: `byte bodyPart` (254 = no body part), `NetEntityID hitView`, `Vector3` hit point local to the hit transform;
  - hit on world geometry: `byte 255`, world hit point;
  - miss: `byte 255`, the ray point at 1000 m.

  The server reads it with `ReadHitInfo` and applies damage. Clients see `ClientVitalsSync.Local_HealthChange(float, NetworkViewID attacker)`, `Local_BleedChange(float)`, `DeathTransfer.Client_OnKilled*`. Other items use the layouts below. ✓ The bridge `item` command (`ITEM_ACTIONS` in `bridge/ulink/rust.mjs`) works on the player's own item views only; the browser `GatewayClient.item()` converts browser-space vectors.

  | Action | RPC | Payload (untyped, Unity space) | Client source |
  | --- | --- | --- | --- |
  | bullet-fire | `Action1B` | one hit record per bullet/pellet (shotgun: `numPellets` records) | `BulletWeaponDataBlock`, `ShotgunDataBlock` |
  | bullet-reload | `Action3` | – | `BulletWeaponDataBlock:229` |
  | melee-hit | `Action1B` | `byte hitNetworked`; if 1 `NetEntityID`; `Vector3 point`; `byte flag` | `MeleeWeaponDataBlock:335` |
  | melee-target / melee-swing | `Action2(NetEntityID)` / `Action3` | – | `MeleeWeaponDataBlock:206/221` |
  | bow-fire / bow-hit / bow-miss | `Action1B` / `Action2B` / `Action3B` | origin + eyes `Quaternion` / `NetEntityID` + position / position | `BowWeaponDataBlock` |
  | grenade-throw | `Action1B` | origin, forward × held throw strength | `HandGrenadeDataBlock` |
  | throwable-throw | `Action1(BitStream)` | origin, forward | `ThrowableItemDataBlock` |
  | torch-throw / torch-toggle | `Action1B` / `Action2` | origin, forward / – | `TorchItemDataBlock` |
  | bandage-use | `Action3` | – | `BandageItem` |
  | structure-place | `Action1` | eyes origin, eyes direction, place position, place rotation, master `NetworkViewID` (0 if none) | `StructureComponentItem.DoPlace` |
  | deployable-place | `Action1` | eyes origin, eyes direction (the server redoes `CheckPlacement`) | `DeployableItem.DoPlace` |
- **Death and respawn.** The server sends `DeathTransfer.Client_OnKilled`/`Client_OnKilledBy(NetworkViewID)`/`…Shot…`; the client requests `ServerManagement.RequestRespawn(bool atCamp)`; the server spawns a new `:player_soldier` (`SpawnPlayer`). ✓ The `rpc` command allows `RequestRespawn` on the `ServerManagement` view.
- **Vitals and environment.** `Metabolism.RecieveNetwork(float ×6)`; `EnvironmentControlCenter.CL_UpdateSkyState(BitStream)` on scene view **996 `ECC`**; console `ConsoleNetworker.CL_ConsoleMessage(string)` on **997**.

- **uLink state sync** (`StateSyncOwner/Proxy`, `MultiStateSync*`): only uLink's own helper scripts in `Assembly-CSharp-firstpass` implement `uLink_OnSerializeNetworkView` (`uLinkSmoothCharacter`, `uLinkSmoothRigidbody*`, `uLinkStrictCharacter/Platformer`, `uLinkObservedList`). No Rust class does: Rust moves state through RPCs and NGC. Scene doors have `stateSynchronization` set, but their observed `MovingDoor` serialises nothing. The bridge forwards these as `internal` events and does not decode them.

## Still to map (moved into item 6, discover while bridging)

`AvatarSaveRestore.LoadAvatar` message order and `:player_soldier` initial data; `NetCull.sendRate` (sent in the approval world info); the `NetEntityID` codec and `Angle2` BitStream codec (`uLinkAngle2Extensions`); inventory client→server operations (`ITMV`/`ITMG`/`ITSM`/`ITSP` semantics, `NetEntityID` target); `CL_UpdateSkyState`; `Metabolism.RecieveNetwork`; state-sync (`StateSyncOwner/Proxy`) bodies and which Rust views use them; buffered RPCs on join; `CullGrid` group membership (which objects a player receives).

## Voice (`VoiceCom` + USpeak 2.x; browser port `browser/uspeak.mjs`, `browser/voice.mjs`, gateway `bridge/voice.mjs`)

- **Client → server:** `VoiceCom.USpeakOnSerializeAudio` → `networkView.RPC("clientspeak", RPCMode.Server, int setupData, byte[] data)` on the speaker's own `:player_soldier` view. The name travels **without** the `VoiceCom:` prefix (only the server's reply is prefixed).
- **Server → others:** `VoiceCom.clientspeak` (server) does nothing unless `voice.distance > 0` ([Admin] convar, default 100) and the sender has a last known position; it then sends `"VoiceCom:voiceplay"(float voice.distance, int setupData, byte[] data)` to every other `PlayerClient` within `voice.distance` (squared-distance test, sender excluded, no mute/team rules). `init(int)` exists in both builds but nothing calls it.
- **setupData** = `USpeakSettingsData.ToByte`: bit 0 Narrow, bit 1 Wide (neither = UltraWide), codec index << 2. Every desktop client sends **5**: the MalePlayer prefab's USpeaker is BandwidthMode Narrow (8000 Hz), Codec 1, SendRate 8, SendingMode Constant, UseVAD off, _3DMode Full3D (`tools/export_voice.py`). `Resources/CodecManager` lists `ADPCMCodec` (0) and `MuLawCodec` (1).
- **data** = concatenated `USpeakFrameContainer`s: `int32 LE encoded length`, `uint16 LE Samples` (always **0**: `CompressAudioData` never sets its out count), encoded bytes. One frame per 100-sample block (`GetSampleSize` returns 0 → USpeaker falls back to 100), so µ-law frames are 106 bytes (12.5 ms). All frames encoded since the last send go out every `1/SendRate` s (timer reset to 0, ~8/s).
- **PCM:** float × gain, clamped ±1, × **3267** (not 32767), truncated to short. µ-law is G.711 (BIAS 132, clip 32635). ADPCM resets per frame, packs the even sample in the low nibble, has the step-table typo **203500** at index 82, indexes one past the table at 88 (throws) and its decoder returns the scaled difference without a predictor.
- **Playback:** settings from the first `setupData` only; decode at the receiver prefab's own rate (8000 Hz); `SpeakerVolume = clamp01(1 − |camera − speaker eyes| / hearDistance)`; AudioSource on the character root, Linear rolloff, min 1, max hearDistance; a stopped source starts `2 × frame length` after a packet, then plays back to back until it runs dry (10 s loop clip). A malformed frame throws in `ReceiveAudio` after the earlier frames were queued.
- **Push to talk / HUD:** `VoiceCom.ShouldSend` = character alive && `GameInput "Voice"` held (default `V`). `VoiceChatIcon` (HUD `pnlVoiceIcon`, FontAwesome ``, top-right 160×168 panel) sets opacity `clamp(CurrentVolume × 20, 0, 1)` while Voice is held, where CurrentVolume is the mean |sample| of the last block sent; there is no icon for other speakers. The client `voice` console class is empty; the desktop client opens the microphone when the character spawns and keeps recording.
- **Gateway:** browser command `{type:'voice', setup, data:base64}` → `clientspeak` on the player's character view only; setup ∈ {0,1,2,4,5,6}, every frame exactly the codec's 100-sample size with Samples 0, ≤ 24 frames per message (fits the 4 KB JSON cap), budget 100 frames/s with a 160-frame burst and 20 messages/s; `clientspeak` is refused on the generic `rpc` path. `voiceplay` reaches the browser as an ordinary decoded `rpc` event.
