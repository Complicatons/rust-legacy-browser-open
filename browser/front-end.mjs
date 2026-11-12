import * as THREE from 'three';
import {loadFrontendSkin} from './frontend-skin.mjs';
import {createDfTree,loadDfAssets} from './dfgui.mjs';
import {tweenAt} from './popup-ui.mjs';
import {takeJoin,JOIN_KEY} from './online.mjs';
import {failedToConnectMessage} from './net-error.mjs';
import {loadMenuBackground} from './menu-background.mjs';
import {createFpsCounter} from './fps-counter.mjs';
import {GAME_BUTTONS,KeyBindings,DEFAULT_CONFIG,keyCodeForEvent,mouseKeyCode,fetchKey,listenText,bindingText,textBinding} from './key-bindings.mjs';
import {SERVERTYPE,OFFLINE_ADDRESS,shouldIgnoreServer,categoryFor,historyLabel,detailsText,sortServers,pageOf,paginationItems,playersText,pingText,fromCentral,centralTags,offlineServer,readList,rememberJoin,FavouriteList,FAVOURITES_KEY} from './server-list.mjs';
import {brandingText} from './client-commands.mjs';
import {createMenuAudio} from './menu-audio.mjs';

// The original front end (BuildPlayer-GameUI: MainMenu, OptionsWindow, ServerBrowser, LoadingScreen, PopupUI notices) for the
// player entry. Behaviour follows the decompiled MainMenu.cs, ServerBrowser.cs, ServerCategory.cs, ServerItem.cs,
// Pagination.cs, OptionsWindow.cs, ConvarBinding.cs, OptionsKeyBinding.cs, LoadingScreen.cs, RustLevel.cs, net.cs and
// Facepunch.Cursor.LockCursorManager; layout, sprites, fonts, colours and tweens are the static export (export_frontend.py).
// The developer explorer (?dev) never creates this.

export const LEVEL_NAME='rust_island_2013';
const HISTORY_KEY='rlb-server-history',NOTICE_KEY='rlb-notice',LAST_URL_KEY='net.lasturl';
const INERT_TITLE='Not available in the browser port yet';
// BlurEffect (iterations 3, blurSpread .6) on the GameUI BlurCamera (Don't Clear, empty culling mask, depth 50): a 4x
// downsample then three 4-tap cone passes at 0.5/1.1/1.7 quarter-resolution texels. Their per-axis variance (~82 px²)
// is matched by a Gaussian of ~9 screen pixels.
export const MENU_BLUR_PIXELS=9;

// Copies one node's subtree out of an exported hierarchy (parents re-indexed), optionally patching component data.
function subtree(nodes,rootIndex,patch=()=>{}){const out=[],map=new Map();const walk=(i,parent)=>{map.set(i,out.length);const node=structuredClone(nodes[i]);node.parent=parent;node.active=true;patch(node,out.length);out.push(node);nodes.forEach((n,j)=>{if(n.parent===i)walk(j,map.get(i));});};walk(rootIndex,-1);return out;}
const firstControl=node=>Object.values(node.components).flat().find(d=>d.layout);

