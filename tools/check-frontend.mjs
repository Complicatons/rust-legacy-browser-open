// Normal player entry (no ?dev): the original MainMenu over the original menu background, Options persistence, the
// ServerBrowser listing the offline island plus the central directory (same origin; tests/helpers/stack.mjs, only the
// Legacy server is mocked), offline join with LoadingScreen progress, the in-game Escape menu and Disconnect, an online join
// through central to the mock stack, and the website's one-use sessionStorage ticket. Screenshots: analysis/browser-qa/frontend/.
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {createServer as createHttp} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {createGameHandler} from './serve.mjs';
import {startStack,poll} from '../tests/helpers/stack.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
import {brandingText} from '../browser/client-commands.mjs';
const out='analysis/browser-qa/frontend/';await mkdir(out,{recursive:true});
// The page and the central API share one origin, as when central serves the game (tools/central.mjs serveGame). The
// harness forwards /servers and /me to the mock stack's central service; the join ticket's registered wss:// endpoint
// is rewritten to the local mock gateway.
const game=createGameHandler();let stack=null;
const http=createHttp(async(req,res)=>{const path=new URL(req.url,'http://local').pathname;
 if(stack&&/^\/(servers|me)(\/|$)/.test(path)){const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('rlb_session='));
  const r=await stack.call(req.method,path,{cookie,csrf:req.headers['x-csrf-token']});let data=r.data;
  if(/\/join-ticket$/.test(path)&&r.status===200)data={...data,endpoint:`ws://127.0.0.1:${stack.gateway.port}/play`};
  res.writeHead(r.status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));return;}
 await game(req,res);});
await listenServer(http);const origin=`http://127.0.0.1:${http.address().port}`;
stack=await startStack({gatewayOrigins:[origin]});
const browser=await chromium.launch(launchOptions());const result={steps:[]};const step=(name,data={})=>{result.steps.push({name,...data});console.log('ok',name);};
const fe=page=>page.evaluate(()=>window.rlbFrontEnd?.state()??null);
// Polls the page's read-only front-end state from Node (navigation in between is retried).
async function waitFe(page,fn,_,timeout=120000){const t=Date.now();let last=null;while(Date.now()-t<timeout){try{last=await fe(page);if(last&&fn(last))return last;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('timed out waiting for '+fn+' last: '+JSON.stringify(last)?.slice(0,600));}
async function open(context,url=origin+'/'){const page=await context.newPage(),errors=[],bad=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&!/^Failed to load resource/.test(m.text()))errors.push(m.text());});
 page.on('response',r=>{if(r.status()>=400)bad.push(`${r.status()} ${new URL(r.url()).pathname}`);});page.on('dialog',d=>{errors.push('dialog '+d.type());d.dismiss();});
 await page.goto(url,{waitUntil:'load'});return {page,errors,bad};}
// Only the expected signed-out answers may fail: /me (401) and the join ticket it guards.
// Exports owned by other in-progress systems are not this check's concern; the front end's own assets are.
const allowedFailures=bad=>bad.filter(b=>!/^(401|403) \/(me|servers\/[^/]+\/join-ticket)$/.test(b)&&!/^404 \/assets\/recovered\/(?!frontend\/|popup\/|menu-background\/)/.test(b));
async function nativePeer(seen){const peer=await poll(()=>[...stack.native.peers.values()].find(p=>p.playerId&&!seen.has(p)),120000);seen.add(peer);const rpcs=[];peer.onUlink=h=>rpcs.push(h.rpc);
 peer.create({viewId:1,prefab:'ServerManagement'});await poll(()=>rpcs.includes('ClientFirstReady'),120000);
 peer.create({viewId:20,owner:peer.playerId,prefab:':player_soldier',position:[5244.1,368,-4839.6]});return peer;}
