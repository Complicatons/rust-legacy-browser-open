import {cssUrl} from './asset-versions.mjs';
// RPOS.UpdateHealth/DoMetabolismUpdate and ClientVitalsSync.Local_BleedChange.
// Layout sizes, atlas sprites, bitmap glyphs and plaque definitions come from the static BuildPlayer-RPOS export.
// RPOS.UpdateHealth tints the bar Color.green / Color.yellow / Color.red; Unity's Color.yellow is (1, 0.92156863,
// 0.015686275), i.e. 255,235,4, not #ffff00.
export const UNITY_YELLOW='#ffeb04';
const clamp=v=>Math.max(0,Math.min(1,v)),number=new Intl.NumberFormat('en-US',{maximumFractionDigits:0});
export function hudState({health=100,calories=1000,radiation=0,bleeding=0,poison=0,temperature=0,warm=false,workbench=false,crafting=false,injured=false}={}){
 return {health:number.format(health),calories:number.format(calories),radiation:number.format(radiation),healthFill:clamp(health/100),foodFill:clamp(calories/3000),healthColor:health>75?'#00ff00':health>40?UNITY_YELLOW:'#ff0000',foodColor:calories<500?'#ff0000':'#ffffff',plaques:{Bleeding:bleeding>0,Hunger:calories<500,Cold:temperature<0,Warm:Boolean(warm),Radiation:radiation>500,Poison:poison>1,Workbench1:Boolean(workbench),Crafting:Boolean(crafting),Injury:Boolean(injured)}};
}
// StatusPanel children (NGUI locals, Y up) as CSS boxes relative to the StatusPanel origin (Y down). Sprite pivots: statusPanel
// BottomRight (8), progress Background/Foreground Left (3). StatusTitle is inactive in the source scene and is not drawn.
export function statusLayout(nodes){const at=name=>nodes.find(n=>n.name===name);
 const label=name=>{const n=at(name),w=n.widgets.UILabel[0];return {x:n.position.x,y:-n.position.y,pivot:w.mPivot,active:n.active!==false,text:w.mText,font:w.mFont.m_PathID,color:w.mColor};};
 const bar=name=>{const i=nodes.findIndex(n=>n.name===name),p=nodes[i],kids=nodes.filter(n=>n.parent===i),bg=kids.find(n=>n.name==='Background'),fg=kids.find(n=>n.name==='Foreground');
  const box=n=>({left:p.position.x+n.position.x,top:-(p.position.y+n.position.y)-n.scale.y/2,width:n.scale.x,height:n.scale.y});return {background:box(bg),foreground:box(fg)};};
 const panel=at('Sprite (statusPanel)'),root=nodes.find(n=>n.parent<0);
 return {origin:{right:-root.position.x,bottom:root.position.y},background:{left:panel.position.x-panel.scale.x,top:-panel.position.y-panel.scale.y,width:panel.scale.x,height:panel.scale.y},
  titles:{health:label('HealthTitleLabel'),food:label('FoodTitle'),rads:label('RadTitle')},values:{health:label('HealthLabel'),food:label('FoodLabel'),rads:label('RadLabel')},
  bars:{health:bar('HealthProgressBar'),food:bar('FoodProgressBar')},statusTitle:label('StatusTitle')};}
