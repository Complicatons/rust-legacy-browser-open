// RPOS interface sounds (tools/export_rpos.py `sounds`). NGUI UIButtonSound (trigger OnClick, clip "Tap") sits on the RPOS
// cells (the bag/belt/loot cell prefabs that RPOSInvCellManager instantiates, and the armor, fire and repair cells in the
// scene), the blueprint list rows (RPOS_Craft_BlueprintList.ItemPlaquePrefab), the crafting −/+ and Craft buttons, the repair button and the RPOS close button; NGUITools.PlaySound plays it as
// a 2D one-shot on the listener at volume × soundVolume (PlayerPrefs "Sound", default 1; skipped at 0.01 or less).
// RPOSCraftWindow.Update plays craftSound ("craft_start") when the player's CraftingInventory goes from not crafting to
// crafting. Buttons the original keeps inactive (Take All, the crafting/armor window close buttons, the bumper template in
// the scene) stay silent. The bumper bar buttons are clones of the project prefab asset (export `bumper.prefab`), which is
// active and taps; the fire/loot/repair close buttons tap too (port `.rpos-window-close`, data-window = the window).

// Port element → the original UIButtonSound it stands for (scene path suffix, or a cell prefab's manager).
const ORIGINAL=[
 ['#craft-minus','RPOSCraftWindow/MinusButton'],['#craft-plus','RPOSCraftWindow/PlusButton'],
 // The original CraftButton is one button whose label switches between Craft and Cancel.
 ['#craft','RPOSCraftWindow/CraftButton'],['#cancel-craft','RPOSCraftWindow/CraftButton'],
 ['#inventory-close','TopRight/CloseButtonPanel/CloseButton'],['#loot-action','RPOSRepairBenchWindow/RepairButton'],
];
const CELLS={armor:'ArmorPanel/Cell1',fire:'RPOSFireContentsWindow/Cell1',repair:'RPOSRepairBenchWindow/Cell1',bag:'InventoryPanel/ScrolledPanel',belt:'BottomCenterAnchor/RPOSBelt',loot:'RPOSLootWindow/ScrolledPanel'};

export function createRposSounds(sounds,{soundVolume=1,bumper=null}={}){
 const scene=new Map((sounds?.buttons??[]).map(b=>[b.path,b])),find=suffix=>{for(const [path,b] of scene)if(path.endsWith(suffix))return b;return null;};
 const prefab=suffix=>{for(const [path,c] of Object.entries(sounds?.cellPrefabs??{}))if(path.endsWith(suffix))return c.buttonSounds.find(s=>s.trigger==='OnClick')??null;return null;};
 const playable=b=>b&&b.enabled&&b.active!==false&&b.trigger==='OnClick'&&b.clip&&b.volume*soundVolume>0.01?{file:b.clip,volume:b.volume*soundVolume,pitch:b.pitch}:null;
 // Which kind of cell a port slot button is: loot/fire/repair containers share the port's loot grid.
 const cellKind=(el,container)=>{if(el.dataset.loot!==undefined)return container==='fire'||container==='repair'?container:'loot';const slot=Number(el.dataset.slot??NaN);
  if(slot>=36)return 'armor';if(slot>=30)return 'belt';return 'bag';};
 return {
  // The click sound for a clicked element (or one of its ancestors), or null. container: the open loot layout ('fire', 'repair', or a crate).
  click(target,container=null){const el=target?.closest?.('.item-slot,#blueprint-list [data-blueprint],.rpos-bumper-button,.rpos-window-close,'+ORIGINAL.map(([s])=>s).join(','));if(!el)return null;
   if(el.dataset.blueprint!==undefined&&!el.classList.contains('item-slot'))return playable(prefab('ScrolledPanel#ItemPlaquePrefab'));
   if(el.classList.contains('rpos-bumper-button'))return playable(bumper?.prefab?.buttonSounds?.find(s=>s.trigger==='OnClick'));
   if(el.classList.contains('rpos-window-close'))return playable(find(el.dataset.window+'/CloseButton'));
   if(el.classList.contains('item-slot')){const kind=cellKind(el,container),source=CELLS[kind];return playable(kind==='bag'||kind==='belt'||kind==='loot'?prefab(source):find(source));}
   for(const [selector,path] of ORIGINAL)if(el.matches(selector))return playable(find(path));return null;},
  craft:sounds?.craft?.clip?{file:sounds.craft.clip,volume:1,pitch:1}:null,
 };
}

