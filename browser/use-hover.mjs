// RPOS "use hover" text: the label that names what E does on the object under the crosshair ("Open", "Search",
// "Pick Up"...). Port of decompiled RPOS.UseHoverText* (SetHoverTextState, UseHoverTextThink, UseHoverTextMove/Revert,
// UseHoverTextScreen), ContextProbe.ClientCheckUse and the IContextRequestablePointText implementers' ContextTextPoint.
// Data (tools/export_hud.py `useHover`): "Use Hover Panel" sits 80 UI pixels above the BottomCenterAnchor (UIAnchor side
// Bottom; UIRoot automatic, so UI pixels are screen pixels); "Use Hover Label" is the plain ProFont (minecraftia_0,
// point filtered) at scale 24 = 2x its 12 px size, pivot Bottom, white, Shadow effect in black offset by one font
// pixel (1 / size, so 2 screen pixels) right and down.
// - Point text: when the object implements IContextRequestablePointText and ContextTextPoint succeeds, the panel moves to
//   WorldToScreenPoint(point); UseHoverTextScreen first shifts that point so the label's widget bounds stay on screen
//   (the original's tests: only when the other edge still fits). Otherwise the panel goes back to its origin.
// - Hidden while the context menu is up, while RPOS (inventory) is open, when the controllable's limit flags hide context
//   (dead), and when the text is empty.
const sideAnchor=side=>({0:[0,0],1:[0,.5],2:[0,1],3:[.5,1],4:[1,1],5:[1,.5],6:[1,0],7:[.5,0],8:[.5,.5]})[side]??[.5,0];

// Printed width in UI pixels of a one-line text (UIFont.Print advances, spacingX between glyphs, scale / size).
export function printedWidth(font,text,scale){const k=scale/font.size;let x=0,n=0;for(const c of text){const g=font.glyphs.get?font.glyphs.get(c.charCodeAt(0)):font.glyphs[c.charCodeAt(0)];if(!g)continue;x+=g.advance+(n++?font.spacingX:0);}return x*k;}

// Label bottom-centre in screen pixels (x right, y up from the bottom edge), or the panel origin when there is no point.
// point: the WorldToScreenPoint result {x, y} in the same pixels, or null. bounds: the label's widget bounds relative to
// the panel (pivot Bottom: x -w/2..w/2, y 0..h).
export function useHoverPosition({width,height,layout,point,bounds}){
 if(!point){const [ax,ay]=sideAnchor(layout.anchor.side);return {x:width*ax+layout.anchor.relativeOffset.x*width+layout.panel.x,y:height*ay+layout.anchor.relativeOffset.y*height+layout.panel.y};}
 let {x,y}=point;const minX=bounds.minX+x,maxX=bounds.maxX+x,minY=bounds.minY+y,maxY=bounds.maxY+y;
 if(minX!==maxX||minY!==maxY){
  if(minX<0){if(maxX<width)x-=minX;}else if(maxX>width)x-=maxX-width;
  if(minY<0){if(maxY<height)y-=minY;}else if(maxY>height)y-=maxY-height;}
 return {x,y};}

// ContextRequestable.PointUtil.SpriteOrOrigin on a prefab instance group: the first ContextSprite anchor's world
// position, else the group's origin. Returns [found, Vector3-like {x,y,z}] in browser space.
export function spriteOrOrigin(group,Vector3){const out=new Vector3();let sprite=null;group?.traverse?.(o=>{if(!sprite&&o.userData?.contextSprite)sprite=o;});
 if(sprite){group.updateMatrixWorld?.(true);sprite.getWorldPosition(out);return [true,out];}
 if(group){group.updateMatrixWorld?.(true);out.setFromMatrixPosition(group.matrixWorld??group.matrix);}return [false,out];}
// LootableObject.ContextTextPoint: the sprite position 0.15 m higher, or the origin unchanged (no sprite).
export function lootTextPoint(group,Vector3){const [found,p]=spriteOrOrigin(group,Vector3);if(found)p.y+=0.15;return p;}
// FireBarrel / ItemPickup / SleepingBag.ContextTextPoint: sprite or origin.
export const spriteTextPoint=(group,Vector3)=>spriteOrOrigin(group,Vector3)[1];
// BasicDoor.ContextTextPoint: only with RunFlags.PointText and at rest (Opened / Closed): the door transform applied to
// pointTextPointOpened / pointTextPointClosed (Unity local; door.world maps H-reflected locals to browser space).
export function doorTextPoint(door,Vector3){if(!door?.pointText||(door.state!==1&&door.state!==3))return null;
 const q=door.state===1?door.pointTextPointOpened:door.pointTextPointClosed;return new Vector3(q.x,q.y,-q.z).applyMatrix4(door.world);}

