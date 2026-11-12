# Online RPC coverage: original client vs browser port (audit round 5, 2026-10-29)

Every message the **original client** receives from the original server, and every one it sends, against what the port does. Static analysis only: `analysis/decompiled/client/Assembly-CSharp` (`client:`) and `analysis/decompiled/server/Assembly-CSharp` (`server:`), never a binary. Findings are in GAP-AUDIT.md "Audit round 5: online message coverage, 2026-10-29" (A5-1 to A5-18). Earlier rounds that already cover a row are named (G = gateway, O = online timing, E = items, U = UI).

Sources of the inventory: every `[RPC]` / `[NGCRPC]` method in the client (135 + 3), every `networkView.RPC` / `NetCull.RPC` / `ngcView.RPC` / `ItemRepresentation.Action*` call in the server and client, `bridge/ulink/rpc-schema.json`, the NGC registry (`browser/assets/recovered/ngc/registry.json`, 42 prefabs) and `ConsoleNetworker.SendClientCommand` callers.

Status: **Same** (same effect, arguments and timing), **Fixed** (this round), **N/A** (class on no shipped prefab, or the server never sends it), **Open** (see GAP-AUDIT A5).

## Server -> client

| Class.RPC(args) | Server sends (mode) | Original client effect and timing | Port | Status |
|---|---|---|---|---|
| ServerManagement.KP(int) | `server:NetUser.cs:326` (player) | kick NetError for the disconnect text | `browser/online.mjs:85` | Same |
| ServerManagement.UnstickMove(Vector3) | `server:RustServerManagement.cs:244,289` (player) | `client:ServerManagement.cs:290` set transform + CCMotor.Teleport; the 0.25 s Invoke is a no-op (flag cleared) | `online.mjs:86` teleport once | Same (A5-11) |
| ServerManagement.RS(float) | `server:ServerManagement.cs:544` | `NetCull.ResynchronizeClock` | `bridge/game-bridge.mjs:73` resyncs the gateway clock, not relayed | Same (G) |
| ConsoleNetworker.CL_ConsoleMessage(string) | `server:ConsoleNetworker.cs:36` (sender) | ConsoleWindow.AddText(fromServer) | `online.mjs:70`, `main.mjs` console-message | Same |
| ConsoleNetworker.CL_ConsoleCommand(string) | `server:ConsoleNetworker.cs:18,26` | `ConsoleSystem.Run`: the server sends only `chat.add`, `notice.popup`, `notice.inventory`, `deathscreen.reason`, `lockentry.show` | `online.mjs:71` retained, `main.mjs:1735` consoleUI, `lock-entry.mjs clientUICommand`, `chat.mjs` | Same (A5-14) |
| EnvironmentControlCenter.CL_UpdateSkyState(BitStream) | `server:EnvironmentControlCenter.cs:41` (OthersBuffered, view 996) | sky state | `online.mjs:89`, `tod.mjs readSkyState` | Same |
| Context.E(ContextMenuData), F..M() | `server:Context.cs:169-204` (sender) | ContextUI menu / end / restart | `online.mjs:198` OnlineContext, `context-ui.mjs` | Same |
| Controllable:CLR, ID1, OC1, OC2, RN0-RN7, RFH | `server:Controllable.cs:1323-1565,1752` (All/Others, buffered) | control chain (controller object, SetIdle); idle has no listener in shipped code | not used: ownership from the Create's owner | Same in effect (A5-10) |
| HumanController.ReadClientMove(Vector3,int,ushort,float) | `server:HumanController.cs:496` (sender, dropped move), `:518` (OthersExceptOwner / Others when TruthDetector moved) | others: interpolator goal at info.timestamp; own view: origin + **eyesAngles** + CCMotor.Teleport (`client:HumanController.cs:807-835`) | `net-client.mjs:81`; remote goals (O7); own: `online.mjs:75` teleport + look | **Fixed** (A5-5) |
| ClientVitalsSync.Local_HealthChange(float,ViewID) | `server:ClientVitalsSync.cs:106` (owner) | InterpTimedEvent "DMG" | `server-vitals.mjs:22` queued at callTime + delay | Same (O) |
| ClientVitalsSync.Local_BleedChange(float) | `server:ClientVitalsSync.cs:122` (owner) | bleeding level + plaque | `server-vitals.mjs:24` | Same |
| Metabolism.RecieveNetwork(6 floats) | `server:Metabolism.cs:451` (owner) | metabolism values | `server-vitals.mjs:25`, `main.mjs:1647` | Same (A4-7) |
| Metabolism.Vomit() | `server:Metabolism.cs:404` (owner) | vomit sound | `server-vitals.mjs:28` | Same |
| DeathTransfer.Client_OnKilled / By / Shot / ShotBy | `server:DeathTransfer.cs:124-137` (Others) | death screen (own); remote: hit boxes off, "RAG" queued; local attacker: at once | `online.mjs:64`, `main.mjs:1705-1730`, `server-vitals.mjs:27` | Same (O2, O4) |
| FallDamage.fIo(float) | `server:FallDamage.cs:37` (Others) | SetLegInjury; only the local controller and RPOS read it | `online.mjs:87` (own view only) | Same (A5-12) |
| FallDamage.fIc(float) | `server:FallDamage.cs:99` (Others) | legBreakSound at the character | `main.mjs:1652` | Same |
| EquipmentWearer.ArmorData(byte[]) | `server:EquipmentWearer.cs:76` (owner) | armour totals | `online.mjs:88` | Same |
| Inventory.GNUP(byte[]) | `server:Inventory.cs:4643,4766` (owner, listeners) | OnNetUpdate + Refresh | `server-inventory.mjs:50` | Same |
| Inventory.CFAR(BitStream) | `server:Inventory.cs:4550` | bind armour models | `net-client.mjs:77` (remote characters) | Same |
| Inventory.IAST(byte,ViewID) / ITDE() | `server:Inventory.cs:4431,5637` (owner) | active item / deactivate | `server-inventory.mjs:55,57` | Same |
| Inventory.IACT(byte,byte) | `server:Inventory.cs:5201` (owner): only for a DoneOnClient option (Info) | OnMenuOption | not handled: the port never sends Info | Same in effect (A5-9) |
| Inventory.CLEV(byte,int) | `server:Inventory.cs:5212` (owner) | ItemDataBlock.OnItemEvent sound | `main.mjs:1667` | Same |
| PlayerInventory.ReceiveBoundBPs(byte[]) | `server:PlayerInventory.cs:163` (owner) | known blueprints | `server-inventory.mjs:54` | Same (A5-15) |
| CraftingInventory.wbi / CRFU / CRFC | `server:CraftingInventory.cs:100,218,222` (owner) | workbench flag, crafting progress | `server-inventory.mjs:58-61` | Same (E5) |
| ItemRepresentation.Mods(byte[]) | `server:HeldItem.cs:109` (OthersBuffered) | install mods | `server-held.mjs:33` | Same |
| ItemRepresentation.InterpDestroy() | `server:HeldItem.cs:162` (Others) | InterpTimedEvent, DontDestroyWithNetwork | `server-held.mjs:38-45` | Same (O3) |
| ItemRepresentation.Action1/2/3, Action1B/2B/3B | weapons `server:*DataBlock.cs` (AllExceptOwner); torch `server:BasicTorchItemDataBlock.cs:133,138`, flare `server:TorchItemDataBlock.cs:186,199,213` (OthersExceptOwnerBuffered / AllExceptOwner) | InterpTimedEvent -> datablock DoActionN: guns/bow/melee effects; **torch Action2 = Ignite, Action3 = Extinguish; flare Action2 = Ignite, Action1 = Extinguish** | `server-held.mjs:43-62`; torch light was only driven by OnStatus | **Fixed** (A5-2) |
| BasicTorchItemRep / TorchItemRep.OnStatus(bool) | never: server RepIgnite/RepExtinguish run only inside its own OnStatus handler | light on/off | `server-held.mjs:37` (kept for mock servers) | N/A (A5-6) |
| LootableObject.SetLooter(NetworkPlayer) / ClearLooter() | `server:LootableObject.cs:314,320` (Others / OthersBuffered) | open / close the loot window | `server-inventory.mjs:52-53`, `online.mjs:177`, `airdrops.mjs` | Same |
| BasicDoor.DOc(sbyte) / DOo(sbyte,ulong) | `server:BasicDoor.cs:978,881` | door state / animated toggle at the stamp | `online.mjs:170-173`, scene doors `online.mjs` applySceneDoorCall | Same |
| ResourceObject.modelindex(int) | `server:ResourceObject.cs:77` (OthersBuffered) | depletion model after 0.15 s | `main.mjs:1797` | Same |
| FireBarrel.ReceiveNetState(bool) | `server:FireBarrel.cs:189` (OthersBuffered) | fire on/off | `online.mjs:175`, `main.mjs:1795` | Same |
| DeployableObject.GetOwnerInfo(ulong,ulong) | `server:DeployableObject.cs:226` (AllExceptOwnerBuffered) | creator/owner (sleeping bag sprite) | `main.mjs:1765` | Same |
| DeployableObject.ClientHealthUpdate(float) | `server:DeployableObject.cs:285` (BufferHealthRPC) | HealthDimmer | `main.mjs:1775` | Same |
| DeployableObject.Client_OnKilled() | `server:DeployableObject.cs:258` (OthersBuffered) | death effect | `main.mjs:1778` | Same |
| StructureComponent.ClientHealthUpdate / ClientKilled / SMSet | `server:StructureComponent.cs:146,169`, `server:StructureMaster.cs:896` | dimmer, death effect, master link | `main.mjs:1772-1776`, `server-buildings.mjs:17` | Same |
| StructureMaster.GetOwnerInfo(ulong,ulong) | `server:StructureMaster.cs:1105` | owner ids | retained (`main.mjs` entityCalls) | Same |
| TimedExplosive.ClientExplode() | `server:TimedExplosive.cs:28` (Others) | explosion effect | `main.mjs:1780` | Same |
| SleepingAvatar.SAAM(4 ints) / SACH(NetEntityID) | `server:SleepingAvatar.cs:790,764` | armour binding / sleeper sound | `main.mjs:1782-1791` | Same |
| SleepingAvatar.SAKL() | never (`HasDiedNowRPC` const only; a killed sleeper is NetCull.Destroyed) | ragdoll | `main.mjs:1792` (mock only) | N/A (A5-7) |
| BasicWildLifeAI.GetNetworkUpdate(Vector3,Angle2) | `server:BasicWildLifeAI.cs:371` (OthersBuffered) | NavMesh grounding, interpolator goal at the stamp | `server-wildlife.mjs:29`, `animal-view.mjs:80` | Same |
| BasicWildLifeAI.Snd(byte) / ClientDeath(Vector3,ViewID) | `server:BasicWildLifeAI.cs:382,341` (Others) | "SOUND" / "DEATH" InterpTimedEvents | `server-wildlife.mjs:31-40`, frame `:43-47` | Same; events > 2 s late dropped (A5-17) |
| BasicWildLifeAI.ClientHealthChange(float) | never (name constant only) | health | `server-wildlife.mjs:30` | N/A (A5-8) |
| HostileWildlifeAI.CL_Attack() | `server:HostileWildlifeAI.cs:246` (OthersExceptOwner) | "ATK" InterpTimedEvent | `server-wildlife.mjs:39` | Same |
| RigidObj.RecieveNetwork(Vector3,Quaternion) / RODone() | `server:RigidObj.cs:115,192` | RigidbodyInterpolator goal at info.timestamp; "_done" InterpTimedEvent | `server-rigid.mjs` was on arrival time + fixed 0.1 s | **Fixed** (A5-3); Create hiding also **Fixed** (A5-18) |
| TimedGrenade / SignalGrenade.ClientBounce() | `server:TimedGrenade.cs:90`, `server:SignalGrenade.cs:60` (Others) | "bounce" InterpTimedEvent | `server-rigid.mjs` | **Fixed** (A5-3) |
| ItemPickup.PKIS(int) / PKIF(int,byte) | `server:ItemPickup.cs:95,90` (OthersBuffered) | pickup label | `server-rigid.mjs:24` | Same |
| SupplyCrate.GetNetworkUpdate / Landed, SupplyDropPlane.GetNetworkUpdate | `server:SupplyCrate.cs:69,96`, `server:SupplyDropPlane.cs:125` | interpolated, "LAND" event | `airdrops.mjs` ServerAirdrops (callTime) | Same |
| VoiceCom:voiceplay(float,int,byte[]) / init(int) | `server:VoiceCom.cs:48` | 3D voice | `main.mjs:1697`, `voice.mjs` | Same |
| NGC.A / C / D (byte[] / ushort) | `server:NGC.cs:3863-3907` | instantiate / call by message id / destroy | `bridge/game-bridge.mjs:93-113`, `net-client.mjs:71-75` | Same (G8) |
| WorkBench.SetUser / WorkStatusUpdate, LightSwitch.ReadState / ConnectSetup, uLinkChatGUI.Chat, uLinkSmooth*/Strict* Move, ServerMove, GoodOwnerPos, AdjustOwnerPos | server code exists, no shipped prefab carries the class | | not handled | N/A (A5-16) |

