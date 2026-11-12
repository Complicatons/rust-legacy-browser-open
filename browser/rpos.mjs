import {wornArmor} from './combat.mjs';
import {cssUrl} from './asset-versions.mjs';
import {createDesktopInventory} from './rpos-layout.mjs';
import {rposButtonColors,rposButtonCss} from './rpos-sounds.mjs';
// UILabel/UITexture colour multipliers: Unity Color.green, Color.red and Color.yellow, which is (1, 0.92156863,
// 0.015686275) = 255,235,4 (RPOSInventoryCell.SetItem stack label and condition tint, RPOSCraftWindow, armour totals).
export const LABEL_TINTS=Object.freeze({yellow:[1,0.92156863,0.015686275],red:[1,0,0],green:[0,1,0]});
// RPOSInventoryCell.SetItem / MakeEmpty. Item uses and mod slots remain owned by the inventory.
// Condition is clamped to maxcondition (InventoryItem.SetCondition); older saves without maxCondition mean a fresh 1/1 item.
export function cellState(data,item){if(!item)return {label:'',color:'white',tint:'white',mods:[]};const max=item.maxCondition??1,condition=Math.min(item.condition??max,max);
 const label=data._splittable?(item.uses>1?'x'+item.uses:''):(data._maxUses>(data._minUsesForDisplay??0)?String(item.uses):'');
 return {label,color:data._splittable?'white':'yellow',tint:condition<=0?'red':condition/max<=0.4?'yellow':'white',
  mods:Array.from({length:Math.min(5,item.totalModSlots??0)},(_,i)=>i<(item.mods?.length??0))};}
// RPOSArmorWindow.ForceUpdate / TakeDamage.DamageIndexToString: omit zero values, truncate as a native int.
// Online, EquipmentWearer.ArmorData (server ProtectionTakeDamage values) replaces the local CalculateArmor sum until the
// equipment changes again: `values` is that override.
export function armorRows(slots,items,values=null){const names=['Generic','Bullet','Melee','Explosion','Radiation','Cold'];return (values??wornArmor(slots,items)).flatMap((value,i)=>value!==0?[{name:names[i],value:Math.trunc(value)}]:[]);}