const seenPeers=new Set();
try{
 // ---- A: signed out, menu + server browser --------------------------------------------------------------------
 const context=await browser.newContext({viewport:{width:1280,height:720}});
 let {page,errors,bad}=await open(context);
 await waitFe(page,s=>s.menu&&s.background,null,60000);
 const ui=await page.evaluate(()=>({header:getComputedStyle(document.querySelector('header')).display,aside:getComputedStyle(document.querySelector('aside')).display,
  buttons:['btnPlay','btnOptions','btnQuit','logoSprite','blackbar'].map(n=>{const e=document.querySelector(`#front-end [data-df-name="${n}"]`);return e&&!e.hidden&&e.getBoundingClientRect().width>0;}),labels:[...document.querySelectorAll('#front-end [data-df-name="Buttons"] .df-dfRichTextLabel .df-text')].map(t=>t.textContent)}));
 assert.equal(ui.header,'none');assert.equal(ui.aside,'none');assert.deepEqual(ui.buttons,[true,true,true,true,true]);for(const l of ['play game','options','exit'])assert.ok(ui.labels.includes(l),l);
 assert.equal((await fe(page)).disconnect,false,'Disconnect is hidden until connected');assert.equal(await page.evaluate(()=>window.explorerState),undefined,'no world before a server is chosen');
 // BrandingVersion watermark (GameUI Overlay): the client assembly's linker timestamp in this browser's whole-hour offset.
 // Menu audio waits for a user gesture: nothing has been pressed yet.
 const menu0=await fe(page),offset=await page.evaluate(()=>new Date(1426117557000).getTimezoneOffset());
 assert.equal(menu0.branding?.text,brandingText(1426117557,Math.trunc(-offset/60)));assert.equal(menu0.branding.visible,true);
 assert.equal(await page.locator('#front-end .df-overlay [data-df-name="Version"] .df-text').textContent(),menu0.branding.text);
 assert.equal(menu0.menuAudio?.unlocked??false,false,'no menu audio before a gesture');
 await page.screenshot({path:out+'menu.png'});step('menu',{...ui,branding:menu0.branding});
 await page.locator('#front-end [data-df-name="btnPlay"]').click();await waitFe(page,s=>s.servers&&!/^Updating/.test(s.details)&&s.details!=='...');
 let s=await fe(page);assert.equal(s.category,0,'ServerBrowser starts on Official');assert.equal(s.counts.find(c=>c.id===1).count,2,'offline island + Pilot in Community');assert.equal(s.signInHint,true);
 assert.match(s.details,/^Found 0 players on 2 servers\./);assert.equal(await page.locator('#front-end [data-df-name="lblDetails"] a[href="/"]').count(),1,'sign-in link');
 await page.locator('#front-end [data-df-name="Community"]').click();await waitFe(page,s=>s.rows.length===2);s=await fe(page);
 const pilot=s.rows.find(r=>r.name==='Pilot');assert.ok(pilot,'central server listed');assert.equal(pilot.players,'0 / 50');assert.equal(pilot.ping,'-');assert.equal(pilot.address,stack.serverId);
 assert.deepEqual(s.rows.find(r=>r.address==='offline'),{name:'Rust Island (offline, this browser only)',address:'offline',players:'0 / 1',ping:'0'});
 await page.screenshot({path:out+'server-browser.png'});step('server browser',{rows:s.rows,details:s.details});
 // The Play click was the first gesture: the Menu Background MusicPlayer (startDelay 3 -> 6 s after the scene start) and the
 // wind / FireBarrel loops play through audioSettings (sound.music 0.4 x targetVolume 0.2).
 const heard=await waitFe(page,s=>s.menuAudio?.unlocked&&s.menuAudio.loops.length===2&&s.menuAudio.loops.every(l=>l.playing)&&s.menuAudio.music?.playing,null,60000);
 assert.equal(heard.menuAudio.context,'running');assert.ok(heard.menuAudio.music.volume>0&&heard.menuAudio.music.volume<=0.2*0.4+1e-6,'music volume '+heard.menuAudio.music.volume);
 assert.deepEqual(heard.menuAudio.loops.map(l=>[l.path,+l.volume.toFixed(3)]),[['Menu Background/wind',0.045],['Menu Background/FireBarrel',0.582]]);step('menu audio after the first gesture',heard.menuAudio);
 await page.locator(`#front-end [data-address="${stack.serverId}"] [data-df-name="btnHostname"]`).dblclick();await waitFe(page,s=>s.notices.some(n=>/Failed to connect \(sign-in-required\)/.test(n))&&!s.loading);
 await page.screenshot({path:out+'signed-out-notice.png'});step('signed-out join refused');
 // ---- B: Options persist (ConvarBinding -> Apply -> config.save) ------------------------------------------------
 await page.locator('#front-end [data-df-name="btnOptions"]').click();await waitFe(page,s=>s.options&&!s.servers);
 const before=(await fe(page)).values;assert.deepEqual([before['input.mousespeed'],before['input.flipy'],before['render.vsync'],before['water.reflection'],before['sound.volume'],before['render.fov']],[5,false,false,false,1,60]);
 // Browser section: Grass (grass.on) and FPS Counter start off for every player (owner decision).
 assert.equal(before['grass.on'],false,'grass starts off');assert.equal(before.fps,false,'FPS counter starts off');
 await page.locator('#front-end [data-option="grass"] .df-dfCheckbox').click();await page.locator('#front-end [data-option="fps"] .df-dfCheckbox').click();
 const clickAt=async(selector,fraction)=>{const l=page.locator(selector),b=await l.boundingBox();await l.click({position:{x:b.width*fraction,y:b.height/2}});};
 await clickAt('#front-end [data-df-name="MouseSensitivity"]',0.3);await page.locator('#front-end [data-df-name="pnlInvertMouseY"] [data-df-name="Checkbox"]').click();
 await clickAt('#front-end [data-df-name="Sound-Volume"] [data-df-name="Slider"]',0.5);await clickAt('#front-end .df-instance [data-df-name="Awesomness"] [data-df-name="Slider"]',0.5);
 const edited=(await fe(page)).values;assert.ok(Math.abs(edited['input.mousespeed']-3)<0.1,edited['input.mousespeed']);assert.equal(edited['input.flipy'],true);assert.equal(edited['grass.on'],true);assert.equal(edited.fps,true);
 assert.equal(await page.evaluate(()=>localStorage.getItem('rlb-convars')),null,'nothing is saved before Apply');
 // Key bindings (OptionsInput rows, OptionsKeyBinding): click a cell, press a key; Escape blanks the cell (None); a mouse
 // button binds as MouseN (right = Mouse1). Nothing changes until Apply (UpdateConVars -> input.bind, config.save).
 const keyCell=(name,i)=>page.locator(`#front-end [data-button="${name}"] [data-df-name="Sliced Sprite"]`).nth(i),keyOf=(st,name)=>st.keys.find(k=>k[0]===name);
 let keyState=await fe(page);assert.equal(keyState.keys.length,16);assert.deepEqual(keyOf(keyState,'Up'),['Up','W',' ']);assert.deepEqual(keyOf(keyState,'Chat'),['Chat','Return','T']);assert.deepEqual(keyOf(keyState,'Fire'),['Fire','Mouse0',' ']);
 await keyCell('Up',0).click();await waitFe(page,s=>s.listening==='Up'&&keyOf(s,'Up')[1]==='...');
 await page.keyboard.press('KeyK');await waitFe(page,s=>!s.listening&&keyOf(s,'Up')[1]==='K');
 // Clicking another cell while listening: the mouse-down binds Mouse0 to the listening cell, then that click starts the next.
 await keyCell('Down',0).click();await waitFe(page,s=>s.listening==='Down');await keyCell('Jump',0).click();await waitFe(page,s=>s.listening==='Jump'&&keyOf(s,'Down')[1]==='Mouse0');
 await page.keyboard.press('Space');await waitFe(page,s=>!s.listening&&keyOf(s,'Jump')[1]==='Space');await keyCell('Down',0).click();await waitFe(page,s=>s.listening==='Down');await page.keyboard.press('KeyS');await waitFe(page,s=>!s.listening&&keyOf(s,'Down')[1]==='S');
 await keyCell('Chat',1).click();await waitFe(page,s=>s.listening==='Chat');await page.keyboard.press('Escape');await waitFe(page,s=>!s.listening&&keyOf(s,'Chat')[2]===' ');
 assert.equal((await fe(page)).options,true,'Escape while listening stays in Options');
 await keyCell('Reload',1).click();await waitFe(page,s=>s.listening==='Reload');{const b=await keyCell('Reload',1).boundingBox();await page.mouse.click(b.x+b.width/2,b.y+b.height/2,{button:'right'});}
 await waitFe(page,s=>!s.listening&&keyOf(s,'Reload')[2]==='Mouse1');
 assert.equal(await page.evaluate(()=>localStorage.getItem('rlb-input-binds')),null,'binds are saved by Apply');
 await keyCell('Up',0).scrollIntoViewIfNeeded();await page.screenshot({path:'analysis/browser-qa/tags-binds/options-keys.png'});
 // Render Quality: a fresh profile starts at the original default (Fastest, mainData m_CurrentQuality 0); pick Good (0.6),
 // the first level with SoftVegetation, so the grass steps below can draw.
 assert.equal((await fe(page)).values['render.level'],0);
 {const q=page.locator('#front-end [data-convar="render.level"]'),b=await q.boundingBox();await q.click({position:{x:b.width*0.6,y:b.height/2}});}
 await page.locator('#front-end [data-df-name="btnApply"]').click();
 const saved=await page.evaluate(()=>({convars:JSON.parse(localStorage.getItem('rlb-convars')),sound:JSON.parse(localStorage.getItem('rlb-sound')),render:JSON.parse(localStorage.getItem('rlb-render-settings'))}));
 assert.ok(Math.abs(saved.convars['input.mousespeed']-edited['input.mousespeed'])<1e-9);assert.equal(saved.convars['input.flipy'],true);assert.ok(Math.abs(saved.sound.volume-0.5)<0.02);assert.equal(saved.render.fov,90);assert.equal(saved.convars['grass.on'],true);assert.equal(saved.render.showFps,true);assert.equal(Math.round(saved.convars['render.level']*5),3,'Render Quality Good saved');
 await page.screenshot({path:out+'options.png'});
 await page.reload({waitUntil:'load'});await waitFe(page,s=>s.menu);await page.locator('#front-end [data-df-name="btnOptions"]').click();await waitFe(page,s=>s.options);
 const after=(await fe(page)).values;assert.ok(Math.abs(after['input.mousespeed']-edited['input.mousespeed'])<1e-9);assert.equal(after['input.flipy'],true);assert.ok(Math.abs(after['sound.volume']-0.5)<0.02);assert.equal(after['render.fov'],90);assert.equal(after['grass.on'],true);assert.equal(after.fps,true);
 assert.deepEqual((await fe(page)).inert,['render.vsync']);
 const binds=await page.evaluate(()=>localStorage.getItem('rlb-input-binds'));for(const line of ['input.bind Up K None','input.bind Chat Return None','input.bind Reload R Mouse1','input.bind Down S None'])assert.ok(binds.includes(line),line+' in '+binds);
 keyState=await fe(page);assert.deepEqual(keyOf(keyState,'Up'),['Up','K',' ']);assert.deepEqual(keyOf(keyState,'Chat'),['Chat','Return',' ']);assert.deepEqual(keyOf(keyState,'Reload'),['Reload','R','Mouse1']);
 step('options persist',{saved,binds});
 // F1 ConsoleWindow from boot (the same GameUI scene as MainMenu): client commands on the main menu; only F1 closes it.
 const consolePlain=()=>page.$$eval('#game-console .console-plain',e=>e.map(x=>x.textContent));
 await page.keyboard.press('F1');await page.waitForSelector('#game-console:not([hidden])');await page.locator('#console-input').fill('global.echo menu-console');await page.locator('#console-input').press('Enter');
 await page.waitForFunction(()=>[...document.querySelectorAll('#game-console .console-plain')].some(x=>x.textContent==='menu-console'));await page.screenshot({path:out+'menu-console.png'});
 await page.keyboard.press('Escape');await page.waitForTimeout(100);assert.equal(await page.locator('#game-console').isVisible(),true,'Escape does not close the console');
 await page.keyboard.press('F1');await page.waitForSelector('#game-console',{state:'hidden'});step('F1 console on the main menu',{lines:(await consolePlain()).slice(-3)});
 // ---- C: offline join -> LoadingScreen progress -> in game -> Escape menu -> Disconnect --------------------------
 await page.locator('#front-end [data-df-name="btnPlay"]').click();await page.locator('#front-end [data-df-name="Community"]').click();await waitFe(page,s=>s.rows.some(r=>r.address==='offline'));
 await page.locator('#front-end [data-address="offline"] [data-df-name="btnHostname"]').dblclick();
 const samples=[];let shot=false;const t0=Date.now();
 while(Date.now()-t0<300000){const st=await fe(page);samples.push({info:st.info,progress:st.progress,loading:st.loading,background:st.background});if(!shot&&st.progress>0.2){await page.screenshot({path:out+'loading.png'});shot=true;}
  if(st.inGame&&await page.evaluate(()=>window.explorerState?.frames>5))break;await page.waitForTimeout(50);}
 const infos=[...new Set(samples.map(x=>x.info))];for(const label of ['loading rust_island_2013','activating rust_island_2013','loading gui','loading shared','growing trees','finished'])assert.ok(infos.includes(label),label+' in '+infos);
 assert.ok(samples[0].loading&&!samples[0].background,'the loading screen replaces the menu background at once');
 const progress=samples.map(x=>x.progress).filter(p=>p!=null);assert.ok(progress.length>=3&&progress.some((p,i)=>i>0&&p>progress[i-1]),'progress advances: '+progress.slice(0,12));
 s=await fe(page);assert.equal(s.menu,false);assert.equal(s.loading,false);const play=await page.evaluate(()=>({walk:window.explorerState.walk,fov:window.explorerDev.controls().cameraFov}));assert.equal(play.walk,true,'spawned as a character');assert.equal(play.fov,90);
 const grassOn=await page.evaluate(()=>window.explorerState.grass);assert.equal(grassOn?.drawn,true,'grass draws when the option is on: '+JSON.stringify(grassOn));
 await waitFe(page,s=>/^\d+ FPS$/.test(s.fpsCounter??''),null,10000);
 await page.waitForTimeout(800);await page.screenshot({path:out+'in-game.png'});step('offline join',{infos,progress:progress.slice(0,20),graphics:await readGraphics(page)});
 // LoadingScreen.Update Debug.Logs every stage; ConsoleWindow.CaptureLog wraps it as [color #eeeeee]> ...[/color].
 {const lines=(await page.evaluate(()=>window.explorerDev.controls().consoleWindow.lines));for(const label of ['loading rust_island_2013','growing trees','finished'])assert.ok(lines.includes(`[color #eeeeee]> LoadingScreen: ${label}[/color]`),label+' logged: '+lines.slice(0,30));
  assert.equal(lines.filter(l=>l==='[color #eeeeee]> LoadingScreen: activating rust_island_2013[/color]').length,1,'one line per stage');step('LoadingScreen lines in the console');}
 // The rebound Up key (K, applied and reloaded) walks the character; W no longer does.
 const feetNow=()=>page.evaluate(()=>window.explorerState.player.feet),moved=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
 let f0=await feetNow();await page.keyboard.down('KeyW');await page.waitForTimeout(700);await page.keyboard.up('KeyW');await page.waitForTimeout(300);let f1=await feetNow();assert.ok(moved(f0,f1)<0.05,'W is not bound any more: '+moved(f0,f1));
 await page.keyboard.down('KeyK');await page.waitForTimeout(900);await page.keyboard.up('KeyK');await page.waitForTimeout(300);const f2=await feetNow();assert.ok(moved(f1,f2)>1,'K walks forward: '+moved(f1,f2));
 step('rebound key moves the player',{withW:moved(f0,f1),withK:moved(f1,f2)});
 await page.locator('#world').click({position:{x:640,y:360}});await page.waitForFunction(()=>Boolean(document.pointerLockElement));
 // ChatUI: Return opens chat and releases the cursor deliberately (no Escape menu); Escape while chatting cancels it and,
 // as MainMenu.Update reads the same key, toggles the menu too.
 await page.keyboard.press('Enter');await page.waitForFunction(()=>window.explorerDev.chat()?.open&&!document.pointerLockElement);await page.waitForTimeout(300);assert.equal((await fe(page)).menu,false,'opening chat is not the Escape menu');
 await page.keyboard.type('x');await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.explorerDev.chat().open);await waitFe(page,s=>s.menu);await page.keyboard.press('Escape');await waitFe(page,s=>!s.menu);
 assert.deepEqual(await page.evaluate(()=>window.explorerDev.chat().lines),[]);step('chat open/cancel in the normal entry');
 // RPOS is non-modal: belt keys still work over it (its unlock node has AllowSubsetOfKeys), chat opens and types over it
 // (HumanController.Poll), and Escape both hides RPOS (HumanController) and opens the menu (MainMenu.Update).
 await page.keyboard.press('Tab');await page.waitForSelector('#inventory[open]');
 {const before=await page.evaluate(()=>[...document.querySelectorAll('#belt .item-slot')].map(b=>({n:Number(b.dataset.slot)-29,alt:b.querySelector(':scope > img')?.alt??null,selected:b.classList.contains('selected')})));
  const cell=before.find(c=>['Rock','Torch'].includes(c.alt));if(cell){await page.keyboard.press('Digit'+cell.n);await page.waitForFunction(([s,was])=>document.querySelector(`#belt [data-slot="${s}"]`)?.classList.contains('selected')!==was,[cell.n+29,cell.selected],{timeout:5000});}
  await page.keyboard.press('F1');await page.waitForSelector('#game-console:not([hidden])');await page.locator('#console-input').fill('global.echo over-rpos');await page.locator('#console-input').press('Enter');
  await page.waitForFunction(()=>[...document.querySelectorAll('#game-console .console-plain')].some(x=>x.textContent==='over-rpos'));await page.keyboard.press('F1');await page.waitForSelector('#game-console',{state:'hidden'});
  await page.keyboard.press('Enter');await page.waitForFunction(()=>window.explorerDev.chat()?.open);await page.waitForTimeout(100);/* ChatUI.Open's ClearText after .05 s clears anything typed sooner */await page.keyboard.type('over rpos');assert.equal(await page.evaluate(()=>window.explorerDev.chat().text),'over rpos','chat takes typing with RPOS up');
  assert.equal(await page.locator('#inventory').getAttribute('open'),'','RPOS stays up while chatting');await page.screenshot({path:out+'chat-over-rpos.png'});
  await page.keyboard.press('Escape');await page.waitForSelector('#inventory:not([open])',{state:'attached'});await waitFe(page,s=>s.menu);await page.waitForFunction(()=>!window.explorerDev.chat().open);
  assert.deepEqual(await page.evaluate(()=>window.explorerDev.chat().lines),[],'Escape sent nothing');await page.keyboard.press('Tab');await page.waitForTimeout(200);assert.equal(await page.locator('#inventory').getAttribute('open'),null,'Tab does nothing behind the menu');
  await page.keyboard.press('Escape');await waitFe(page,s=>!s.menu);step('RPOS with belt keys, chat and Escape',{beltKey:cell?.alt??null});}
 await page.locator('#world').click({position:{x:640,y:360}});await page.waitForFunction(()=>Boolean(document.pointerLockElement));
 await page.keyboard.press('Escape');await waitFe(page,s=>s.menu&&s.disconnect);assert.equal(await page.evaluate(()=>document.pointerLockElement),null);
 assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#game-hud')).visibility),'hidden','HudEnabled.Disable');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#chat-ui')).visibility),'hidden','chat hides with the HUD');
 await page.waitForTimeout(300);await page.screenshot({path:out+'in-game-menu.png'});
 await page.keyboard.press('Escape');await waitFe(page,s=>!s.menu);await page.keyboard.press('Escape');await waitFe(page,s=>s.menu);step('in-game Escape menu');
 // In game: FPS counter only while playing; Grass off via Options, back on via the F1 console, the checkbox follows.
 assert.equal((await fe(page)).fpsCounter,null,'FPS counter hidden behind the menu');
 await page.locator('#front-end [data-df-name="btnOptions"]').click();await waitFe(page,s=>s.options&&s.values['grass.on']===true);
 await page.locator('#front-end [data-option="grass"] .df-dfCheckbox').click();await page.locator('#front-end [data-df-name="btnApply"]').click();
 await page.keyboard.press('Escape');await waitFe(page,s=>!s.menu);
 const grassOff=await page.waitForFunction(()=>{const g=window.explorerState.grass;return g&&!g.drawn&&!g.on&&g.triangles===0&&g;},{},{timeout:10000}).then(h=>h.jsonValue());
 const fpsText=(await waitFe(page,s=>/^\d+ FPS$/.test(s.fpsCounter??''),null,10000)).fpsCounter;
 await page.screenshot({path:out+'in-game-fps-grass-off.png'});
 await page.keyboard.press('F1');await page.locator('#console-input').fill('grass.on true');await page.locator('#console-input').press('Enter');
 const grassBack=await page.waitForFunction(()=>{const g=window.explorerState.grass;return g?.drawn&&g.on&&g;},{},{timeout:10000}).then(h=>h.jsonValue());await page.keyboard.press('F1');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rlb-convars'))['grass.on']),true,'console change saved');
 await page.keyboard.press('Escape');await waitFe(page,s=>s.menu&&s.disconnect);if(!(await fe(page)).options)await page.locator('#front-end [data-df-name="btnOptions"]').click(); // (the window may still be open)
 await waitFe(page,s=>s.options&&s.values['grass.on']===true,null,10000);assert.equal((await fe(page)).fpsCounter,null);
 step('grass and FPS counter options',{grassOff,grassBack:{drawn:grassBack.drawn,patches:grassBack.patches},fpsText});
 // Client console commands run locally (client-commands.mjs): gui.hide hides the RPOS HUD and the Overlay (branding, name
 // tags), gui.hide_branding only the BrandingPanel; footsteps.quality is a [Saved] convar (written by config.save).
 // Closing F1 relocked the cursor (ConsoleWindow: cursorManager.On = false), so the Escape above opened the menu through
 // onEscapeKey; MainMenu's own toggle skips an Escape within 400 ms of that one (front-end.mjs escapeAt).
 await page.waitForTimeout(450);await page.keyboard.press('Escape');await waitFe(page,s=>!s.menu);
 const runConsole=async line=>{await page.keyboard.press('F1');await page.locator('#console-input').fill(line);await page.locator('#console-input').press('Enter');await page.keyboard.press('F1');};
 const hudVisibility=()=>page.evaluate(()=>getComputedStyle(document.querySelector('#game-hud')).visibility);assert.equal(await hudVisibility(),'visible');
 await runConsole('gui.hide');assert.equal(await hudVisibility(),'hidden');assert.equal((await fe(page)).branding.visible,false,'GUIHide on the Overlay');
 await runConsole('gui.show');assert.equal(await hudVisibility(),'visible');assert.equal((await fe(page)).branding.visible,true);
 await runConsole('gui.hide_branding');assert.equal((await fe(page)).branding.visible,false);assert.equal(await hudVisibility(),'visible');await runConsole('gui.show_branding');assert.equal((await fe(page)).branding.visible,true);
 await runConsole('footsteps.quality 1');await runConsole('config.save');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rlb-convars'))['footsteps.quality']),1);
 await runConsole('footsteps.quality 2');await runConsole('config.save');assert.equal(await page.evaluate(()=>localStorage.getItem('net.lasturl')),'offline','net.connect stored net.lasturl');
 step('client console commands');
 // Render console variables without Options rows (browser/render-convars.mjs): render.distance moves the CULL500 cull
 // distance (600 + 1000 x m); water.level / water.reflection have no setter, so they wait for the next QualitySettingsRefresh
 // (render.update); render.frames is Application.targetFrameRate; terrain.idleinterval is [Client] only (never saved).
 const rc=()=>page.evaluate(()=>({cull:window.explorerDev.layerCulling().distances[12],sea:window.explorerDev.sea(),idle:window.explorerDev.treeIdle(),fps:window.explorerDev.frameLimit().fps,saved:JSON.parse(localStorage.getItem('rlb-convars')??'{}')}));
 let rcs=await rc();assert.equal(rcs.cull,800,'render.distance 0.2: CULL500 at 800 m');
 await runConsole('render.distance 1');rcs=await rc();assert.equal(rcs.cull,1600);assert.equal(rcs.saved['render.distance'],1,'[Saved]');await runConsole('render.distance 0.2');assert.equal((await rc()).cull,800);
 await runConsole('water.reflection true');assert.equal((await rc()).sea.reflections,false,'water.reflection waits for a refresh');
 await runConsole('render.update');assert.equal((await rc()).sea.reflections,true);
 await runConsole('water.level 3');assert.equal((await rc()).sea.quality,1,'water.level waits for a refresh');await runConsole('render.update');assert.equal((await rc()).sea.quality,2,'water.level 3: High');
 await page.waitForFunction(()=>window.explorerDev.sea().refraction==='grab',{},{timeout:10000});
 await runConsole('water.level -1');await runConsole('water.reflection false');await runConsole('render.update');rcs=await rc();assert.deepEqual([rcs.sea.reflections,rcs.sea.quality],[false,1],'back to Good: Medium sea');
 await page.waitForFunction(()=>window.explorerDev.sea().refraction==='none',{},{timeout:10000});
 await runConsole('render.frames 30');assert.equal((await rc()).fps,30);
 {const f0=await page.evaluate(()=>window.explorerState.frames);await page.waitForTimeout(2000);const rate=(await page.evaluate(()=>window.explorerState.frames)-f0)/2;assert.ok(rate<=33&&rate>5,`render.frames 30 caps the loop: ${rate} fps`);}
 await runConsole('render.frames -1');assert.equal((await rc()).fps,-1);
 await runConsole('terrain.idleinterval 0');assert.equal((await rc()).idle.interval,0);await runConsole('config.save');assert.equal('terrain.idleinterval' in (await rc()).saved,false,'[Client] only');await runConsole('terrain.idleinterval 3.2');
 step('render console variables',{cull:rcs.cull});
 await page.keyboard.press('Escape');await waitFe(page,s=>s.menu&&s.disconnect);if(!(await fe(page)).options)await page.locator('#front-end [data-df-name="btnOptions"]').click();await waitFe(page,s=>s.options);
 // Render Quality (render.level -> QualitySettings): Good from the Options step above; the Options
 // slider at its right end + Apply switches to Fantastic in game: four shadow cascades to 250 m, full-resolution textures,
 // and render.update's gfx switch turns the image effects on (Bloom too, because the camera already exists).
 const qStart=await page.evaluate(()=>window.explorerState.quality);assert.equal(qStart.name,'Good');assert.equal(qStart.shadows.type,'soft');assert.equal(qStart.shadows.cascades,1);assert.equal(qStart.textureLimit,0);
 const slider=page.locator('#front-end [data-convar="render.level"]'),box=await slider.boundingBox();
 // Water Reflections: Apply runs every binding (render.vsync after it refreshes), so the reflection mask follows at once.
 await page.locator('#front-end [data-convar="water.reflection"]').click();
 await slider.click({position:{x:box.width-1,y:box.height/2}});await page.locator('#front-end [data-df-name="btnApply"]').click();
 const qHigh=await page.waitForFunction(()=>{const q=window.explorerState.quality;return q.name==='Fantastic'&&q.shadows.allocated===4&&q;},{},{timeout:30000}).then(h=>h.jsonValue());
 assert.equal(qHigh.shadows.cascades,4);assert.equal(qHigh.shadows.distance,250);assert.equal(qHigh.textureLimit,0);assert.equal(qHigh.blendWeights,4);assert.equal(qHigh.anisotropy.enabled,true);
 assert.deepEqual(qHigh.imageEffects.states['TOD_SunShafts'],true);assert.equal(qHigh.imageEffects.live.Bloom,true);
 assert.equal(Math.round(await page.evaluate(()=>JSON.parse(localStorage.getItem('rlb-convars'))['render.level'])*5),5,'saved by Apply');
 {const sea=await page.waitForFunction(()=>{const s=window.explorerDev.sea();return s.reflections&&s.quality===2&&s.refraction==='grab'&&s;},{},{timeout:10000}).then(h=>h.jsonValue());assert.equal(sea.edgeBlend,1,'Fantastic: High sea with edge blend');}
 await page.keyboard.press('Escape');await waitFe(page,s=>!s.menu);
 await page.waitForFunction(()=>['TOD_SunShafts','AntialiasingAsPostEffect','Bloom'].every(x=>window.explorerState.quality.post.passes.includes(x)),{},{timeout:10000}).catch(async e=>{console.error('post state',JSON.stringify(await page.evaluate(()=>window.explorerState.quality.post)));throw e;});
 await page.waitForTimeout(500);await page.screenshot({path:out+'in-game-fantastic.png'});
 await page.keyboard.press('Escape');await waitFe(page,s=>s.menu&&s.disconnect);if(!(await fe(page)).options)await page.locator('#front-end [data-df-name="btnOptions"]').click();await waitFe(page,s=>s.options);
 await slider.click({position:{x:1,y:box.height/2}});await page.locator('#front-end [data-df-name="btnApply"]').click();
 const qLow=await page.waitForFunction(()=>{const q=window.explorerState.quality;return q.name==='Fastest'&&!q.shadows.enabled&&q;},{},{timeout:30000}).then(h=>h.jsonValue());
 assert.equal(qLow.textureLimit,2);assert.equal(qLow.imageEffects.states['TOD_SunShafts'],false);assert.deepEqual([qLow.post.effects.shafts,qLow.post.effects.fxaa,qLow.post.effects.bloom],[false,false,false]);
 await page.waitForFunction(()=>{const g=window.explorerState.grass;return g&&g.on&&!g.softVegetation&&!g.drawn;},{},{timeout:10000}); // Fastest: no SoftVegetation, no grass
 step('render quality options',{start:qStart.name,high:{shadows:qHigh.shadows.cascades,passes:qHigh.post.passes},low:qLow.name});
 await Promise.all([page.waitForEvent('load',{timeout:60000}),page.locator('#front-end [data-df-name="btnDisconnect"]').click()]);await waitFe(page,s=>s.menu&&!s.inGame);
 assert.equal(await page.evaluate(()=>window.explorerState),undefined);assert.equal((await fe(page)).disconnect,false);
 assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('rlb-server-history')).some(h=>h.address==='offline')),'history');
 await page.locator('#front-end [data-df-name="btnPlay"]').click();await page.locator('#front-end [data-df-name="History"]').click();await waitFe(page,s=>s.category===4&&s.rows.length===1);
 assert.match((await fe(page)).rows[0].name,/^Rust Island \(offline, this browser only\) \(\d+ seconds ago\)$/);step('offline disconnect returns to the menu');
 assert.deepEqual(errors,[]);assert.deepEqual(allowedFailures(bad),[]);await page.close();
 // ---- D: online join through central (signed in) and Disconnect --------------------------------------------------
 const player=await stack.login('frontend-player');const online=await browser.newContext({viewport:{width:1280,height:720}});
 await online.addCookies([{name:'rlb_session',value:player.cookie.split('=').slice(1).join('='),url:origin}]);
 ({page,errors,bad}=await open(online));await waitFe(page,s=>s.menu);
 await page.locator('#front-end [data-df-name="btnPlay"]').click();await page.locator('#front-end [data-df-name="Community"]').click();await waitFe(page,s=>s.rows.length===2&&!s.signInHint);
 await page.locator(`#front-end [data-address="${stack.serverId}"] [data-df-name="btnHostname"]`).dblclick();await waitFe(page,s=>s.loading);
 await nativePeer(seenPeers);await waitFe(page,s=>s.inGame&&!s.loading&&!s.menu,null,300000);
 await page.waitForFunction(()=>window.explorerState?.online?.state==='in-game'&&window.explorerState.frames>5,{},{timeout:120000});
 const feet=await page.evaluate(()=>window.explorerState.player.feet);assert.ok(Math.hypot(feet[0]-5244.1,feet[2]-4839.6)<1,'at the server spawn: '+feet);
 await page.waitForTimeout(500);await page.screenshot({path:out+'online-in-game.png'});step('online join through central',{feet});
 await page.keyboard.press('Escape');await waitFe(page,s=>s.menu&&s.disconnect);
 await Promise.all([page.waitForEvent('load',{timeout:60000}),page.locator('#front-end [data-df-name="btnDisconnect"]').click()]);await waitFe(page,s=>s.menu&&s.notices.includes('Disconnected from server.'));
 await page.waitForTimeout(400);await page.screenshot({path:out+'disconnected-notice.png'});step('online disconnect notice');
 assert.deepEqual(errors,[]);assert.deepEqual(allowedFailures(bad),[]);await page.close();
 // ---- E: the website's Join button (one-use sessionStorage ticket) goes straight to the loading screen --------------
 const websitePlayer=await stack.login('website-player'),{ticket}=(await stack.call('POST',`/servers/${stack.serverId}/join-ticket`,{cookie:websitePlayer.cookie,csrf:websitePlayer.csrf})).data;
 const site=await online.newPage();const siteErrors=[];site.on('pageerror',e=>siteErrors.push(e.message));site.on('console',m=>{if(m.type()==='error'&&!/^Failed to load resource/.test(m.text()))siteErrors.push(m.text());});
 await site.addInitScript(j=>{if(!sessionStorage.getItem('rlb-join-used')){sessionStorage.setItem('rlb-join-used','1');sessionStorage.setItem('rlb-join',JSON.stringify({...j,at:Date.now()}));}},{ticket,endpoint:`ws://127.0.0.1:${stack.gateway.port}/play`,server:stack.serverId,name:'Pilot'});
 await site.goto(origin+'/',{waitUntil:'load'});await site.waitForFunction(()=>window.rlbFrontEnd?.state().loading,{},{timeout:60000});
 const first=await fe(site);assert.equal(first.background,false);assert.ok(['connecting..','connected!','loading rust_island_2013'].includes(first.info),first.info);
 await site.screenshot({path:out+'website-ticket-loading.png'});
 await nativePeer(seenPeers).catch(async e=>{console.error('website join state',JSON.stringify(await fe(site)).slice(0,800));throw e;});await waitFe(site,s=>s.inGame&&!s.loading,null,300000);await site.waitForFunction(()=>window.explorerState?.online?.state==='in-game',{},{timeout:120000});
 assert.equal(await site.evaluate(()=>sessionStorage.getItem('rlb-join')),null,'ticket used once');step('website ticket join');assert.deepEqual(siteErrors,[]);
 result.ok=true;result.graphics=await readGraphics(site);await writeFile(out+'frontend.json',JSON.stringify(result,null,2));console.log(JSON.stringify({ok:true,steps:result.steps.map(s=>s.name)}));
}finally{await browser.close();await stack.close();await new Promise(r=>http.close(r));}