## Client -> server

| RPC | Original client sends (when) | Port | Status |
|---|---|---|---|
| ServerManagement.ClientFirstReady | `client:RustLevel.cs:88` once the level has loaded | was sent on the ServerManagement Create, before the island loaded; now on `attach` (`online.mjs:136`) | **Fixed** (A5-1) |
| Inventory.SVUF | `client:InventoryHolder.cs:86` on our character's instantiate (RequestFullUpdate) | was sent only after an unreadable GNUP; now also on our Create (`online.mjs:61`) | **Fixed** (A5-4) |
| Inventory.SVUC(byte) | `client:Inventory.cs:4413` RequestCellUpdate, never called | not sent | Same |
| HumanController.GetClientMove | `client:HumanController.cs:798` | `game-bridge.mjs:131-175` | Same (G5, O) |
| ServerManagement.RequestRespawn(bool) | `client:DeathScreen.cs:93,99` | `online.mjs` respawn(camp) | Same |
| ConsoleNetworker.SV_RunConsoleCommand(string) | `client:ConsoleNetworker.cs:18` | `main.mjs` console, lock entry | Same |
| Context:A/B/C/D | `client:Context.cs:12-27` | `game-bridge.mjs:187-197` | Same |
| CraftingInventory.CRFS / CRFX | `client:CraftingInventory.cs:118,107` | `game-bridge.mjs:221-222`, `server-inventory.mjs:109-112` | Same (E5) |
| Inventory.ITSM / ITMG / ISMV / ITMV / ITSP / IACT | `client:Inventory.cs:4808-4831,4970` | `game-bridge.mjs:207-219` | Same |
| InventoryHolder.DoBeltUse / TOSS | `client:InventoryHolder.cs:162,184` | `game-bridge.mjs:218-220` | Same |
| LootableObject.StopLooting | `client:LootableObject.cs:93,149` (window closed, or open failed) | `server-inventory.mjs:82` | Same |
| RepairBench.DoRepair | `client:RPOSRepairBenchWindow.cs:31` | `game-bridge.mjs:215` | Same |
| FallDamage.fIm(Vector3) | `client:FallDamage.cs:71` unless velocity.y > -18 | `fall-damage.mjs:28` | Same |
| ItemRepresentation Action1..3 / Action1B..3B | bandage, torch/flare (`client:BasicTorchItemDataBlock.cs:123`, `client:TorchItemDataBlock.cs:175,181`), bow, bullet, shotgun, melee, grenade, throwable, deployable, structure | `bridge/ulink/rust.mjs:172-188` ITEM_ACTIONS | Same |
| VoiceCom.clientspeak(int,byte[]) | `client:VoiceCom.cs:47` | `game-bridge.mjs:256-263` | Same |
| Controllable:CLD | `client:Controllable.cs:1378` (exit a non-root controllable: vehicles, none shipped) | not sent | N/A |
| WorkBench.TakeAll / DoAction / StopUsing / WorkStatusUpdate, LootableObject.TakeAll | `client:RPOSWorkbenchWindow.cs:106,112` (no shipped WorkBench); loot TakeAll button inactive in the prefabs | not sent | N/A |