// Which shipped Contextual implementor a prefab carries (exported component names), or null: only these answer the use
// probe (ContextProbe: Contextual.ContextOf). Beds, structures, resource nodes and stashes without one are not contextual.
export function contextKind(prefab){const c=prefab?.components??{};
 if(c.MovingDoor||c.BasicDoor)return 'door';if(c.FireBarrel||c.Furnace)return 'fire';if(c.LootableObject)return 'loot';if(c.SleepingBag)return 'bag';if(c.ItemPickup)return 'pickup';return null;}
// LootableObject.ContextText / FireBarrel.ContextText: free -> "Search" / "Use"; looted -> "Occupied by <userName>" when the
// looter's PlayerClient is known, else "Occupied". looter: the NetworkPlayer (null/0 = unassigned).
export const lootContextText=(looter,name=null)=>looter?(name!=null?`Occupied by ${name}`:'Occupied'):'Search';
export const fireContextText=(looter,name=null)=>looter?(name!=null?`Occupied by ${name}`:'Occupied'):'Use';

export async function createUseHover({document=globalThis.document,base='/assets/recovered/hud/'}={}){
 const response=await fetch(base+'manifest.json');if(!response.ok)throw Error('Original HUD export missing');const assets=await response.json();
 const layout=assets.useHover;if(!layout)throw Error('HUD export has no useHover (rerun tools/export_hud.py)');
 const fontData=[assets.cellFont,assets.font].find(f=>f?.source===layout.label.font)??assets.cellFont,image=new Image();image.src=base+fontData.texture;await image.decode();
 const font={...fontData,glyphs:new Map(fontData.glyphs.map(g=>[g.index,g]))},L=layout.label,k=L.scale/font.size,shadow=L.effectStyle===1?1:0;
 const el=document.createElement('div');el.id='use-hover';el.hidden=true;el.setAttribute('role','status');el.setAttribute('aria-live','polite');
 const canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');el.append(canvas);const label=document.createElement('span');label.className='visually-hidden';el.append(label);document.body.append(el);
 let shown='',size={width:0,height:0};
 // Draws the glyphs at font resolution (shadow copy first, as MeshBuffer.ApplyShadow keeps the text on top) and lets
 // CSS scale it by `k` with nearest-neighbour sampling, like the point-filtered font texture.
 function draw(text){const gs=[...text].map(c=>font.glyphs.get(c.charCodeAt(0))).filter(Boolean);let w=0;gs.forEach((g,i)=>{w+=g.advance+(i?font.spacingX:0);});
  canvas.width=Math.max(1,Math.ceil(w)+shadow);canvas.height=font.size+shadow;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
  const pass=(dx,dy,color)=>{let x=0;const layer=document.createElement('canvas');layer.width=canvas.width;layer.height=canvas.height;const c=layer.getContext('2d');c.imageSmoothingEnabled=false;
   gs.forEach((g,i)=>{if(i)x+=font.spacingX;c.drawImage(image,g.x,g.y,g.width,g.height,x+g.offsetX+dx,g.offsetY+dy,g.width,g.height);x+=g.advance;});
   c.globalCompositeOperation='source-in';c.fillStyle=`rgba(${Math.round(color.r*255)},${Math.round(color.g*255)},${Math.round(color.b*255)},${color.a})`;c.fillRect(0,0,layer.width,layer.height);ctx.drawImage(layer,0,0);};
  if(shadow)pass(1,1,{...L.effectColor,a:L.effectColor.a*L.color.a});pass(0,0,L.color);
  canvas.style.width=canvas.width*k+'px';canvas.style.height=canvas.height*k+'px';size={width:w*k,height:L.scale};label.textContent=text;}
 return {layout,font,
  // text: ContextText of the probed object ('' or null clears); point: browser-space Vector3 or null; camera: the scene
  // camera; hidden: forceHideUseHoverText (context menu, RPOS, limit flags). Returns the placed label for tests.
  update({text,point=null,camera,hidden=false,viewport}){if(hidden||!text){el.hidden=true;return null;}
   if(text!==shown){draw(text);shown=text;}
   const width=viewport?.width??innerWidth,height=viewport?.height??innerHeight;let screen=null;
   if(point&&camera){const p=point.clone().project(camera);screen={x:(p.x*.5+.5)*width,y:(p.y*.5+.5)*height};}
   const at=useHoverPosition({width,height,layout,point:screen,bounds:{minX:-size.width/2,maxX:size.width/2,minY:0,maxY:size.height}});
   el.hidden=false;el.style.left=(at.x-size.width/2)+'px';el.style.bottom=at.y-shadow*k+'px';return {text,x:at.x,y:at.y,point:Boolean(screen),width:size.width,height:size.height};},
  element:el};
}
