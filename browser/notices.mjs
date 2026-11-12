// Generic notices: Rust.Notice.Popup(icon, text, duration = 4f) -> "notice.popup <seconds> <icon> <text>" ->
// PopupUI.CreateNotice -> PopupNotice (popup-ui.mjs). Online the server's command carries its own icon and duration; the
// offline island raises the same texts itself, so it looks the icon and duration up here. Every entry is a
// Notice.Popup / notice.popup call site of the decompiled server or client Assembly-CSharp (FontAwesome code points).
export const DEFAULT_NOTICE_SECONDS=4;
export const NOTICE_SOURCES=Object.freeze([
 // BasicDoor.ContextRespondMenu / door lock check
 ['Door is now locked.',''],['Door is now unlocked',''],['The door is locked!',''],
 // LockEntry (server) and LockEntry (client, notice.popup 5)
 [/^Password is now : /,''],['You can now access this door!',''],['Incorrect password.',''],['Too fast! Try again later.',''],
 ['Password must be 4 digits.','',5],['Must be digits only.','',5],
 // LockpickItem
 ['Lock has been picked!',''],['Lockpicking FAILED',''],["You can't lockpick this.",''],['Aim at a locked object.',''],
 // ResourceTypeItemDataBlock.UseItem (structure/deployable repair with a resource on the belt)
 ["Can't repair - Being damaged",''],[/^Healed -?\d+ \(-?\d+\/-?\d+\)$/,''],
 // BloodDrawDatablock, BlueprintDataBlock, ResearchToolItem (server success, client failures)
 ["You're too weak to use this",''],[/^You can now craft: /,''],['You already have this blueprint',''],[/^You can now craft (?!:)/,''],
 ['You must be at a workbench to do this.',''],["You can't research this.. No Blueprint Available!...",''],['You already know how to make this!',''],["You can't research this",''],
 // DeployableItemDataBlock, FireBarrel, HeldItem, InventoryItem, RepairBench, ResourceTarget, WorkBench
 ["You can't place that here",''],['No fuel (add wood first)',''],['This item is broken - Repair it',''],['Active item has broken! - Repair it',''],
 ['Item completely destroyed.',''],['Repaired Item!',''],['could not repair item',''],["Inventory full, can't gather.",''],["You can't do anything with those items",''],
 // SleepingBag
 ['You will not be able to spawn near here for 4 Minutes.','',7],[/^Wait -?\d+ seconds$/,''],['Your inventory is full',''],["This isn't yours",''],
 // BowWeaponItem, MeleeWeaponDataBlock (client)
 ['No Arrows!',''],["There's no wood left here",'',2],
]);
// MainMenu.ShowInformation: notice.popup 5 "" <text> (connection failures, "Disconnected ...").
export const INFORMATION_NOTICE=Object.freeze({icon:'',seconds:5});
// The icon and duration the original uses for a notice text; texts without a source keep no icon and the default 4 s.
export function noticeStyle(text){const s=String(text);
 for(const [match,icon,seconds=DEFAULT_NOTICE_SECONDS] of NOTICE_SOURCES)if(typeof match==='string'?match===s:match.test(s))return {icon,seconds,source:true};
 return {icon:'',seconds:DEFAULT_NOTICE_SECONDS,source:false};}
