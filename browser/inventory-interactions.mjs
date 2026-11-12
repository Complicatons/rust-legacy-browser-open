// DOM presentation for native item details/dragging. Inventory changes stay with the supplied inventory API.
import {HeldItem} from './held-item.mjs';
// ItemToolTip.RepositionAtCursor (SetToolTip, once when it shows; Update is empty and UICamera.stickyTooltip keeps it
// still while the cursor stays on the cell): the tooltip's top-left corner at the cursor, moved left by what passes the
// screen's right edge and up by what passes its bottom edge. No offset and no left/top clamp.
export function tooltipPosition(cursor,size,screen){return {left:cursor.x-Math.max(0,cursor.x+size.width-screen.width),top:cursor.y-Math.max(0,cursor.y+size.height-screen.height)};}
// RPOS.ItemCellDrop reads the source slot when the drop happens: every server GNUP builds new slot objects, so the item is
// matched by its datablock key (the server validates the move itself); an emptied or changed slot drops nothing.
export const dropSourceValid=(current,carried)=>Boolean(current&&carried)&&current.item===carried.item;
export function createInventoryInteractions({dialog,skin,rows,item,move,quickMove=()=>{},drop=()=>{},onCancel=()=>{},onDrag=()=>{}}){
 const tip=document.createElement('aside');tip.id='item-tooltip';tip.setAttribute('role','tooltip');tip.hidden=true;dialog.append(tip);
 const ghost=document.createElement('div');ghost.id='item-drag';ghost.hidden=true;ghost.setAttribute('aria-hidden','true');dialog.append(ghost);
 let hover=null,timer=null,drag=null,suppress=false,pointer={x:0,y:0},frame=0,lastTime=0;
 // GUIHeldItem: the carried icon eases in from its cell and fades into the cell it is put in (browser/held-item.mjs).
 const held=new HeldItem(),centroid=b=>{const r=b?.getBoundingClientRect();return r?[r.left+r.width/2,r.top+r.height/2]:null;};
 const button=reference=>reference&&dialog.querySelector(reference.kind==='loot'?`[data-loot="${reference.index}"]`:`[data-slot="${reference.index}"]`);
 function draw(time){frame=0;const dt=lastTime?Math.min(0.1,(time-lastTime)/1000):0;lastTime=time;const at=held.update(dt,[pointer.x,pointer.y]);
  if(!at){ghost.hidden=true;lastTime=0;return;}ghost.hidden=false;ghost.style.left=(at.x-32)+'px';ghost.style.top=(at.y-32)+'px';ghost.style.opacity=String(at.alpha);frame=requestAnimationFrame(draw);}
 const animate=()=>{if(!frame)frame=requestAnimationFrame(draw);};
 function carry(b){const image=b?.querySelector(':scope > img')?.cloneNode();ghost.replaceChildren();if(!image){held.clear();return;}ghost.append(image);held.set(image,centroid(b),[pointer.x,pointer.y]);animate();}
 function letGo(into){if(into)held.clearInto(centroid(into));else held.clear();animate();}
 dialog.addEventListener('dragstart',e=>e.preventDefault());
 const slot=target=>{const b=target?.closest?.('.item-slot');return b&&dialog.contains(b)?b:null;};
 const ref=b=>b?.dataset.loot!=null?{kind:'loot',index:Number(b.dataset.loot)}:b?.dataset.slot!=null?{kind:'inventory',index:Number(b.dataset.slot)}:null;
 function hide(){clearTimeout(timer);timer=null;tip.hidden=true;if(hover)hover.removeAttribute('aria-describedby');hover=null;}
 function position(x,y){const box=tip.getBoundingClientRect(),p=tooltipPosition({x,y},box,{width:innerWidth,height:innerHeight});tip.style.left=p.left+'px';tip.style.top=p.top+'px';}
 function show(button,x,y){if(drag||!button.isConnected||!dialog.open)return;const data=rows(ref(button));tip.replaceChildren();if(!data.length)return;
  for(const row of data){const el=document.createElement('div');el.className='tooltip-'+row.kind;
   if(row.kind==='title'){const icon=button.querySelector(':scope > img')?.cloneNode();if(icon)el.append(icon);const label=document.createElement('div');skin.paragraph(label,row.text,'white',145);el.append(label);}
   else if(row.kind==='progress'){const label=document.createElement('span'),value=document.createElement('span');skin.text(label,row.text);skin.text(value,row.amount);const bar=document.createElement('progress');bar.max=1;bar.value=Math.max(0,Math.min(1,row.fraction));el.append(label,bar,value);}
   else if(row.kind==='stat'){const label=document.createElement('span'),value=document.createElement('span');skin.text(label,row.text);skin.text(value,row.value,row.color);el.append(label,value);}
   else skin.paragraph(el,row.text,row.color??'white');tip.append(el);
  }tip.hidden=false;button.setAttribute('aria-describedby',tip.id);position(x,y);
 }
 // UICamera tooltipDelay (1 s), then SetToolTip at the cursor where it is by then (UICamera.lastMousePosition).
 dialog.addEventListener('pointerover',e=>{pointer={x:e.clientX,y:e.clientY};const b=slot(e.target);if(!b||b===hover||drag)return;hide();hover=b;timer=setTimeout(()=>show(b,pointer.x,pointer.y),1000);});
 dialog.addEventListener('pointerout',e=>{if(hover&&!hover.contains(e.relatedTarget))hide();});
 dialog.addEventListener('focusin',e=>{const b=slot(e.target);if(b){hide();hover=b;show(b,b.getBoundingClientRect().right,b.getBoundingClientRect().top);}});
 dialog.addEventListener('focusout',hide);dialog.addEventListener('scroll',hide,true);
 dialog.addEventListener('pointerdown',e=>{pointer={x:e.clientX,y:e.clientY};if(e.button!==0||e.pointerType==='touch')return;const b=slot(e.target),source=ref(b),value=source&&item(source);if(!value)return;
  hide();drag={source,value,button:b,x:e.clientX,y:e.clientY,id:e.pointerId,active:false};
 });
 // UICamera: a held left button starts the drag (DragState(true) -> RPOSInventoryCell.OnDragState -> Item_CellDragBegin)
 // on the first frame the mouse moves at all; mouseClickThreshold (10 px) only decides whether the release is a click.
 dialog.addEventListener('pointermove',e=>{pointer={x:e.clientX,y:e.clientY};if(!drag||e.pointerId!==drag.id)return;
  if(!drag.active&&(e.clientX!==drag.x||e.clientY!==drag.y)){drag.active=true;dialog.setPointerCapture(e.pointerId);onDrag();hide();carry(drag.button);drag.button.classList.add('drag-origin');}
  if(drag.active)e.preventDefault();
 });
 function cancel(notify=true){if(drag?.button)drag.button.classList.remove('drag-origin');if(drag)button(drag.source)?.classList.remove('drag-origin');if(drag&&dialog.hasPointerCapture(drag.id))dialog.releasePointerCapture(drag.id);drag=null;hide();if(notify){held.clear();held.opaque();animate();onCancel();}}
 dialog.addEventListener('pointerup',e=>{if(!drag||e.pointerId!==drag.id)return;const d=drag,landing=slot(document.elementFromPoint(e.clientX,e.clientY)),target=ref(landing);cancel(false);
  // A plain click (no drag) with Shift or Ctrl held: quick-move to the other open inventory (loot <-> player), same
  // convention as most inventory UIs. Not original RPOS behaviour (RPOSInventoryCell.OnClick is empty, drag-only).
  if(!d.active){if(e.shiftKey||e.ctrlKey)quickMove(d.source);return;}
  suppress=true;setTimeout(()=>suppress=false,0);
  if(!dropSourceValid(item(d.source),d.value)){letGo(null);return;}
  // RPOSInventoryCell drag end: a landing cell takes the icon (ClearHeldItem(end)); landing outside the windows tosses
  // the item (TossItem clears it at once); anywhere else the icon goes back into its own cell (Item_CellReset).
  const outside=!target&&!document.elementFromPoint(e.clientX,e.clientY)?.closest('.rpos-window,#belt,.inventory-nav');letGo(target?landing:outside?null:button(d.source));
  if(target)move(d.source,target,{shift:e.shiftKey});else if(outside)drop(d.source);
 });
 dialog.addEventListener('click',e=>{if(suppress){e.preventDefault();e.stopImmediatePropagation();}},true);
 dialog.addEventListener('pointercancel',cancel);dialog.addEventListener('close',cancel);addEventListener('blur',cancel);addEventListener('resize',cancel);
 addEventListener('pointerup',e=>{if(drag&&!dialog.contains(e.target))cancel();});
 dialog.addEventListener('keydown',e=>{if(e.code==='Escape'&&drag){e.preventDefault();cancel();}});
 // A repaint during a drag rebuilds the cells: the source cell keeps its emptied look (RPOSInventoryCell shows nothing for the
 // carried item: icon, stack label and mod dots hidden) and the drag follows the new button.
 function refresh(){if(!drag?.active)return;const b=button(drag.source);if(!b)return;drag.button=b;b.classList.add('drag-origin');}
 return {reset:cancel,refresh,isDragOrigin:r=>Boolean(drag?.active&&r&&drag.source.kind===r.kind&&drag.source.index===r.index),held:()=>({visible:held.visible,carrying:held.hasItem,fading:held.fadingOut,alpha:held.alpha,position:held.position})};
}