export async function createRposSkin({document=globalThis.document,base='/assets/recovered/'}={}){
 const [hud,layout]=await Promise.all(['hud/manifest.json','rpos/layout.json'].map(async p=>{const r=await fetch(base+p);if(!r.ok)throw Error('Original RPOS export missing: '+p);return r.json();}));
 const loadFont=async font=>{const image=new Image();image.src=base+'hud/'+font.texture;await image.decode();return {font,image,glyphs:new Map(font.glyphs.map(g=>[g.index,g]))};};
 // ProFont_outlined for window text; RPOSInventoryCell stack/uses/number labels use the plain ProFont (cellFont).
 const outlined=await loadFont(hud.font),plain=hud.cellFont?await loadFont(hud.cellFont):outlined,{glyphs}=outlined;
 const sprite=name=>base+'hud/'+hud.sprites[name].file;
 function text(element,value,color='white',{cell=false}={}){const {font,image,glyphs}=cell?plain:outlined;element.textContent=value;element.classList.add('rpos-text');const canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');const gs=[...value].map(c=>glyphs.get(c.charCodeAt(0))).filter(Boolean);
  canvas.width=Math.max(1,gs.reduce((n,g)=>n+g.advance+font.spacingX,0));canvas.height=font.size+2;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;let x=0;
  for(const g of gs){ctx.drawImage(image,g.x,g.y,g.width,g.height,x+g.offsetX,g.offsetY,g.width,g.height);x+=g.advance+font.spacingX;}
  const tint=LABEL_TINTS[color];if(tint){const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);for(let i=0;i<pixels.data.length;i+=4)for(let c=0;c<3;c++)pixels.data[i+c]*=tint[c];ctx.putImageData(pixels,0,0);}element.append(canvas);return canvas.width;}
 const measure=value=>[...value].reduce((sum,c)=>sum+(glyphs.get(c.charCodeAt(0))?.advance??0)+hud.font.spacingX,0);
 function paragraph(element,value,color='white',width=220){element.replaceChildren();const lines=[];let line='';
  for(const word of value.split(/\s+/)){const next=line?line+' '+word:word;if(line&&measure(next)>width){lines.push(line);line=word;}else line=next;}if(line)lines.push(line);
  for(const line of lines){const row=document.createElement('span');row.className='rpos-line';text(row,line,color);element.append(row);}
 }
 document.body.style.setProperty('--rpos-cell',cssUrl(sprite('cell')));document.body.style.setProperty('--rpos-shadow',cssUrl(sprite('window_dropshadow_sprite')));
 const shadow=hud.sprites.window_dropshadow_sprite,{outer,inner}=shadow,borders=[inner.y-outer.y,outer.x+outer.width-inner.x-inner.width,outer.y+outer.height-inner.y-inner.height,inner.x-outer.x];document.body.style.setProperty('--rpos-slices',borders.join(' '));document.body.style.setProperty('--rpos-border',borders.map(v=>v+'px').join(' '));
 const grid=layout.windows.InventoryPanel.nodes.flatMap(n=>n.components.RPOSInvCellManager??[])[0],pack=document.querySelector('#pack');
 pack.style.setProperty('--rpos-columns',grid.NumCellsHorizontal);pack.style.setProperty('--rpos-gap',grid.CellSpacing+'px');document.querySelector('#inventory').classList.add('rpos-inventory');
 const columns=document.querySelector('.inventory-columns'),main=columns.firstElementChild;main.classList.add('rpos-bag');const armor=document.createElement('section');armor.id='armor-panel';
 const heading=document.createElement('h3');text(heading,layout.windows.ArmorPanel.title.toUpperCase());const equipment=document.querySelector('#equipment'),oldHeading=equipment.previousElementSibling,oldHelp=equipment.nextElementSibling;oldHeading.remove();oldHelp?.remove();armor.append(heading,equipment);
 const effectsLabel=document.createElement('h4');text(effectsLabel,'EFFECTS');const totals=document.createElement('dl');totals.id='armor-totals';armor.append(effectsLabel,totals);columns.prepend(armor);document.querySelector('#inventory').setAttribute('aria-label','Inventory');
 const armorLabels=layout.windows.ArmorPanel.nodes.flatMap(n=>(n.components.UILabel??[]).filter(d=>['HEAD','CHEST','LEGS','BOOTS'].includes(d.mText)).map(d=>({text:d.mText,y:n.position.y}))).sort((a,b)=>b.y-a.y).map(x=>x.text);
 for(const el of document.querySelectorAll('#inventory h3'))if(!el.classList.contains('rpos-text'))text(el,el.textContent.toUpperCase());
 const note=document.querySelector('.inventory-heading small');if(note)note.textContent='';
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('aria-hidden','true');svg.classList.add('rpos-filters');svg.innerHTML='<defs><filter id="rpos-red" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"/></filter><filter id="rpos-yellow" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0  0 0.92156863 0 0 0  0 0 0.015686275 0 0  0 0 0 1 0"/></filter></defs>';document.body.append(svg);
 const desktop=createDesktopInventory({document,layout,text});
 // NGUI UIButton hover/pressed colours (browser/rpos-sounds.mjs) as a constructed stylesheet after style.css: the game's
 // CSP (style-src 'self') refuses <style> elements but not CSSOM.
 const buttonColors=rposButtonColors(layout.sounds,{bumper:layout.bumper}),buttonSheet=new document.defaultView.CSSStyleSheet();buttonSheet.replaceSync(rposButtonCss(buttonColors));document.adoptedStyleSheets=[...document.adoptedStyleSheets,buttonSheet];
 // UIDraggablePanel of a window's ScrolledPanel (browser/rpos-scroll.mjs) and where its scroll bar sits in the window
 // (the bar's pivot-Top background is centred on the Scroll Bar node), or null when the window has none enabled.
 function scroll(key){const config=Object.entries(layout.scrolling??{}).find(([path])=>path.endsWith('/'+key+'/ScrolledPanel'))?.[1];if(!config?.enabled||!config.verticalScrollBar)return null;
  const w=layout.windows[key],b=w.nodes.find(n=>n.name==='WindowBackground'),bar=w.nodes.find(n=>n.name==='Scroll Bar'),width=config.verticalScrollBar.background.scale.x;
  return {config,bar:{left:Math.round(bar.position.x-b.position.x-width/2),top:Math.round(b.position.y-bar.position.y)}};}
 // A window node in its WindowBackground's coordinates (the background's pivot is TopLeft; y grows down), parents summed.
 function windowNode(key,name,parentName=null){const w=layout.windows[key],b=w?.nodes.find(n=>n.name==='WindowBackground'),n=w?.nodes.find(x=>x.name===name&&(parentName===null||w.nodes[x.parent]?.name===parentName));if(!b||!n)return null;
  let x=n.position.x,y=n.position.y;for(let i=n.parent;i>0;i=w.nodes[i].parent){x+=w.nodes[i].position.x;y+=w.nodes[i].position.y;}return {x:x-b.position.x,y:b.position.y-y,node:n};}
 const anchor=pivot=>[[0,.5,1][pivot%3],[0,.5,1][Math.floor(pivot/3)]]; // NGUI UIWidget.Pivot 0 TopLeft … 4 Center … 8 BottomRight
 // A text() label at its UILabel node, by the label's pivot (14 px line, as the window titles).
 function placeLabel(element,key,name,parentName=null){const p=windowNode(key,name,parentName),d=p?.node.components.UILabel?.[0];if(!d)return false;const [ax,ay]=anchor(d.mPivot??0),width=element.querySelector('canvas')?.width??0;
  element.style.left=Math.round(p.x-width*ax)+'px';element.style.top=Math.round(p.y-14*ay)+'px';return true;}
 // An element covering a (sliced) sprite node: its scale is the size (colours stay with the UIButton stylesheet).
 function placeSprite(element,key,name,parentName=null){const p=windowNode(key,name,parentName),d=p?.node.components.UISlicedSprite?.[0]??p?.node.components.UISprite?.[0];if(!d)return false;const [ax,ay]=anchor(d.mPivot??0),{x:w,y:h}=p.node.scale;
  Object.assign(element.style,{left:Math.round(p.x-w*ax)+'px',top:Math.round(p.y-h*ay)+'px',width:w+'px',height:h+'px',bottom:'auto'});return true;}
 return {sounds:layout.sounds??null,windowNode,placeLabel,placeSprite,bumper:layout.bumper??null,buttonColors,scroll,cell(button,data,item,{number=null}={}){const s=cellState(data,item);button.dataset.tint=s.tint;const icon=button.querySelector('img');if(icon&&s.tint!=='white')icon.style.filter=`url(#rpos-${s.tint})`;
   const slot=Number(button.dataset.slot);if(!item&&slot>=36&&slot<40){const label=document.createElement('b');label.className='rpos-armor-label';text(label,armorLabels[slot-36]);button.setAttribute('aria-label',`Empty ${armorLabels[slot-36].toLowerCase()} armour slot`);button.append(label);}
   if(s.label){const label=document.createElement('span');label.className='rpos-count';label.dataset.color=s.color;const width=text(label,s.label,s.color,{cell:true});label.style.minWidth=(width+12)+'px';button.append(label);}
   if(number!=null){const key=document.createElement('small');key.className='rpos-number';text(key,String(number),'white',{cell:true});button.append(key);}
   if(s.mods.length){const mods=document.createElement('i');mods.className='rpos-mods';mods.setAttribute('aria-label',`${s.mods.filter(Boolean).length} of ${s.mods.length} attachment slots used`);for(const used of s.mods){const dot=document.createElement('img');dot.src=sprite(used?'slot_full':'slot_empty');dot.alt=used?'Filled attachment slot':'Empty attachment slot';mods.append(dot);}button.append(mods);}
  },container(grid,kind){const layoutKey=kind==='fire'?'RPOSFireContentsWindow':kind==='repair'?'RPOSRepairBenchWindow':null,config=layoutKey&&layout.containers?.[layoutKey];grid.classList.toggle('rpos-shaped-container',Boolean(config));for(const k of ['height','width','left','top'])grid.style.removeProperty(k);
   if(!config)return;const minX=Math.min(...config.cells.map(c=>c.x)),minY=Math.min(...config.cells.map(c=>c.y)),width=Math.max(...config.cells.map(c=>c.x))-minX+config.cellSize,height=Math.max(...config.cells.map(c=>c.y))-minY+config.cellSize;
   // Cells sit where the window's Cell nodes are (container y is the node's −y): fire 21,36; repair bench 94,68.
   const b=layout.windows[layoutKey]?.nodes.find(n=>n.name==='WindowBackground');if(b){grid.style.left=Math.round(minX-b.position.x)+'px';grid.style.top=Math.round(b.position.y+minY)+'px';}
   grid.style.width=width+'px';grid.style.height=height+'px';for(const cell of config.cells){const b=grid.querySelector(`[data-loot="${cell.slot}"]`);if(b){b.style.left=(cell.x-minX)+'px';b.style.top=(cell.y-minY)+'px';b.style.width=config.cellSize+'px';b.style.height=config.cellSize+'px';}}
  },window:kind=>desktop.right(kind),onWindowClose:fn=>desktop.onWindowClose(fn),hideCrafting:()=>desktop.hideCrafting(),armor(slots,items,values=null){totals.replaceChildren();for(const row of armorRows(slots,items,values)){const term=document.createElement('dt'),value=document.createElement('dd');text(term,row.name);text(value,'+'+row.value,'green');totals.append(term,value);}},text,paragraph,sprite};
}