// RPOSCraftWindow.Update: craftSound on the not-crafting → crafting edge, checked every frame.
export function craftStartEdge(){let was=false;return crafting=>{const start=!was&&Boolean(crafting);was=Boolean(crafting);return start;};}

// NGUI UIButtonScale / UIButtonOffset (tools/export_rpos.py `sounds.tweens`): on hover and press the button tweens its own
// scale and position (TweenScale/TweenPosition, EaseInOut) to `hover` / `pressed`, and back on release/leave. Enabled only
// on the armor, fire and repair cells (×0.975 hover, ×0.95 pressed in 25 ms; +0.025/+0.5 px offsets in 50 ms) and three
// window close buttons (fire/loot/repair: ×1.1 hover, ×1.05 pressed in 50 ms); the bag, belt and loot cell prefabs and the
// blueprint rows carry them disabled. The bumper prefab asset scales ×1.05 on hover and press in 25 ms.
// NGUI y points up, so a positive y offset moves the button up the screen.
const TWEEN_CELLS={armor:'ArmorPanel/Cell1',fire:'RPOSFireContentsWindow/Cell1',repair:'RPOSRepairBenchWindow/Cell1'};
// UITweener EaseInOut is t - sin(2πt)/2π; this cubic Bézier follows it to within 0.011.
export const NGUI_EASE_IN_OUT='cubic-bezier(0.53,0,0.47,1)';
export function createRposTweens(sounds,{bumper=null,colors=[]}={}){
 const enabled=(sounds?.tweens??[]).filter(t=>t.active!==false&&t.enabled&&t.ownTarget);
 const find=(suffix,kind)=>enabled.find(t=>t.path.endsWith(suffix)&&t.kind===kind)??null;
 const bumperTween=kind=>bumper?.prefab?.active&&bumper.prefab.buttonTweens.find(t=>t.enabled&&t.ownTarget&&t.kind===kind&&t.name===bumper.prefab.name)||null;
 return {
  // The scale/offset tweens of a port element, or null (container: the open loot layout, as for click()).
  // `color`: the element's UIButton colour duration (rposButtonColors), kept in the inline transition list.
  of(el,container=null){const pair=(scale,offset)=>scale||offset?{scale,offset,color:colors.find(c=>el.matches?.(c.selector))?.duration??null}:null;
   if(el?.classList?.contains('rpos-window-close'))return pair(find(el.dataset.window+'/CloseButton','UIButtonScale'),find(el.dataset.window+'/CloseButton','UIButtonOffset'));
   if(el?.classList?.contains('rpos-bumper-button'))return pair(bumperTween('UIButtonScale'),bumperTween('UIButtonOffset'));
   if(!el?.classList?.contains('item-slot'))return null;const slot=Number(el.dataset.slot??NaN);
   const kind=el.dataset.loot!==undefined?(container==='fire'||container==='repair'?container:null):slot>=36?'armor':null;if(!kind)return null;
   return pair(find(TWEEN_CELLS[kind],'UIButtonScale'),find(TWEEN_CELLS[kind],'UIButtonOffset'));},
  // CSS for a state: 'normal' | 'hover' | 'pressed'.
  style(t,state){const s=t.scale&&state!=='normal'?t.scale[state][0]:1,o=t.offset&&state!=='normal'?t.offset[state]:[0,0];
   return {scale:String(s),translate:`${o[0]}px ${-o[1]}px`,transition:[t.scale&&`scale ${t.scale.duration}s ${NGUI_EASE_IN_OUT}`,t.offset&&`translate ${t.offset.duration}s ${NGUI_EASE_IN_OUT}`,t.color!=null&&`background-color ${t.color}s linear`].filter(Boolean).join(',')};},
 };
}

