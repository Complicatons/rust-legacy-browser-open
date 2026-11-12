// Original RPOS windows are anchored at bottom-centre. Sprite positions include their shadow margins.
export function createDesktopInventory({document,layout,text}){
 // RPOSBumper.Populate: one clone of the bumper prefab per titled RPOS.windowList entry, 75 px apart plus 5, the first at
 // −75 × count / 2 from the bumper; under them a stretchcell strip (75 × count + count − 5 wide, the original's operator
 // precedence) at x = −width / 2 and the bumper's own y again. The bumper sits 3.70 px above the top-centre anchor.
 let onWindowClose=null;const dialog=document.querySelector('#inventory'),columns=dialog.querySelector('.inventory-columns'),bag=columns.querySelector('.rpos-bag'),armor=columns.querySelector('#armor-panel'),right=columns.lastElementChild;
 const source=key=>{const w=layout.windows[key],root=w.nodes[0],background=w.nodes.find(n=>n.name==='WindowBackground');return {w,root,background};};
 function window(key,panel,title){const {w,root,background:b}=source(key);panel.classList.add('rpos-window');panel.dataset.nativeWindow=key;
  for(const [name,value]of Object.entries({'window-left':root.position.x+b.position.x,'window-bottom':root.position.y+b.position.y,'window-width':b.scale.x,'window-height':b.scale.y}))panel.style.setProperty('--'+name,Math.round(value)+'px');
  const label=w.nodes.find(n=>n.name==='WindowLabel'),data=label?.components.UILabel?.[0];if(title&&label&&data){const pivot=data.mPivot,xAnchor=[0,.5,1][pivot%3],yAnchor=[0,.5,1][Math.floor(pivot/3)],width=title.querySelector('canvas')?.width??0;
   title.style.left=Math.round(label.position.x-b.position.x-width*xAnchor)+'px';title.style.top=Math.round(b.position.y-label.position.y-14*yAnchor)+'px';}
  // Only the fire, loot and repair windows' CloseButton GameObjects are active; the crafting and armor ones are inactive
  // in the scene and no RPOS code activates them. The right-hand panel shows each of its windows in turn.
  const close=w.nodes.find(n=>n.name==='CloseButton');let button=panel.querySelector('.rpos-window-close');
  if(close&&!button){button=document.createElement('button');button.type='button';button.className='rpos-window-close';text(button,'X');button.onclick=()=>{if(onWindowClose)onWindowClose(button.dataset.window);else{panel.hidden=true;sync();}};panel.append(button);}
  if(button){button.hidden=!(close&&close.active!==false);if(!button.hidden){button.dataset.window=key;button.setAttribute('aria-label','Close '+w.title);button.style.left=Math.round(close.position.x-b.position.x-6)+'px';button.style.top=Math.round(b.position.y-close.position.y-6)+'px';}}
 }
 window('InventoryPanel',bag,bag.querySelector('h3'));window('ArmorPanel',armor,armor.querySelector('h3'));window('RPOSCraftWindow',right,right.querySelector('#craft-panel > h3'));
 const nav=document.createElement('nav');nav.className='inventory-nav';nav.setAttribute('aria-label','Inventory windows');const buttons=[];
 const panels={InventoryPanel:bag,ArmorPanel:armor,RPOSCraftWindow:right},bumper=layout.bumper,windows=bumper?.windows??[{title:'Inventory',window:'InventoryPanel'},{title:'Armor',window:'ArmorPanel'},{title:'Crafting',window:'RPOSCraftWindow'}];
 if(bumper){const bg=bumper.prefab.nodes.find(n=>n.name==='Background'),y=bumper.position.y,count=windows.length,stripWidth=count*bumper.buttonWidth+(count-1*bumper.spacing);
  nav.style.setProperty('--bumper-left',(-count*bumper.buttonWidth/2)+'px');nav.style.setProperty('--bumper-top',(-y)+'px');nav.style.setProperty('--bumper-gap',bumper.spacing+'px');nav.style.setProperty('--bumper-width',bumper.buttonWidth+'px');nav.style.setProperty('--bumper-height',(bg?.scale.y??20)+'px');
  const strip=document.createElement('i');strip.className='rpos-bumper-strip';strip.setAttribute('aria-hidden','true');strip.style.width=stripWidth+'px';strip.style.left=(-stripWidth/2+count*bumper.buttonWidth/2)+'px';strip.style.top=(-y)+'px';strip.style.height=bumper.background.scale.y+'px';
  strip.style.backgroundColor=`rgb(${bumper.background.color.slice(0,3).map(v=>Math.round(v*255)).join(' ')})`;nav.append(strip);}
 for(const {title,window:key}of windows){const panel=panels[key];if(!panel)continue;const b=document.createElement('button');b.type='button';b.className='rpos-bumper-button';text(b,title);b.onclick=()=>{panel.hidden=!panel.hidden;sync();};nav.append(b);buttons.push([b,panel]);}dialog.append(nav);
 function sync(){for(const [b,p]of buttons)b.setAttribute('aria-pressed',String(!p.hidden));}
 const effects=armor.querySelector('h4');effects.style.left='130px';effects.style.top='51px';
 // Original cells are 64px, with the source armour row spacing and effects columns to their right.
 document.querySelector('#equipment').style.left='20px';document.querySelector('#equipment').style.top='50px';document.querySelector('#armor-totals').style.left='100px';document.querySelector('#armor-totals').style.top='98px';
 const close=document.querySelector('#inventory-close');text(close,'Close');
 let previousKind='craft';sync();return {right(kind){if(kind!==previousKind&&kind!=='craft')right.hidden=false;previousKind=kind;const key=kind==='fire'?'RPOSFireContentsWindow':kind==='repair'?'RPOSRepairBenchWindow':kind==='loot'?'RPOSLootWindow':'RPOSCraftWindow';window(key,right,right.querySelector(kind==='craft'?'#craft-panel > h3':'#loot-title'));},sync,
  // RPOSWindow close button → the window's own close (loot/fire/repair: RPOSLootWindow.LootClosed, set by inventory-ui).
  onWindowClose(fn){onWindowClose=fn;},hideCrafting(){right.hidden=true;sync();}};
}