export function enableInventoryWindows(dialog){let raised=1;
 for(const panel of dialog.querySelectorAll('.inventory-columns > section')){const headings=panel.querySelector('#craft-panel')?[...panel.querySelectorAll('#loot-title,#craft-panel > h3')]:[panel.querySelector('h3')].filter(Boolean);let drag=null,offset={x:0,y:0};
  for(const heading of headings){heading.classList.add('rpos-window-title');
  heading.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY,start:{...offset},box:panel.getBoundingClientRect(),bounds:dialog.getBoundingClientRect()};heading.setPointerCapture(e.pointerId);panel.style.zIndex=String(++raised);e.preventDefault();});
  heading.addEventListener('pointermove',e=>{if(!drag)return;const x=Math.max(drag.bounds.left-drag.box.left,Math.min(e.clientX-drag.x,drag.bounds.right-drag.box.right)),y=Math.max(drag.bounds.top-drag.box.top,Math.min(e.clientY-drag.y,drag.bounds.bottom-drag.box.bottom));offset={x:drag.start.x+x,y:drag.start.y+y};panel.style.setProperty('--drag-x',offset.x+'px');panel.style.setProperty('--drag-y',offset.y+'px');});
  const end=()=>drag=null;heading.addEventListener('pointerup',end);heading.addEventListener('pointercancel',end);dialog.addEventListener('close',end);
  }
  addEventListener('resize',()=>{drag=null;offset={x:0,y:0};panel.style.setProperty('--drag-x','0px');panel.style.setProperty('--drag-y','0px');});
 }
}