export async function createFrontEnd({convars,renderSettings,input=null,session=globalThis.sessionStorage,local=globalThis.localStorage,inert=['render.vsync'],now=()=>Date.now()}){
 // The menu background downloads while the menu skin loads, unless a website join ticket skips the menu.
 let earlyBackground=null;try{if(!session?.getItem(JOIN_KEY)){earlyBackground=loadMenuBackground({aspect:innerWidth/innerHeight});earlyBackground.catch(()=>{});}}catch{}
 const skin=loadFrontendSkin(),assets=await loadDfAssets(skin),manifest=assets.manifest;
 const layer=document.createElement('div');layer.id='front-end';document.body.append(layer);
 const viewport=()=>({width:innerWidth,height:innerHeight});
 const menu=createDfTree(manifest.screens.MainMenu.nodes,assets,{container:layer,className:'df-menu',viewport});
 const loading=createDfTree(manifest.screens.LoadingScreen.nodes,assets,{container:layer,className:'df-loading',viewport});
 // GameUI Root/Overlay (GUIHide: gui.hide/gui.show) with the BrandingPanel (gui.hide_branding/show_branding): the
 // BrandingVersion label shows the client assembly's linker timestamp (exported statically from its PE header).
 const overlay=manifest.screens.Overlay?createDfTree(manifest.screens.Overlay.nodes,assets,{container:layer,className:'df-overlay',viewport}):null;
 const brandingPanel=overlay?.find('BrandingPanel'),versionLabel=overlay?.find('Version','BrandingPanel'),stamp=brandingPanel?.node.components.BrandingVersion?.[0]?.linkerTimestamp;
 if(versionLabel&&Number.isFinite(stamp))overlay.setText(versionLabel,brandingText(stamp));
 const popupLayer=document.createElement('div');popupLayer.className='df-layer df-popups';popupLayer.setAttribute('role','status');popupLayer.setAttribute('aria-live','polite');layer.append(popupLayer);
 document.documentElement.style.setProperty('--menu-blur',(MENU_BLUR_PIXELS/(devicePixelRatio||1)).toFixed(2)+'px');
 const M=(name,parent)=>menu.find(name,parent),root=menu.items[0],screenOptions=M('Options'),screenServers=M('ServerBrowser'),btnDisconnect=M('btnDisconnect');
 const state={connected:false,joining:false,inGame:false,leaving:false,central:null,me:undefined};let game=null,resolveChoice=null;
 // MainMenu.Awake: both sub-screens start hidden. DisableOnConnectedState (btnDisconnect, disableWhenConnected false): hidden until connected.
 menu.setVisible(screenOptions,false);menu.setVisible(screenServers,false);menu.setActive(btnDisconnect,false);
 // LoadingScreen.Awake: hidden. The VAC warning is never shown (no VAC protection is verified); its texture sprite has no texture.
 const L=name=>loading.find(name),loadingRoot=loading.items[0];loading.setActive(L('pnlVACWarning'),false);loading.setVisible(loadingRoot,false);
 const lblInfo=L('lblInfo'),pnlProgress=L('pnlProgress'),upperProgress=L('upperProgress');loading.setVisible(pnlProgress,false);
 const layoutAll=()=>{menu.layout();loading.layout();overlay?.layout();layoutServers(true);};addEventListener('resize',layoutAll);
 menu.layout();loading.layout();overlay?.layout();

 // ---- MainMenu ---------------------------------------------------------------------------------------------------
 const isVisible=()=>menu.isVisible(root);
 // Options left open re-read their values when the menu reappears (F1 console changes, e.g. grass.on, stay in sync).
 let refreshOptions=null;
 function show(){menu.setVisible(root,true);document.body.classList.add('rlb-menu-open');game?.release();refreshOptions?.();}
 function hide(){menu.setVisible(root,false);document.body.classList.remove('rlb-menu-open');hideLoading();}
 function hideAllBut(but){for(const s of [screenServers,screenOptions])if(s!==but)menu.setVisible(s,false);}
 function toggle(screen){hideAllBut(screen);menu.setVisible(screen,!menu.isVisible(screen));}
 // MainMenu.ShowInformation -> notice.popup 5 "" text (PopupUI.CreateNotice / PopupNotice.Setup).
 const noticePrefab=fetch('/assets/recovered/popup/manifest.json').then(r=>r.ok?r.json():null).then(m=>m?.notice??null).catch(()=>null);
 const measure=document.createElement('canvas').getContext('2d');
 async function showInformation(text,seconds=5,icon=''){const prefab=await noticePrefab;if(!prefab){console.warn(text);return;}
  const tree=createDfTree(prefab.nodes,assets,{container:popupLayer,className:'df-instance'}),panel=tree.items[0],label=tree.find('Rich Text Label'),iconLabel=tree.find('Icon');
  const ld=label.control.data,font=assets.fonts[ld.fontKey];measure.font=`${ld.fontSize}px "${font?.name}"`;const labelWidth=measure.measureText(text).width+16;label.size={x:labelWidth,y:ld.size.y};
  const width=ld.layout.margins.left+labelWidth+8,height=panel.control.data.size.y,W=innerWidth,base={x:(W-width)/2+(Math.random()*64-32),y:-height+(Math.random()*64-32),z:0};
  panel.size={x:width,y:height};panel.position={x:base.x,y:base.y};tree.setText(iconLabel,icon);tree.setText(label,text);
  const tweens=panel.node.components.dfTweenVector3??[],moveIn=tweens.find(t=>t.tweenName==='MoveIn'),moveOut=tweens.find(t=>t.tweenName==='MoveOut'),start=performance.now()/1000;
  const step=()=>{const t=performance.now()/1000-start;let p=moveIn?tweenAt(moveIn,base,t):base;if(t>=seconds&&moveOut){const held=moveIn?tweenAt(moveIn,base,seconds):base;p=tweenAt(moveOut,held,t-seconds);if(t-seconds>=moveOut.length){tree.dispose();return;}}
   panel.position={x:p.x,y:p.y};tree.layout(viewport());requestAnimationFrame(step);};step();}
 // Owner playtest (2026-10-29): Ctrl+W/T closing the tab mid-game. No page can cancel those shortcuts outside
 // fullscreen (browser-shortcuts.mjs, game-controls.mjs's Keyboard Lock only engages in fullscreen), so instead of
 // pretending to fix it, a one-time tip on join points at the two real options: play fullscreen, or rebind Crouch
 // (Ctrl by default — the original bind) from Options, reached from here by pressing Escape. Plain port UI, not a
 // recreation of anything in the original client.
 const TIP_KEY='rlb-controls-tip-shown';
 function showControlsTip(){try{if(session?.getItem(TIP_KEY))return;}catch{}
  const el=document.createElement('div');el.id='join-controls-tip';el.setAttribute('role','status');
  const text=document.createElement('span');text.textContent="Tip: play fullscreen to stop browser shortcuts (Ctrl+W, Ctrl+T) from interrupting your game, or rebind Crouch in Options (press Esc) if you'd rather stay windowed.";
  const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Dismiss');
  const dismiss=()=>{el.remove();try{session?.setItem(TIP_KEY,'1');}catch{}};
  close.onclick=dismiss;el.append(text,close);document.body.append(el);}

 // Browser-port FPS readout (Options > browser > FPS Counter): in game only, hidden behind the menus.
 const fpsCounter=createFpsCounter({visible:()=>renderSettings.showFps&&state.inGame&&!state.leaving&&!isVisible()});
 // ---- Options (OptionsWindow + ConvarBinding + OptionsInput) -------------------------------------------------------
 const bindings=menu.items.filter(i=>i.node.components.ConvarBinding&&['dfSlider','dfCheckbox'].includes(i.control?.kind));
 const convarOf=i=>i.node.components.ConvarBinding[0].convarName;
 for(const i of bindings)if(i.el)i.el.dataset.convar=convarOf(i); // stable hook for checks (several rows share node names)
 const markInert=name=>{for(const i of bindings)if(convarOf(i)===name){const row=menu.items[i.node.parent];row.el.title=INERT_TITLE;row.el.classList.add('df-inert');}};inert.forEach(markInert);
 const contents=M('optionsContents'),nodes=manifest.screens.MainMenu.nodes;
 let contentBottom=0;for(const item of menu.items)if(item.node.parent===contents.index){const d=firstControl(item.node);contentBottom=Math.max(contentBottom,d.layout.margins.top+d.size.y);}
 const extra=[];const addRow=(rowNodes,height)=>{const tree=createDfTree(rowNodes,assets,{container:contents.el,className:'df-instance'});tree.items[0].position={x:0,y:contentBottom};tree.items[0].size={x:firstControl(rowNodes[0]).size.x,y:height};contentBottom+=height;extra.push(tree);return tree;};
 // OptionsInput.Start: one Controls-Line per GameInput button, appended to the scroll panel's flow; OptionsKeyBinding.Setup
 // writes the binding names (" " for None). The labels are only read back on Apply (UpdateConVars -> input.bind).
 const keyBinds=input?.bindings??new KeyBindings();
 const keyRows=GAME_BUTTONS.map(name=>{const tree=addRow(manifest.prefabs.OptionsKeyBinding.nodes,32),[a,b]=keyBinds.get(name);const row={name,tree,one:tree.find('KeyA'),two:tree.find('KeyB')};
  tree.setText(tree.find('lbl'),name);tree.setText(row.one,bindingText(a));tree.setText(row.two,bindingText(b));tree.items[0].el.dataset.button=name;
  // Controls-Line dfEventBindings: Sliced Sprite Click -> OnClickOne / OnClickTwo.
  for(const e of tree.items[0].node.components.dfEventBinding??[])tree.on(e.DataSource.Component.m_PathID,e.DataSource.MemberName,()=>startKeyListen(row,e.DataTarget.MemberName==='OnClickOne'?row.one:row.two));
  return row;});
 // OptionsKeyBinding.StartKeyListen / Update: one cell at a time shows "..."; the next key or mouse button down (the lowest
 // held KeyCode, FetchKey) becomes its text, Escape blanks it (None). Nothing changes until Apply.
 const listen={row:null,cell:null};
 function startKeyListen(row,cell){if(listen.cell)return;listen.row=row;listen.cell=cell;row.tree.setText(cell,'...');if(input)input.suspended=true;}
 function finishKeyListen(code){const key=fetchKey([...(input?.state.held??[]),code]),text=listenText(key);if(text===null)return false;listen.row.tree.setText(listen.cell,text);listen.row=listen.cell=null;if(input)input.suspended=false;return true;}
 // MainMenu.Update sees the same Escape (it blanks the cell here and toggles the menu there).
 addEventListener('keydown',e=>{if(!listen.cell)return;e.preventDefault();e.stopImmediatePropagation();if(e.repeat)return;const code=keyCodeForEvent(e);if(code&&finishKeyListen(code)&&code==='Escape')escapeToggle(e);},true);
 addEventListener('pointerdown',e=>{if(!listen.cell)return;const code=mouseKeyCode(e.button);if(code&&finishKeyListen(code)&&e.button!==0)listen.boundAt=performance.now();},true);
 addEventListener('contextmenu',e=>{if(performance.now()-(listen.boundAt??-1e9)<1000)e.preventDefault();},true); // a right button just bound
 // Browser-port settings (render.fov, fullscreen, mouse release key; game-controls.mjs) in the same row styles.
 const nodeIndex=name=>nodes.findIndex(n=>n.name===name);
 const heading=addRow(subtree(nodes,nodeIndex('Input'),node=>{const d=node.components.dfRichTextLabel?.[0];if(d)d.text='browser';}),48);
 const fovRow=addRow(subtree(nodes,nodeIndex('Awesomness'),node=>{const s=node.components.dfSlider?.[0];if(s)Object.assign(s,{minValue:60,maxValue:120,stepSize:1,scrollSize:1});const l=node.components.dfRichTextLabel?.[0];if(l)l.text='Field of View:';}),32);
 const fullscreenRow=addRow(subtree(nodes,nodeIndex('VSync'),node=>{const l=node.components.dfRichTextLabel?.[0];if(l)l.text='Fullscreen:';}),32);
 // Grass (grass.on; off by default, the owner's choice) and the FPS counter (renderSettings.showFps).
 const checkRow=(label,option)=>{const row=addRow(subtree(nodes,nodeIndex('VSync'),node=>{const l=node.components.dfRichTextLabel?.[0];if(l)l.text=label;}),32);row.items[0].el.dataset.option=option;return row;};
 const grassRow=checkRow('Grass:','grass'),fpsRow=checkRow('FPS Counter:','fps');
 const grassBox=grassRow.items.find(i=>i.control?.kind==='dfCheckbox'),fpsBox=fpsRow.items.find(i=>i.control?.kind==='dfCheckbox');
 // Browser port: put the original default binds (config.cs defaultConfig) back into the key rows; Apply saves them.
 const defaultsRow=addRow(structuredClone(manifest.prefabs.OptionsKeyBinding.nodes),32);defaultsRow.setText(defaultsRow.find('lbl'),'Default Keys:');defaultsRow.setText(defaultsRow.find('KeyA'),'Restore');defaultsRow.setText(defaultsRow.find('KeyB'),' ');defaultsRow.items[0].el.dataset.option='default-keys';
 defaultsRow.on(defaultsRow.items.find(i=>i.node.name==='Sliced Sprite').node.components.dfSlicedSprite[0].pathID,'Click',()=>{if(listen.cell)return;const defaults=new KeyBindings(DEFAULT_CONFIG);for(const r of keyRows){const [a,b]=defaults.get(r.name);r.tree.setText(r.one,bindingText(a));r.tree.setText(r.two,bindingText(b));}});
 defaultsRow.items[0].el.title='Restore the original default keys (press Apply to keep them)';
 const releaseRow=addRow(structuredClone(manifest.prefabs.OptionsKeyBinding.nodes),32);releaseRow.setText(releaseRow.find('lbl'),'Release Mouse:');releaseRow.setText(releaseRow.find('KeyB'),' ');
 const fovSlider=fovRow.items.find(i=>i.control?.kind==='dfSlider'),fullscreenBox=fullscreenRow.items.find(i=>i.control?.kind==='dfCheckbox');let releaseKey=renderSettings.releaseKey,shownFullscreen=false;
 releaseRow.on(releaseRow.items.find(i=>i.node.name==='Sliced Sprite').node.components.dfSlicedSprite[0].pathID,'Click',()=>{const keys=['F2','F3','F4'];releaseKey=keys[(keys.indexOf(releaseKey)+1)%keys.length];releaseRow.setText(releaseRow.find('KeyA'),releaseKey);});
 releaseRow.items[0].el.title='Click to change the key that releases the mouse (Escape opens this menu)';
 function layoutOptions(){for(const tree of extra)tree.layout({width:contents.rect?.width??552,height:contentBottom});}
 // OnWindowVisibleChanged -> BroadcastMessage("UpdateFromConVar").
 function updateFromConVars(){for(const i of bindings){const v=convars.get(convarOf(i));if(i.control.kind==='dfSlider')i.value=v;else i.checked=Boolean(v);menu.paint(i);}
  fovSlider.value=renderSettings.fov;fullscreenBox.checked=shownFullscreen=Boolean(document.fullscreenElement)||Boolean(renderSettings.fullscreen);releaseKey=renderSettings.releaseKey;
  grassBox.checked=Boolean(convars.get('grass.on'));grassRow.paint(grassBox);fpsBox.checked=Boolean(renderSettings.showFps);fpsRow.paint(fpsBox);releaseRow.setText(releaseRow.find('KeyA'),releaseKey);layoutOptions();}
 // DoApply -> BroadcastMessage("UpdateConVars") then "config.save".
 async function doApply(){for(const i of bindings)convars.set(convarOf(i),i.control.kind==='dfSlider'?String(i.value):(i.checked?'True':'False'));convars.set('grass.on',grassBox.checked?'True':'False');convars.save();
  // OptionsKeyBinding.UpdateConVars: "input.bind <name> <one> <two>" from the cell texts; then config.save.
  for(const r of keyRows)input?.bindings.bind(r.name,textBinding(r.one.text??''),textBinding(r.two.text??''));if(input)input.bindings.save(local);
  renderSettings.setFov(Math.round(fovSlider.value));renderSettings.setShowFps(fpsBox.checked);renderSettings.setReleaseKey(releaseKey);
  // Fullscreen: the play-in-fullscreen choice (game-controls.mjs enters it on capture); applied now in game, or when changed.
  const wantFullscreen=fullscreenBox.checked,changed=wantFullscreen!==shownFullscreen;shownFullscreen=wantFullscreen;renderSettings.setFullscreen?.(wantFullscreen);
  if(fullscreenBox.checked!==Boolean(document.fullscreenElement)&&(state.inGame||changed||!wantFullscreen)){try{if(fullscreenBox.checked)await document.documentElement.requestFullscreen();else await document.exitFullscreen();}catch{fullscreenBox.checked=Boolean(document.fullscreenElement);fullscreenRow.paint(fullscreenBox);}}}

 refreshOptions=()=>{if(menu.isVisible(screenOptions))updateFromConVars();};

 // ---- ServerBrowser ------------------------------------------------------------------------------------------------
 const sb={servers:[[],[],[],[],[],[]],serverType:0,orderType:2,pageNumber:0,checksum:'',firstOpened:false,playerCount:0,serverCount:0,slotCount:0,rows:[],pagination:[],refreshing:false,signInHint:false};
 const categories=menu.items.filter(i=>i.node.components.ServerCategory).map(i=>({item:i,id:i.node.components.ServerCategory[0].categoryId,count:menu.byPath.get(i.node.components.ServerCategory[0].serverCount.m_PathID)?.item}));
 const container=M('pnlContainer'),pagination=M('Pagenation'),btnRefresh=M('btnRefresh','ServerBrowser'),lblDetails=M('lblDetails');
 // ClientInit: serverfavourite.load at startup; the star (ServerItem.OnClickFave) runs serverfavourite.add/remove + save.
 const faveList=new FavouriteList(local,FAVOURITES_KEY);faveList.load();const favourites=()=>faveList.set();
 const categoryChanged=()=>{for(const c of categories)menu.setOpacity(c.item,c.id===sb.serverType?1:0.5);};categoryChanged();
 const updateCount=(c,n)=>{if(!c.count)return;menu.setVisible(c.count,n!==0);menu.setText(c.count,n.toLocaleString('en-US'));};
 function clearList(){sb.pageNumber=0;for(const list of sb.servers)list.length=0;for(const c of categories)updateCount(c,0);clearServers();sb.playerCount=sb.serverCount=sb.slotCount=0;setDetails('...');}
 function clearServers(){for(const r of sb.rows){r.tree.items[0].visible=false;r.tree.items[0].el.hidden=true;}sb.checksum='';}
 function setDetails(text){const parts=sb.signInHint?[{text:text+' '},{text:'Sign in on the website to join browser servers.',href:'/'}]:null;menu.setText(lblDetails,text,parts);}
 function addServer(s,type=0,tags=''){if(!s.offline&&shouldIgnoreServer(s))return;sb.playerCount+=s.currentplayers;sb.serverCount++;sb.slotCount+=s.maxplayers??0;setDetails(detailsText(sb.playerCount,sb.serverCount,sb.slotCount));
  if(type===4){sb.servers[4].push({...s,name:historyLabel(s.name,s.lastplayed,now()/1000)});updateCount(categories.find(c=>c.id===4),sb.servers[4].length);return;}
  const cat=s.offline?SERVERTYPE.COMMUNITY:categoryFor(s,tags);if(cat===null)return;sb.servers[cat].push(s);updateCount(categories.find(c=>c.id===cat),sb.servers[cat].length);}
 async function api(method,path,csrf){const headers={};if(csrf&&method!=='GET')headers['x-csrf-token']=csrf;const res=await fetch(path,{method,headers,credentials:'same-origin'});const body=await res.json().catch(()=>({}));if(!res.ok)throw Object.assign(new Error(body.error??String(res.status)),{code:body.error??String(res.status),status:res.status});return body;}
 // RefreshServerList: the Steam master query becomes the central directory (same origin) plus the offline island.
 async function refresh(){if(sb.refreshing)return;sb.refreshing=true;menu.setEnabled(btnRefresh,false);menu.setOpacity(btnRefresh,0.2);clearList();setDetails('Updating..');
  const faves=favourites();let central=[];
  try{const r=await api('GET','/servers');if(Array.isArray(r.servers)){state.central=r.servers;central=r.servers.filter(s=>s.online);}}catch{state.central=null;}
  if(state.central){try{state.me=await api('GET','/me');}catch{state.me=null;}}sb.signInHint=Boolean(state.central)&&!state.me;
  addServer(offlineServer(faves));for(const s of central)addServer(fromCentral(s,faves),0,centralTags(s));
  const known=new Map([[OFFLINE_ADDRESS,offlineServer(faves)],...central.map(s=>[String(s.id),fromCentral(s,faves)])]);
  for(const h of readList(local,HISTORY_KEY))if(h&&typeof h.address==='string'&&typeof h.name==='string'){const s=known.get(h.address)??{name:h.name.slice(0,64),address:h.address,unavailable:true,maxplayers:null,currentplayers:0,ping:null,fave:faves.has(h.address)};addServer({...s,lastplayed:Number(h.lastplayed)||0},4);}
  setDetails(detailsText(sb.playerCount,sb.serverCount,sb.slotCount));
  sb.refreshing=false;menu.setEnabled(btnRefresh,true);menu.setOpacity(btnRefresh,1);updateServerList();}
 function switchCategory(id){if(sb.serverType===id)return;sb.pageNumber=0;sb.checksum='';sb.serverType=id;categoryChanged();clearServers();updateServerList();}
 function changeOrder(type){sb.orderType=type;sb.checksum='';updateServerList();}
 function rowTree(){const tree=createDfTree(manifest.prefabs.ServerItem.nodes,assets,{container:container.el,className:'df-instance'});const row={tree,server:null};
  const hostname=tree.find('btnHostname'),fave=tree.find('btnFave');
  // ServerItem prefab bindings: btnHostname DoubleClick -> Connect, Click -> SelectThis, btnFave MouseDown -> OnClickFave.
  for(const item of tree.items)for(const b of item.node.components.dfEventBinding??[]){const member=b.DataTarget.MemberName;tree.on(b.DataSource.Component.m_PathID,b.DataSource.MemberName,()=>{if(member==='Connect')connect(row.server);else if(member==='OnClickFave')toggleFave(row);});}
  row.hostname=hostname;row.fave=fave;row.players=tree.find('lblPlayers');row.ping=tree.find('lblPing');sb.rows.push(row);return row;}
 function toggleFave(row){const s=row.server;s.fave=!s.fave;if(s.fave)faveList.add(s.address);else faveList.remove(s.address);faveList.save();
  for(const list of sb.servers)for(const x of list)if(x.address===s.address)x.fave=s.fave;row.tree.setOpacity(row.fave,s.fave?1:0.2);sb.checksum='';updateServerList();}
 function updateServerList(){const list=sb.servers[sb.serverType];sortServers(list,sb.serverType,sb.orderType);if(!container.rect)return;
  const page=pageOf(list,sb.pageNumber,container.rect.height);if(!page){setupPagination(0,0);return;}setupPagination(page.pages,sb.pageNumber);if(page.checksum===sb.checksum)return;clearServers();sb.checksum=page.checksum;
  page.rows.forEach((r,i)=>{const row=sb.rows[i]??rowTree();row.server=r.server;const head=row.tree.items[0];head.position={x:0,y:r.y};head.size={x:container.rect.width,y:32};
   row.tree.setText(row.hostname,r.server.name);row.tree.setText(row.players,playersText(r.server));row.tree.setText(row.ping,pingText(r.server));row.tree.setOpacity(row.fave,r.server.fave?1:0.2);
   head.el.dataset.address=r.server.address;head.visible=true;head.el.hidden=false;row.tree.layout({width:container.rect.width,height:container.rect.height});});}
 function layoutServers(force){if(force)sb.checksum='';if(menu.isVisible(screenServers))updateServerList();layoutOptions();}
 // Pagination.Setup: page buttons and "..." spacers, then the panel narrows to their width and re-centres.
 function setupPagination(pages,current){const key=pages+':'+current;if(sb.paginationKey===key)return;sb.paginationKey=key;for(const t of sb.pagination)t.dispose();sb.pagination=[];
  let x=0;for(const p of paginationItems(pages,current)){const tree=createDfTree(manifest.prefabs[p.spacer?'PaginationSpacer':'PaginationButton'].nodes,assets,{container:pagination.el,className:'df-instance'}),head=tree.items[0],size=head.control.data.size;
   head.position={x,y:0};head.size={x:size.x,y:size.y};if(!p.spacer){tree.setText(head,p.label);if(p.current)tree.setEnabled(head,false);else tree.on(head,'MouseDown',()=>{sb.pageNumber=p.page;sb.paginationKey='';updateServerList();});}
   tree.layout({width:size.x,height:size.y});x+=size.x+5;sb.pagination.push(tree);}
  pagination.size={x:Math.max(1,x),y:pagination.control.data.size.y};menu.layout();}

 // ServerItem.Connect -> net.connect: LoadingScreen.Show + "connecting.."; a failure returns to the menu with a notice.
 async function connect(server){if(!server)return;if(state.connected||state.joining){console.log('Use net.disconnect before trying to connect to a new server.');return;}
  // net.connect: PlayerPrefs "net.lasturl" (net.reconnect connects to it again).
  try{local?.setItem(LAST_URL_KEY,server.address);}catch{}
  if(server.offline){state.joining=true;rememberJoin(local,server,now()/1000);chosen({mode:'offline',server});return;}
  state.joining=true;showLoading();status('connecting..');
  try{if(server.unavailable||!state.central)throw Object.assign(new Error('server-offline'),{code:'server-offline'});
   const me=state.me??await api('GET','/me').catch(e=>{throw Object.assign(new Error('sign-in-required'),{code:e.status===401||e.status===403?'sign-in-required':e.code});});state.me=me;
   if(me.needsUsername)throw Object.assign(new Error('username-required'),{code:'username-required'});
   const {ticket,endpoint}=await api('POST',`/servers/${encodeURIComponent(server.address)}/join-ticket`,me.csrf);
   rememberJoin(local,server,now()/1000);chosen({mode:'online',join:{ticket,endpoint,server:server.address,name:server.name},server});}
  catch(e){state.joining=false;hideLoading();showInformation(`Failed to connect (${e.code??e.message})`);}}

 // ---- MainMenu dfEventBindings --------------------------------------------------------------------------------------
 const handlers={'MainMenu.ShowServerlist':()=>toggle(screenServers),'MainMenu.ShowOptions':()=>toggle(screenOptions),'MainMenu.DoExit':()=>doExit(),
  'RunConsoleCommand.RunCommandImmediately':t=>runCommand(t.data.consoleCommand),
  'OptionsWindow.DoApply':()=>doApply(),'OptionsWindow.OnWindowVisibleChanged':()=>{if(menu.isVisible(screenOptions))updateFromConVars();},
  'ServerBrowser.OnFirstOpen':()=>{if(!sb.firstOpened&&menu.isVisible(screenServers)){sb.firstOpened=true;refresh();}else if(menu.isVisible(screenServers))updateServerList();},
  'ServerBrowser.RefreshServerList':()=>{if(btnRefresh.state!=='disabled')refresh();},
  'ServerBrowser.OrderByName':()=>changeOrder(0),'ServerBrowser.OrderByPlayers':()=>changeOrder(1),'ServerBrowser.OrderByPing':()=>changeOrder(2),
  'ServerCategory.OnSelected':t=>switchCategory(t.data.categoryId)};
 for(const item of menu.items)for(const b of item.node.components.dfEventBinding??[]){const target=menu.byPath.get(b.DataTarget.Component.m_PathID),fn=target&&handlers[target.kind+'.'+b.DataTarget.MemberName];
  if(fn)menu.on(b.DataSource.Component.m_PathID,b.DataSource.MemberName,()=>fn(target));}

 // RunConsoleCommand buttons: net.disconnect here; anything else goes to the game's console commands once attached.
 let consoleCommand=null;function runCommand(text){if(text==='net.disconnect'){disconnect();return;}consoleCommand?.(text);}
 // net.connect <address> with one of this port's server addresses (central id or the offline island).
 async function connectAddress(address){if(address!==OFFLINE_ADDRESS&&!state.central)await refresh();
  const s=address===OFFLINE_ADDRESS?offlineServer(favourites()):state.central?.filter(x=>x.online).map(x=>fromCentral(x,favourites())).find(x=>x.address===address);
  if(s)connect(s);else showInformation(`Failed to connect (server-offline)`);}
 // MainMenu.DoExit -> "quit". A page cannot quit the browser: leave for the website when it serves this page.
 function doExit(){game?.allowLeave?.();if(state.central)location.href='/';else{try{window.close();}catch{}setTimeout(()=>showInformation('Close this browser tab to quit.'),100);}}
 // net.disconnect -> uLink_OnDisconnectedFromServer: gameui.show, LoadBackground, "Disconnected from server." notice.
 async function disconnect(){if(!state.connected||state.leaving)return;await game?.disconnect?.();returnToMenu(game?.online?'Disconnected from server.':null);}
 function returnToMenu(text){if(state.leaving)return;state.leaving=true;try{if(text)session?.setItem(NOTICE_KEY,text);}catch{}game?.allowLeave?.();location.reload();}

 // ---- LoadingScreen ------------------------------------------------------------------------------------------------
 function showLoading(){loading.setVisible(loadingRoot,true);}
 function hideLoading(){loading.setVisible(loadingRoot,false);}
 // LoadingScreen.Update also Debug.Logs "LoadingScreen: " + text (into the F1 console's CaptureLog; setLog).
 let log=()=>{};function status(text){log('LoadingScreen: '+text);loading.setText(lblInfo,text);}
 // LoadingScreen.Operations: the bar shows only while an operation reports progress.
 function progress(fraction){if(fraction==null){loading.setVisible(pnlProgress,false);return;}loading.setVisible(pnlProgress,true);upperProgress.fill=Math.min(1,Math.max(0,fraction));loading.paint(upperProgress);}

 // ---- Original menu background (MenuBackground level), blurred by the BlurCamera while the menu is shown -------------
 let background=null,backgroundShown=null;const backgroundReady=new Promise(resolve=>{backgroundShown=resolve;});
 async function startBackground(){const canvas=document.createElement('canvas');canvas.id='menu-background';canvas.setAttribute('aria-hidden','true');document.querySelector('#world')?.after(canvas)??document.body.prepend(canvas);
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
  const bg={canvas,renderer,scene:null,frame:0,stopped:false};background=bg;const resize=()=>{renderer.setSize(innerWidth,innerHeight);bg.scene?.resize(innerWidth,innerHeight);};addEventListener('resize',resize);bg.resize=resize;
  const pending=earlyBackground??loadMenuBackground({aspect:innerWidth/innerHeight});earlyBackground=null;
  try{bg.scene=await pending;bg.scene.resize(innerWidth,innerHeight);}catch(e){console.warn('Original menu background unavailable:',e.message);backgroundShown();return;}
  if(bg.stopped){bg.scene.dispose();return;}
  // Menu Background audio (MusicPlayer, wind, FireBarrel) on the scene's Main Camera listener.
  fetch('/assets/recovered/audio/manifest.json').then(r=>r.ok?r.json():null).then(m=>{if(m&&!bg.stopped)bg.audio=createMenuAudio({manifest:m,camera:bg.scene.camera,storage:local});}).catch(e=>console.warn('Menu audio unavailable:',e.message));let last=performance.now();const draw=t=>{if(bg.stopped)return;bg.scene.frame(Math.min(0.05,(t-last)/1000));last=t;renderer.render(bg.scene.scene,bg.scene.camera);bg.frames=(bg.frames??0)+1;if(bg.frames===1)backgroundShown();bg.frame=requestAnimationFrame(draw);};bg.frame=requestAnimationFrame(draw);}
 // Application.LoadLevelAsync replaces the MenuBackground scene with the island.
 function stopBackground(){backgroundShown();const bg=background;if(!bg)return;background=null;bg.stopped=true;bg.audio?.dispose();cancelAnimationFrame(bg.frame);removeEventListener('resize',bg.resize);bg.scene?.dispose();bg.renderer.dispose();bg.renderer.forceContextLoss();bg.canvas.remove();}

 // DisableOnConnectedState.DoOnConnected (disableWhenConnected false): SetActive(true) and Show().
 function setConnected(){menu.setActive(btnDisconnect,true);menu.setVisible(btnDisconnect,true);}
 // ---- Entry --------------------------------------------------------------------------------------------------------
 // A website join ticket (site/site.mjs) is used at once: straight to the loading screen. Otherwise MainMenu.Start shows
 // the menu over the original background and waits for a server choice.
 function chosen(result){const r=resolveChoice;resolveChoice=null;stopBackground();state.connected=result.mode==='offline';if(state.connected)setConnected();
  showLoading();status(result.mode==='online'?'connecting..':'loading '+LEVEL_NAME);hideAllBut(null);r?.(result);}
 const api_={
  element:layer,menu,loading,convars,
  // Settles once the menu background has drawn (or could not load): main.mjs starts the world prefetch then.
  backgroundReady,
  choose(){let pending=null;try{pending=session?.getItem(NOTICE_KEY);session?.removeItem(NOTICE_KEY);}catch{}
   const join=takeJoin(session);if(join){state.joining=true;show();showLoading();status('connecting..');return Promise.resolve({mode:'online',join,fromWebsite:true});}
   show();startBackground();if(pending)showInformation(pending);return new Promise(resolve=>{resolveChoice=resolve;});},
  // RustLevel / ClientConnect loading messages and LoadingScreen.Operations progress (done/total, or null for no bar).
  // (A stage reporting progress repeats its text: one LoadingScreen.Update per stage, as RustLevel.LoadRoutine.)
  loading(text,done=null,total=null){if(text&&text!==lblInfo.text)status(text);progress(total>0?done/total:null);},
  connected(){state.connected=true;setConnected();status('connected!');},
  failed(denied){returnToMenu(failedToConnectMessage(denied));}, // {reason, error?}: MainMenu.uLink_OnFailedToConnect
  // "gameui.hide" at the end of RustLevel.LoadRoutine: MainMenu.Hide (also hides the loading screen), HUD on.
  finished(){state.inGame=true;state.joining=false;status('finished');progress(null);hide();game?.beginSession?.();showControlsTip();},
  attachGame(g){game=g;const lost=()=>returnToMenu(g.online?.disconnectText?.()??'Disconnected from server.'); /* KP kick reason: "Disconnected (NiceString)" */g.online?.addEventListener('closed',lost);if(g.online?.state==='closed')lost();g.online?.addEventListener('denied',e=>returnToMenu(failedToConnectMessage(e.detail)));},
  // LockCursorManager.onEscapeKey (Escape while the cursor is locked) -> MainMenu.Show.
  escapeKey(){if(state.inGame&&!isVisible()&&!game?.uiOpen?.()&&!game?.dead?.()){state.escapeAt=performance.now();show();}},
  menuVisible:isVisible,showInformation,markInert,isConnected:()=>state.connected,
  favourites:faveList,setConsole(fn){consoleCommand=fn;},setLog(fn){log=fn;},runCommand,
  // gui.hide/gui.show (GUIHide on Overlay: SetActive) and gui.hide_branding/show_branding (BrandingPanel dfPanel Hide/Show).
  setOverlayVisible(v){if(overlay)overlay.setActive(overlay.items[0],Boolean(v));},setBrandingVisible(v){if(brandingPanel)overlay.setVisible(brandingPanel,Boolean(v));},
  // net.connect / net.disconnect / net.reconnect state (NetCull.isClientRunning, ClientConnect in progress, net.lasturl).
  net:{connecting:()=>state.joining&&!state.connected,connected:()=>state.connected||state.inGame,connect:address=>connectAddress(address),disconnect:()=>disconnect(),
   lastUrl(){try{return local?.getItem(LAST_URL_KEY)??null;}catch{return null;}},setLastUrl(address){try{local?.setItem(LAST_URL_KEY,address);}catch{}}},
  // Signed-in website account name (GET /me, read while the server list refreshes); the offline island's chat name.
  playerName:()=>typeof state.me?.name==='string'?state.me.name:null,
  snapshot:()=>({menu:isVisible(),options:menu.isVisible(screenOptions),servers:menu.isVisible(screenServers),loading:loading.isVisible(loadingRoot),info:lblInfo.text,progress:loading.isVisible(pnlProgress)?upperProgress.fill:null,
  controlsTip:document.querySelector('#join-controls-tip')?.textContent??null,
   category:sb.serverType,counts:categories.map(c=>({id:c.id,count:sb.servers[c.id].length})),rows:sb.rows.filter(r=>!r.tree.items[0].el.hidden).map(r=>({name:r.server.name,address:r.server.address,players:r.players.text,ping:r.ping.text})),
   details:lblDetails.text,signInHint:sb.signInHint,values:Object.fromEntries([...bindings.map(i=>[convarOf(i),i.control.kind==='dfSlider'?i.value:i.checked]),['render.fov',fovSlider.value],['fullscreen',fullscreenBox.checked],['grass.on',grassBox.checked],['fps',fpsBox.checked],['release',releaseKey]]),keys:keyRows.map(r=>[r.name,r.one.text,r.two.text]),listening:listen.row?.name??null,inert:bindings.filter(i=>menu.items[i.node.parent].el.classList.contains('df-inert')).map(convarOf),notices:[...popupLayer.querySelectorAll('.df-text')].map(t=>t.textContent).filter(Boolean),disconnect:menu.isVisible(btnDisconnect),background:Boolean(background?.frames),menuAudio:background?.audio?.snapshot()??null,branding:overlay?{visible:Boolean(overlay.isVisible(overlay.items[0])&&overlay.isVisible(brandingPanel)),text:versionLabel?.text??null,rect:brandingPanel?.rect??null}:null,favourites:[...faveList.list],inGame:state.inGame,fpsCounter:fpsCounter.element.hidden?null:fpsCounter.element.textContent})};
 // MainMenu.Update: while connected, Escape (Input.GetKeyDown) toggles the menu and nothing else is checked: RPOS hides
 // on the same key (HumanController, inventory-ui.mjs), chat cancels (ChatUI CancelChatting), a lock entry, an Options key
 // listen (OptionsKeyBinding: the cell is blanked) or the F1 console (only F1 closes it) stay as they are.
 // (escapeAt: the Escape that ended Pointer Lock already showed the menu through escapeKey.)
 // uiOpen() gate matches escapeKey() above: inventory/lockEntry/chat/a context menu close on this same Escape via their
 // own listeners, and must win over showing the menu — otherwise, since the per-frame loop already exits Pointer Lock
 // as soon as any of them opens (main.mjs inputBlocked), this bubble-phase listener saw a free cursor and opened the
 // menu right alongside them, so Escape had to be pressed twice to actually get back into the game.
 function escapeToggle(e){if(e.code!=='Escape'||e.repeat||!state.inGame||state.leaving)return;e.preventDefault();if(performance.now()-(state.escapeAt??-1e9)<400)return;if(isVisible())hide();else if(!game?.uiOpen?.())show();}
 addEventListener('keydown',e=>escapeToggle(e));
 // Read-only state for checks (like window.explorerState); nothing here changes behaviour.
 Object.defineProperty(window,'rlbFrontEnd',{configurable:true,value:Object.freeze({state:api_.snapshot})});
 return api_;
}