// NGUI UIButton colours (tools/export_rpos.py `sounds.colors` and each prefab's `buttonColors`): OnHover/OnPress tween the
// target widget's colour (TweenColor, Linear) to hover / pressed and back to its serialized colour, over `duration`. Every
// target here is a sliced sprite: "stretchcell" (1 px black border, white inside), "white", or the "cell" sprite (the port
// multiplies var(--rpos-cell) by background-color), so sprite × colour is a background colour and, for stretchcell, a
// 1 px black border. No RPOS code sets UIButton.isEnabled, so the disabled colour never shows.
// Port selector → the original button (scene path suffix, prefab key suffix, or the bumper prefab).
export const BUTTON_COLORS=[
 ['#inventory #blueprint-list button[data-blueprint]',{prefab:'RPOSCraftWindow/ScrolledPanel#ItemPlaquePrefab'}],
 ['#inventory #craft-minus',{scene:'RPOSCraftWindow/MinusButton'}],['#inventory #craft-plus',{scene:'RPOSCraftWindow/PlusButton'}],
 ['#inventory #craft,#inventory #cancel-craft',{scene:'RPOSCraftWindow/CraftButton'}],['#inventory #loot-action',{scene:'RPOSRepairBenchWindow/RepairButton'}],
 ['#inventory-close',{scene:'TopRight/CloseButtonPanel/CloseButton'}],
 ...['RPOSFireContentsWindow','RPOSLootWindow','RPOSRepairBenchWindow'].map(w=>[`#inventory .rpos-window-close[data-window="${w}"]`,{scene:w+'/CloseButton'}]),
 ['#inventory .rpos-bumper-button',{bumper:true}],
 ['#pack .item-slot',{prefab:'InventoryPanel/ScrolledPanel'}],['#belt .item-slot',{prefab:'BottomCenterAnchor/RPOSBelt'}],['#inventory #loot:not(.rpos-shaped-container) .item-slot',{prefab:'RPOSLootWindow/ScrolledPanel'}],
 ['#equipment .item-slot',{scene:'ArmorPanel/Cell1'}],['#inventory #loot.rpos-shaped-container .item-slot',{scene:'RPOSFireContentsWindow/Cell1'}],
];
const css=c=>`rgb(${c.slice(0,3).map(v=>Math.round(v*255)).join(' ')}${c[3]<1?' / '+(+c[3].toFixed(3)):''})`;
export function rposButtonColors(sounds,{bumper=null}={}){
 const scene=suffix=>(sounds?.colors??[]).find(c=>c.path.endsWith(suffix)&&c.active!==false)??null;
 const prefab=suffix=>{for(const [path,c] of Object.entries(sounds?.cellPrefabs??{}))if(path.endsWith(suffix))return (c.buttonColors??[])[0]??null;return null;};
 return BUTTON_COLORS.flatMap(([selector,source])=>{const c=source.bumper?(bumper?.prefab?.active?bumper.prefab.buttonColors[0]:null):source.scene?scene(source.scene):prefab(source.prefab);
  return c?.enabled&&c.default?[{selector,sprite:c.sprite,normal:css(c.default),hover:css(c.hover),pressed:css(c.pressed),duration:c.duration}]:[];});
}
// One stylesheet for those buttons: normal, :hover and :active (UIButtonColor.OnPress wins over hover while pressed).
export function rposButtonCss(colors){
 return colors.map(c=>{const s=c.selector.split(','),each=suffix=>s.map(x=>x+suffix).join(',');
  return `${c.selector}{background-color:${c.normal};transition:background-color ${+c.duration.toFixed(4)}s linear${c.sprite==='stretchcell'?';border:1px solid #000':''}}${each(':hover')}{background-color:${c.hover}}${each(':active')}{background-color:${c.pressed}}`;}).join('\n');
}
