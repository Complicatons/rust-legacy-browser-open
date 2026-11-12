import {LegacyInventory} from './inventory.mjs';
import {itemTooltip,tooltipText} from './tooltip.mjs';
import {createRposSkin} from './rpos.mjs';
import {blueprintGroups,craftModifier,requestedCraftAmount,craftProgress} from './crafting.mjs';
import {quickMoveSlot} from './item-ops.mjs';
import {createInventoryInteractions,enableInventoryWindows} from './inventory-interactions.mjs';
import {createRposSounds,craftStartEdge,createRposTweens} from './rpos-sounds.mjs';
import {attachRposScroll} from './rpos-scroll.mjs';
import {repairWindowState} from './repair.mjs';
// The HUD belt cell click (port-only: the original's cursor was locked with RPOS closed) is a belt key press, so it obeys
// the same gate as keys 1-6 (keyGate.belt: alive, nothing polling-blocked, no context popup).
export const beltCellClickAllowed=(dialogOpen,keyGate)=>!dialogOpen&&Boolean(keyGate?.belt?.());
// The right-click menu observes the item it opened for: shown while RPOS is open and that cell still holds that object.
export const itemMenuStale=({shown,dialogOpen,slots,index,slot})=>Boolean(shown)&&(!dialogOpen||slots[index]!==slot);
export async function createInventoryUI({inventoryFactory=c=>new LegacyInventory(c),input=null,playSound=null}={}){const r=await fetch('/assets/recovered/items/manifest.json');if(!r.ok)throw Error('Original item export missing');const catalogue=await r.json(),inventory=inventoryFactory(catalogue),dialog=document.querySelector('#inventory'),belt=document.querySelector('#belt'),pack=document.querySelector('#pack'),equipment=document.querySelector('#equipment'),recipeSelect=document.querySelector('#recipe'),details=document.querySelector('#recipe-details'),craft=document.querySelector('#craft'),craftStatus=document.querySelector('#craft-status'),lootPanel=document.querySelector('#loot-panel'),lootGrid=document.querySelector('#loot'),lootTitle=document.querySelector('#loot-title');
 let lastPaint=0,loot=null,onLootClose=null,itemActions=()=>[],beltUse=null,workbench=()=>false,toss=()=>false,notice=m=>{inventory.message=m;};const menu=document.querySelector('#item-menu');
 // Which keys reach RPOS (setKeyGate, main.mjs). inventory: HumanController.InputSample.Poll returns default while
 // ConsoleWindow/MainMenu/ChatUI/LockEntry is visible, and nothing polls before the controllable exists. belt:
 // CheckBeltUsage (no focused text field, no console) -> PollItemButtons, which needs LockCursorManager.keySubsetEnabled
 // (every unlock node that is on has AllowSubsetOfKeys: only RPOS's "RPOS UNLOCKER", RPOS.cs; not chat, console, main
 // menu, lock entry, context popup or death screen).
 let keyGate={inventory:()=>true,belt:()=>true};
 if(inventory.network){dialog.querySelector('.inventory-heading small').textContent='Server inventory';document.querySelector('label[for="recipe"]').textContent='Known blueprints';}
 const skin=await createRposSkin();
 // RPOS UIButtonSound "Tap" clicks and RPOSCraftWindow.craftSound (browser/rpos-sounds.mjs); playSound(file, volume, pitch).
 const rposSounds=createRposSounds(skin.sounds,{bumper:skin.bumper}),craftEdge=craftStartEdge(),play=s=>{if(s)playSound?.(s.file,s.volume,s.pitch);};
 document.querySelector('#inventory').addEventListener('click',e=>play(rposSounds.click(e.target,loot?.layout??null)),true);
 // UIButtonScale/UIButtonOffset hover and press tweens (armor, fire and repair cells).
 const rposTweens=createRposTweens(skin.sounds,{bumper:skin.bumper,colors:skin.buttonColors}),tweenState=(el,state)=>{const t=rposTweens.of(el,loot?.layout??null);if(t)Object.assign(el.style,rposTweens.style(t,state));};
 {const inv=document.querySelector('#inventory'),cellOf=e=>e.target?.closest?.('.item-slot,.rpos-window-close,.rpos-bumper-button');
  inv.addEventListener('pointerover',e=>{const c=cellOf(e);if(c&&!c.contains(e.relatedTarget))tweenState(c,'hover');});
  inv.addEventListener('pointerout',e=>{const c=cellOf(e);if(c&&!c.contains(e.relatedTarget))tweenState(c,'normal');});
  inv.addEventListener('pointerdown',e=>{const c=cellOf(e);if(c)tweenState(c,'pressed');});
  inv.addEventListener('pointerup',e=>{const c=cellOf(e);if(c)tweenState(c,'hover');});}
 const resolveItem=ref=>ref.kind==='inventory'?inventory.slots[ref.index]:loot?.slots[ref.index];
 // RPOS.ItemCellClicked: occupied target → merge (Shift → combine), empty target → move; never a swap. Online requests are
 // predicted and sent by ServerInventory (no local change); offline the server SlotOperation runs after the prediction.
 const lootBox=()=>({slots:loot.slots,player:false,accepts:(i,k)=>!loot.accepts||loot.accepts(i,inventory.item(k))});
 // ResearchToolItem.TryCombine asks PlayerInventory.AtWorkBench (CraftingInventory: a second's grace after the bench
 // zone), as crafting does: craftBench(), not only the live zone.
 function moveItem(from,to,{shift=false}={}){if(from.kind===to.kind&&from.index===to.index)return;const o={combine:Boolean(shift),atWorkbench:craftBench(),notice};
  if(from.kind==='inventory'&&to.kind==='inventory')inventory.move(from.index,to.index,o);
  else if(inventory.network){if(from.kind==='inventory')loot?.store?.(from.index,to.index,o);else if(to.kind==='inventory')loot?.takeTo?.(from.index,to.index,o);else loot?.move?.(from.index,to.index,o);}
  else if(loot){const box=ref=>ref.kind==='inventory'?inventory.box():lootBox();inventory.transfer({box:box(from),index:from.index},{box:box(to),index:to.index},o);}
  paint();
 }
 // Shift-click quick-move (owner playtest, 2026-10-29): quickMoveSlot (item-ops.mjs) picks the destination.
 function quickMove(ref){const from=resolveItem(ref);if(!loot||!from)return;const toKind=ref.kind==='loot'?'inventory':'loot';
  const toBox=toKind==='inventory'?inventory.box():lootBox(),index=quickMoveSlot(catalogue,toBox,from.item);
  if(index<0){notice(toKind==='inventory'?'Your inventory is full':'No room in the loot window');return;}
  moveItem(ref,{kind:toKind,index},{});}
 const interactions=createInventoryInteractions({dialog,skin,item:resolveItem,rows:ref=>{const i=resolveItem(ref);return i?itemTooltip(catalogue.items[i.item],i,catalogue):[];},move:(from,to,o)=>moveItem(from,to,o),quickMove,drop:ref=>{if(ref.kind==='inventory'){toss(ref.index);paint();}},onDrag:()=>hideMenu()});enableInventoryWindows(dialog);
 const craftBench=()=>inventory.nearWorkbench(workbench(),performance.now()/1000);
 let desiredAmount=1;const blueprintList=document.createElement('div');blueprintList.id='blueprint-list';blueprintList.setAttribute('aria-label','Known blueprints');recipeSelect.before(blueprintList);recipeSelect.hidden=true;document.querySelector('label[for="recipe"]').hidden=true;
 // UIDraggablePanel + UIScrollBar on the blueprint list and the loot window (browser/rpos-scroll.mjs); rows and cells are the hot spots.
 const scrollers=[[blueprintList,'RPOSCraftWindow','[data-blueprint]',()=>true],[lootGrid,'RPOSLootWindow','.item-slot',()=>!lootGrid.classList.contains('rpos-shaped-container')]].flatMap(([list,key,hotSpots,active])=>{const s=skin.scroll(key);if(!s)return [];
  const scroller=attachRposScroll({list,config:s.config,hotSpots,active});scroller.track.style.left=s.bar.left+'px';scroller.track.style.top=s.bar.top+'px';list.after(scroller.track);return [scroller];});
 const quantities=document.createElement('div');quantities.id='craft-quantity';quantities.innerHTML='<button type="button" id="craft-minus" aria-label="Decrease craft quantity">−</button><label for="craft-amount">Quantity</label><input id="craft-amount" inputmode="numeric" type="text" value="1" aria-label="Craft quantity"><button type="button" id="craft-plus" aria-label="Increase craft quantity">+</button>';details.before(quantities);
 const amountInput=quantities.querySelector('input'),progress=document.createElement('progress');progress.id='craft-progress';progress.max=1;progress.value=0;progress.setAttribute('aria-label','Crafting progress');craftStatus.before(progress);
 function setAmount(value){desiredAmount=requestedCraftAmount(value,inventory.maxCraft(recipeSelect.value));amountInput.value=String(desiredAmount);recipeInfo();}
 for(const [id,sign]of [['craft-minus',-1],['craft-plus',1]])document.querySelector('#'+id).onclick=e=>{if(!inventory.work)setAmount(desiredAmount+sign*craftModifier(e));};
 amountInput.addEventListener('input',()=>{amountInput.value=amountInput.value.replace(/\D/g,'').replace(/^0+/,'');});amountInput.addEventListener('change',()=>setAmount(amountInput.value));amountInput.addEventListener('blur',()=>{if(!amountInput.value)setAmount(1);});
 // RPOSItemRightClickMenu: one button per RetreiveMenuOptions entry (Split, then Study/Unload/Eat/Drink/Consume/Use).
 // The menu observes the item it opened for (menuSlot): a repaint that finds another object in that cell, or RPOS closing,
 // takes it down; a click acts on that item wherever it now is, or not at all (item-menu.mjs).
 let menuIndex=-1,menuSlot=null;const hideMenu=()=>{menu.hidden=true;menuIndex=-1;menuSlot=null;};
 function openMenu(index,x,y){const actions=itemActions(index)??[];menu.replaceChildren();if(!actions.length){hideMenu();return;}menuIndex=index;menuSlot=inventory.slots[index];
  for(const action of actions){const b=document.createElement('button');b.type='button';b.textContent=action.label;b.dataset.menuOption=action.label;b.onclick=()=>{hideMenu();action.run();paint();};menu.append(b);}
  const box=dialog.getBoundingClientRect();menu.style.left=`${x-box.left}px`;menu.style.top=`${y-box.top}px`;menu.hidden=false;menu.firstChild.focus();}
 // The datablock's own option (everything but Split); belt keys 1-6 run it only for BasicHealthKit items, as before.
 const primaryAction=index=>(itemActions(index)??[]).find(a=>a.label!=='Split')??null;
 dialog.addEventListener('click',e=>{if(!menu.contains(e.target))hideMenu();});
 function paintSlot(slot,index){const item=inventory.slots[index],button=document.createElement('button');button.type='button';button.className='item-slot'+(index===inventory.selected?' selected':'')+(index===inventory.selected&&item&&index>=30&&index<36?' active-item':'');button.dataset.slot=String(index);button.setAttribute('aria-label',item?inventory.item(item.item).m_Name:`Empty slot ${index}`);button.title=item?tooltipText(itemTooltip(catalogue.items[item.item],item,catalogue))||inventory.item(item.item).m_Name:`Empty slot ${index}`;
  if(item){const d=inventory.item(item.item),icon=catalogue.icons[d.icon];if(icon){const img=document.createElement('img');img.src='/assets/recovered/items/'+icon.file;img.alt=d.m_Name;button.append(img);}}
  skin.cell(button,item?inventory.item(item.item):{},item,{number:index>=30&&index<36?index-29:null});
  if(index<36&&item)button.oncontextmenu=e=>{e.preventDefault();openMenu(index,e.clientX,e.clientY);};
  // RPOSInventoryCell.OnClick is empty: items move only by dragging (RPOS.ItemCellClicked runs from the drag begin,
  // end and drop; inventory-interactions.mjs). The port keeps one click: a belt cell while RPOS is closed and the
  // cursor is free (no pointer lock), which the original never had (its cursor was locked then).
  if(index>=30&&index<36)button.onclick=()=>{if(!beltCellClickAllowed(dialog.open,keyGate))return;if(inventory.selectBelt)inventory.selectBelt(index);else if(beltUse)beltUse(index);else inventory.selected=index;paint();};
  if(slot!==belt){button.setAttribute('aria-description',button.title);button.removeAttribute('title');}slot.append(button);
 }
 // Original LootableObject container (RPOS loot window): its cells are RPOSInventoryCells too, so items go in and out
 // only by dragging (OnClick is empty).
 function paintLootSlot(index){const item=loot.slots[index],button=document.createElement('button');button.type='button';button.className='item-slot';button.dataset.loot=String(index);button.setAttribute('aria-label',item?inventory.item(item.item).m_Name:loot.labels?.[index]??`Empty loot slot ${index}`);button.title=item?tooltipText(itemTooltip(catalogue.items[item.item],item,catalogue))||inventory.item(item.item).m_Name:button.getAttribute('aria-label');
  if(item){const d=inventory.item(item.item),icon=catalogue.icons[d.icon];if(icon){const img=document.createElement('img');img.src='/assets/recovered/items/'+icon.file;img.alt=d.m_Name;button.append(img);}}skin.cell(button,item?inventory.item(item.item):{},item);
  button.setAttribute('aria-description',button.title);button.removeAttribute('title');lootGrid.append(button);
 }
 // RPOSRepairBenchWindow (Update → UpdateGUIAmounts every frame): ingredient, condition and needs labels at their nodes, and
 // the Repair button only while the item needs repairing (browser/repair.mjs repairWindowState).
 const REPAIR='RPOSRepairBenchWindow',repairInfo=document.createElement('div');repairInfo.id='repair-info';repairInfo.hidden=true;lootPanel.append(repairInfo);
 const repairLabels=['ConditionLabel','NeedLabel','Ing1','Ing2','Ing3','Ing4'].map(name=>{const el=document.createElement('p');el.className='rpos-repair-label';el.dataset.node=name;repairInfo.append(el);return el;});
 const needsDefault=skin.windowNode?.(REPAIR,'NeedLabel')?.node.components.UILabel?.[0]?.mText??'Needs:';let repairNeeds=needsDefault,repairKey='';
 function repairFrame(force=false){const on=loot?.layout==='repair';repairInfo.hidden=!on;if(!on){repairKey='';return;}
  const st=repairWindowState(loot.slots[0],catalogue,inventory,repairNeeds);repairNeeds=st.needs.text;const key=JSON.stringify(st);if(!force&&key===repairKey)return;repairKey=key;
  const rows=[st.condition,st.needs,...Array.from({length:4},(_,i)=>st.amounts[i]?{enabled:true,...st.amounts[i]}:{enabled:false,text:'',color:'white'})];
  rows.forEach((row,i)=>{const el=repairLabels[i];el.hidden=!row.enabled||!row.text;if(el.hidden){el.replaceChildren();return;}skin.text(el,row.text,row.color);skin.placeLabel?.(el,REPAIR,el.dataset.node);});
  const button=document.querySelector('#loot-action');if(!loot.action)return;button.hidden=!st.button;button.disabled=false;button.classList.add('rpos-repair-button');skin.text(button,loot.action.label);skin.placeSprite?.(button,REPAIR,'Background','RepairButton');}
 // RPOSCraftWindow: no result/duration title, and the Craft button is never disabled (CraftButtonClicked does nothing
 // when ValidateCraftRequirements / CanWork fail). ShowCraftingOptions(selectedItem != null) hides the options without one.
 function recipeInfo(){const key=recipeSelect.value,recipe=catalogue.blueprints[key];details.replaceChildren();craft.hidden=quantities.hidden=!recipe;craft.disabled=false;if(!recipe)return;
  const list=document.createElement('table');list.id='craft-ingredients';const header=document.createElement('tr');for(const label of ['ITEM','NEED','HAVE','']){const cell=document.createElement('th');skin.text(cell,label);header.append(cell);}list.append(header);
  for(const entry of recipe.ingredients){const need=entry.amount*desiredAmount,have=inventory.count(entry.item),ok=have>=need,row=document.createElement('tr');row.dataset.enough=String(ok);for(const [value,color]of [[inventory.item(entry.item).m_Name,'white'],[need.toLocaleString('en-US'),ok?'green':'red'],[have.toLocaleString('en-US'),ok?'green':'red']]){const cell=document.createElement('td');skin.text(cell,String(value),color);row.append(cell);}const mark=document.createElement('td'),image=document.createElement('img');image.src=skin.sprite(ok?'checkmark':'xmark');image.alt=ok?'Available':'Missing';mark.append(image);row.append(mark);list.append(row);}details.append(list);const requirement=document.createElement('p');requirement.id='craft-requirement';requirement.textContent=recipe.workbench?'REQUIRES WORKBENCH':'';requirement.style.color=craftBench()?'#00ff00':'#ff0000';details.append(requirement);craft.textContent=inventory.work?'Cancel':'Craft';craft.removeAttribute('title');
  for(const b of quantities.querySelectorAll('button,input'))b.disabled=Boolean(inventory.work);document.querySelector('#cancel-craft').hidden=true;
  for(const b of blueprintList.querySelectorAll('[data-blueprint]')){const selected=b.dataset.blueprint===key;b.setAttribute('aria-pressed',String(selected));b.classList.toggle('active',selected);}
 }
 function paint(){if(itemMenuStale({shown:!menu.hidden,dialogOpen:dialog.open,slots:inventory.slots,index:menuIndex,slot:menuSlot}))hideMenu();syncRecipes();if(dialog.open&&belt.parentElement!==dialog)dialog.append(belt);else if(!dialog.open&&belt.parentElement===dialog)document.body.append(belt);const dialogBelt=document.querySelector('#inventory-belt');belt.replaceChildren();dialogBelt.replaceChildren();pack.replaceChildren();equipment.replaceChildren();for(let i=0;i<30;i++)paintSlot(pack,i);for(let i=30;i<36;i++)paintSlot(belt,i);for(let i=36;i<40;i++)paintSlot(equipment,i);lootGrid.replaceChildren();lootPanel.hidden=!loot;document.querySelector('#craft-panel').hidden=Boolean(loot);skin.window(loot?loot.layout??'loot':'craft');const lootAction=document.querySelector('#loot-action');lootAction.hidden=!loot?.action;if(loot?.action){if(loot.layout!=='repair'){lootAction.classList.remove('rpos-text','rpos-repair-button');lootAction.removeAttribute('style');lootAction.textContent=loot.action.label;}lootAction.disabled=loot.action.enabled?!loot.action.enabled():false;lootAction.onclick=()=>{loot.action.run();paint();};}repairFrame(true);
  if(loot){skin.text(lootTitle,loot.title.toUpperCase());for(let i=0;i<loot.slots.length;i++)paintLootSlot(i);skin.container(lootGrid,loot.layout);if(loot.labels)for(const b of lootGrid.children){const label=document.createElement('small');label.className='rpos-container-label';skin.text(label,loot.labels[Number(b.dataset.loot)]??'');b.append(label);}}skin.armor(inventory.slots,catalogue.items,inventory.armorValues??null);recipeInfo();interactions.refresh();}
 let recipeKeys='';function syncRecipes(){const keys=[...inventory.known].join(',');if(keys===recipeKeys)return;recipeKeys=keys;const selected=recipeSelect.value;recipeSelect.replaceChildren();blueprintList.replaceChildren();
  for(const group of blueprintGroups(catalogue,inventory.known)){const heading=document.createElement('h4');skin.text(heading,group.name);blueprintList.append(heading);for(const key of group.keys){const name=inventory.item(catalogue.blueprints[key].result).m_Name,option=document.createElement('option');option.value=key;option.textContent=name;recipeSelect.append(option);const b=document.createElement('button');b.type='button';b.dataset.blueprint=key;skin.text(b,name);b.onclick=()=>{if(inventory.work)return;recipeSelect.value=key;desiredAmount=1;amountInput.value='1';recipeInfo();};blueprintList.append(b);}}if([...recipeSelect.options].some(o=>o.value===selected))recipeSelect.value=selected;}
 recipeSelect.onchange=()=>{desiredAmount=1;amountInput.value='1';recipeInfo();};
 // RPOS forceOff (rposLimitFlags KeepOff while dead): Tab/toggle/loot cannot open the windows.
 // RPOS is a non-modal dialog (show, not showModal): a modal one makes the rest of the page inert, and the original's
 // chat (HumanController.Poll opens ChatUI with RPOS up) and F1 console (ConsoleWindow.Update) work over it. It covers
 // the whole screen (style.css), so clicks never reach the world behind it.
 let forceOff=false;const toggle=()=>{if(dialog.open)dialog.close();else if(!forceOff)dialog.show();paint();};document.querySelector('#inventory-toggle').onclick=toggle;document.querySelector('#inventory-close').onclick=()=>dialog.close();
 // RPOSLootWindow.LootClosed (StopLooting, the window is destroyed; RPOS stays as it is), reached by its close button
 // (loot/fire/repair hidesWithCloseButton 0 → WindowClose → OnWindowHide), RPOS.CloseLootWindow and RPOS closing
 // (OnRPOSClosed). Crafting stays hidden until its bumper: OpenLootWindow's CloseWindowByName("Crafting") is an
 // ExternalClose, and the crafting window's hidesWithExternalClose 1 makes that a Hide (showWithRPOS false).
 function lootClosed(){if(!loot)return;const done=onLootClose;loot=null;onLootClose=null;skin.hideCrafting();paint();done?.();}skin.onWindowClose(lootClosed);
 dialog.addEventListener('close',()=>{if(dialog.open)return;hideMenu();if(loot)lootClosed();else paint();});
 // HumanController.ProcessInput: Escape (Input.GetKeyDown, nothing else checked) hides RPOS; MainMenu.Update toggles the
 // menu on the same key (front-end.mjs).
 addEventListener('keydown',e=>{if(e.code==='Escape'&&!e.repeat&&dialog.open)dialog.close();});
 craft.onclick=()=>{if(inventory.work){inventory.cancelCraft();inventory.message='Craft cancelled';}else{const result=inventory.startCraft(recipeSelect.value,performance.now()/1000,workbench(),desiredAmount);if(result.ok)inventory.message='Crafting…';}paint();};document.querySelector('#cancel-craft').onclick=()=>{inventory.cancelCraft();inventory.message='Craft cancelled';paint();};
 // Belt keys: InputManager UseItem1..UseItem6 (HumanController.PollItemButtons; 1-6, not rebindable). RPOS's unlock node
 // has AllowSubsetOfKeys, so they work with the windows open too (keyGate.belt).
 const beltKey=n=>{if(!keyGate.belt())return;const index=n+29;if(inventory.selectBelt)inventory.selectBelt(index);else if(beltUse)beltUse(index);else{inventory.selected=index;const action=primaryAction(index);if(action?.belt)action.run();}paint();};
 // GameButton "Inventory" IsPressed toggles RPOS (key-bindings.mjs); without a GameInput (focused checks) Tab and 1-6.
 if(input){input.addEventListener('press',e=>{if(e.detail.button==='Inventory'&&keyGate.inventory())toggle();});input.addEventListener('axis-press',e=>{const m=/^UseItem([1-6])$/.exec(e.detail.axis);if(m)beltKey(Number(m[1]));});}
 else addEventListener('keydown',event=>{if(event.target.matches('input,select,textarea'))return;if(event.code==='Tab'){event.preventDefault();if(keyGate.inventory())toggle();}if(/^Digit[1-6]$/.test(event.code))beltKey(Number(event.code.slice(-1)));});
 paint();return {inventory,isOpen:()=>dialog.open,refresh:paint,setKeyGate({inventory:i=null,belt:b=null}={}){keyGate={inventory:i??keyGate.inventory,belt:b??keyGate.belt};},setToss(fn){toss=fn;},setItemActions(fn){itemActions=fn;},setBeltUse(fn){beltUse=fn;},setWorkbench(fn){workbench=fn;},setNotice(fn){notice=fn;},itemAction:(index,label)=>label?(itemActions(index)??[]).find(a=>a.label===label)??null:primaryAction(index),itemActions:index=>itemActions(index)??[],openItemMenu:openMenu,
  openLoot(container,onClose){if(forceOff){onClose?.();return;}if(dialog.open)dialog.close();loot=container;repairNeeds=needsDefault;onLootClose=onClose;dialog.show();paint();},closeLoot:lootClosed,lootOpen:()=>Boolean(loot),
  // RPOS.SetRPOSMode(false) under KeepOff: closes every window (loot exit callbacks run) and keeps RPOS off until cleared.
  setForceOff(on){forceOff=Boolean(on);if(forceOff&&dialog.open)dialog.close();},
  update(now){if(dialog.open)for(const s of scrollers)s.update(now);const wasWorking=Boolean(inventory.work);inventory.update(now/1000,workbench());if(craftEdge(inventory.work))play(rposSounds.craft);if(wasWorking&&!inventory.work)paint();if(now-lastPaint>200){const p=craftProgress(inventory.work,now/1000);progress.value=p.fraction;progress.hidden=!catalogue.blueprints[recipeSelect.value];/* ShowCraftingOptions(selectedItem != null): the empty slider stays, only the time label goes */const label=inventory.work?(Number.isFinite(p.seconds)?p.seconds.toFixed(1):'0.0'):'',tone=p.rate>1?'green':p.rate<1?'yellow':'white';craftStatus.hidden=!inventory.work;if(craftStatus.dataset.label!==label+tone){craftStatus.dataset.label=label+tone;if(label)skin.text(craftStatus,label,tone);else craftStatus.textContent='';}if(dialog.open){recipeInfo();repairFrame();}lastPaint=now;}}};
}