// UILabel pivot placement of a one-line bitmap label (TopLeft 0, Left 3, Center 4); `pad` is the canvas margin.
export function labelBox(l,width,size,pad=3){const ax=[0,.5,1][l.pivot%3],ay=[0,.5,1][Math.floor(l.pivot/3)];return {left:l.x-width*ax-pad,top:l.y-size*ay};}
export async function createHud({document=globalThis.document,base='/assets/recovered/hud/'}={}){
 const response=await fetch(base+'manifest.json');if(!response.ok)throw Error('Original HUD export missing');const assets=await response.json();
 // ProFont_outlined (assets.font) for values; the HEALTH/FOOD/RADS/STATUS titles reference the plain ProFont (cellFont, -599547848).
 const loadFont=async f=>{const image=new Image();image.src=base+f.texture;await image.decode();return {font:f,image,glyphs:new Map(f.glyphs.map(g=>[g.index,g]))};};const outlined=await loadFont(assets.font),plain=assets.cellFont?await loadFont(assets.cellFont):outlined;
 const fontFor=id=>plain.font.source?.endsWith(':'+id)?plain:outlined;
 function text(element,value,color={r:1,g:1,b:1},face=outlined){const {font,image:fontImage,glyphs}=face;element.textContent=value;element.classList.add('hud-bitmap');const canvas=document.createElement('canvas'),glyphList=[...value].map(c=>glyphs.get(c.charCodeAt(0))).filter(Boolean),width=Math.max(0,glyphList.reduce((n,g)=>n+g.advance+font.spacingX,0)-font.spacingX);canvas.width=Math.max(1,Math.ceil(width+6));canvas.height=font.size+6;canvas.dataset.textWidth=String(width);canvas.setAttribute('aria-hidden','true');const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;let x=3;for(const g of glyphList){ctx.drawImage(fontImage,g.x,g.y,g.width,g.height,x+g.offsetX,g.offsetY,g.width,g.height);x+=g.advance+font.spacingX;}
  const image=ctx.getImageData(0,0,canvas.width,canvas.height);for(let i=0;i<image.data.length;i+=4){image.data[i]*=color.r;image.data[i+1]*=color.g;image.data[i+2]*=color.b;}ctx.putImageData(image,0,0);element.append(canvas);}
 const root=document.createElement('section');root.id='game-hud';root.hidden=true;root.setAttribute('aria-label','Player status');
 root.innerHTML='<div class="hud-status"><div class="hud-row hud-health"><span>HEALTH</span><i><b></b></i><output></output></div><div class="hud-row hud-food"><span>FOOD</span><i><b></b></i><output></output></div><div class="hud-row hud-rads"><span>RADS</span><output></output></div></div><div class="hud-plaques" aria-live="polite"></div>';
 document.body.append(root);root.dataset.assets='original';const rows=Object.fromEntries(['health','food','rads'].map(k=>[k,root.querySelector('.hud-'+k)])),plaques=new Map();
 const background=assets.sprites.window_dropshadow_sprite;root.querySelector('.hud-status').style.backgroundImage=cssUrl(base+background.file);root.style.setProperty('--belt-cell',cssUrl(base+assets.sprites.cell.file));document.body.style.setProperty('--belt-cell',cssUrl(base+assets.sprites.cell.file));
 // Source-positioned StatusPanel: dropshadow sprite, HEALTH/FOOD/RADS titles, black progress backgrounds, filled foregrounds, centred values.
 const L=statusLayout(assets.status),px=v=>v+'px',place=(el,box)=>{for(const k of ['left','top','width','height'])if(box[k]!==undefined)el.style[k]=px(box[k]);};
 // The root box is the statusPanel sprite's bounds (it overhangs the anchor by 10 px right / 20 px down); .hud-status marks the StatusPanel origin.
 const B=L.background,overRight=B.left+B.width,overBottom=B.top+B.height;root.classList.add('hud-native');Object.assign(root.style,{right:px(L.origin.right-overRight),bottom:px(L.origin.bottom-overBottom),width:px(B.width),height:px(B.height)});
 const status=root.querySelector('.hud-status'),panel=document.createElement('i');panel.className='hud-panel';panel.style.backgroundImage=status.style.backgroundImage;status.style.backgroundImage='none';Object.assign(status.style,{left:px(-B.left),top:px(-B.top)});place(panel,B);status.prepend(panel);
 // Plaques keep their previous offsets from the StatusPanel anchor.
 Object.assign(root.querySelector('.hud-plaques').style,{right:px(11+overRight),bottom:px(48+overBottom)});
 const placeLabel=(el,l)=>{const canvas=el.querySelector('canvas'),face=fontFor(l.font);place(el,labelBox(l,Number(canvas?.dataset.textWidth??0),face.font.size));};
 for(const [key,row]of Object.entries(rows)){const span=row.querySelector('span'),t=L.titles[key];text(span,span.textContent,t.color,fontFor(t.font));placeLabel(span,t);
  const bar=L.bars[key];if(bar){const i=row.querySelector('i'),b=bar.background,f=bar.foreground;place(i,b);
   // UISlider foreground: 50x10 filled sprite inset in the 54x14 black background; the fill percentage spans the foreground width.
   i.style.padding=`${f.top-b.top}px ${b.width-f.width-(f.left-b.left)}px 0 ${f.left-b.left}px`;row.querySelector('b').style.height=px(f.height);}}
 const placeValue=key=>placeLabel(rows[key].querySelector('output'),L.values[key]);
 for(const [native,nodes]of Object.entries(assets.plaques)){const key=native.replace(/^Plaque/,''),p=document.createElement('div');p.className='hud-plaque';p.dataset.plaque=key;p.hidden=true;
  const label=nodes.flatMap(n=>(n.widgets.UILabel??[]).map(d=>({node:n,data:d})))[0],icon=nodes.flatMap(n=>(n.widgets.UISprite??[]).map(d=>({node:n,data:d})))[0];
  if(icon&&assets.sprites[icon.data.mSpriteName]){const img=document.createElement('img');img.src=base+assets.sprites[icon.data.mSpriteName].file;img.alt='';Object.assign(img.style,{left:icon.node.position.x+'px',top:-icon.node.position.y+'px',width:icon.node.scale.x+'px',height:icon.node.scale.y+'px'});p.append(img);}
  if(label){const span=document.createElement('span');span.style.left=label.node.position.x+'px';span.style.top=-label.node.position.y+'px';text(span,label.data.mText,label.data.mColor);p.append(span);}root.querySelector('.hud-plaques').append(p);plaques.set(key,p);}
 let previous='';return {update(stats,visible){root.hidden=!visible;document.body.classList.toggle('hud-active',visible);document.querySelector('#vitals')?.setAttribute('aria-hidden',String(visible));const s=hudState(stats),key=JSON.stringify(s);if(key===previous)return;previous=key;
  text(rows.health.querySelector('output'),s.health);text(rows.food.querySelector('output'),s.calories,s.foodColor==='#ff0000'?{r:1,g:0,b:0}:{r:1,g:1,b:1});text(rows.rads.querySelector('output'),s.radiation);for(const key of ['health','food','rads'])placeValue(key);
  rows.health.querySelector('b').style.width=s.healthFill*100+'%';rows.health.querySelector('b').style.backgroundColor=s.healthColor;rows.food.querySelector('b').style.width=s.foodFill*100+'%';rows.food.querySelector('output').style.color=s.foodColor;
  rows.health.setAttribute('aria-label',`Health ${s.health}`);rows.food.setAttribute('aria-label',`Calories ${s.calories}`);rows.rads.setAttribute('aria-label',`Radiation ${s.radiation}`);for(const [key,p]of plaques)p.hidden=!s.plaques[key];},root};
}
