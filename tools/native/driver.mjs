// Browser-side driving for the real-server harnesses: a player's page on the website origin, sign-in, the website
// join (one-use ticket in sessionStorage -> /play, the normal game entry, no ?dev), the gateway frame log, keyboard
// and mouse like a player, F1 console and chat. Imports qa-browser.mjs so every page gets the Pointer Lock stand-in.
// Read-only page state used: window.explorerState, window.rlbFrontEnd.state(), explorerDev.chat()/onlineSky(), and
// explorerDev.aimPoint() as a mouse-look stand-in (it only turns the camera, like moving the mouse).
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {launchOptions,pointerLockStandIn} from '../qa-browser.mjs';
import {FrameLog,readSecret,consoleMessage} from './lib.mjs';
import {TruthGuard} from './truth-guard.mjs';

export {chromium,launchOptions};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// BROWSER_CDP=http://127.0.0.1:<port>: attach to a browser started elsewhere (--remote-debugging-port) instead of launching
// one, for hosts where processes started by Node cannot reach the test VM but the user's own browser can.
export async function launchBrowser(){
 if(!process.env.BROWSER_CDP)return chromium.launch(launchOptions());
 // An attached browser skips qa-browser's launch wrapper: add the same in-page Pointer Lock stand-in here, or clicking
 // into the game would confine the user's real cursor (unless REAL_POINTER_LOCK=1). Start that browser with --mute-audio.
 const browser=await chromium.connectOverCDP(process.env.BROWSER_CDP);
 if(process.env.REAL_POINTER_LOCK!=='1'){const newContext=browser.newContext.bind(browser);browser.newContext=async(...o)=>{const context=await newContext(...o);await context.addInitScript(pointerLockStandIn);return context;};}
 return browser;
}

// Several browsers for one run: BROWSER_CDP may list several endpoints (comma-separated), one per Edge instance, so N
// game pages do not share one GPU process. Without BROWSER_CDP this is one launched browser.
export async function launchBrowsers(){
 const list=(process.env.BROWSER_CDP??'').split(',').map(s=>s.trim()).filter(Boolean);
 if(list.length<=1)return [await launchBrowser()];
 const out=[];for(const url of list){process.env.BROWSER_CDP=url;out.push(await launchBrowser());}
 process.env.BROWSER_CDP=list.join(',');return out;
}

// ---- bad network (--net) ------------------------------------------------------------------------------------------
// Wraps the page's WebSocket before any game code runs. Each frame waits one one-way delay (latency/2 ± jitter/2) in
// each direction; frames stay in order (TCP). A "lost" frame (loss %) and every frame behind it wait one extra
// retransmission, max(200 ms, latency): over TCP a lost segment stalls the stream, it never disappears. CDP network
// emulation is not used: it does not reliably delay WebSocket frames and would also throttle the 1 GB island download.
export function netShim(net){
 const W=window.WebSocket;if(!W||W.__rlbShim)return;
 const st=window.__rlbNet={net,tx:0,rx:0,lost:0,addedMs:{tx:0,rx:0}};
 const oneWay=()=>Math.max(0,net.latency/2+(Math.random()*2-1)*net.jitter/2),rto=Math.max(200,net.latency);
 class ShimSocket extends W{
  constructor(...a){super(...a);this.__q={tx:0,rx:0};const pass=new WeakSet();
   const delay=(dir,fn)=>{let d=oneWay();if(Math.random()*100<net.loss){d+=rto;st.lost++;}
    const at=Math.max(this.__q[dir],performance.now()+d);this.__q[dir]=at;st[dir]++;st.addedMs[dir]+=at-performance.now();setTimeout(fn,at-performance.now());};
   for(const type of ['message','close','error'])super.addEventListener(type,e=>{if(pass.has(e))return;e.stopImmediatePropagation();
    // close/error wait behind the frames already in flight
    const clone=type==='message'?new MessageEvent('message',{data:e.data,origin:e.origin}):type==='close'?new CloseEvent('close',{code:e.code,reason:e.reason,wasClean:e.wasClean}):new Event('error');
    pass.add(clone);if(type==='message')delay('rx',()=>this.dispatchEvent(clone));else setTimeout(()=>this.dispatchEvent(clone),Math.max(0,this.__q.rx-performance.now()));});
  }
  send(data){const s=()=>{if(this.readyState===1)super.send(data);};const d=()=>s();if(!net.latency&&!net.jitter&&!net.loss)return s();
   let x=Math.max(0,net.latency/2+(Math.random()*2-1)*net.jitter/2);if(Math.random()*100<net.loss){x+=Math.max(200,net.latency);st.lost++;}
   const at=Math.max(this.__q.tx,performance.now()+x);this.__q.tx=at;st.tx++;st.addedMs.tx+=at-performance.now();setTimeout(d,at-performance.now());}
 }
 ShimSocket.__rlbShim=true;window.WebSocket=ShimSocket;
}
export const applyNetwork=(context,net)=>net&&(net.latency||net.jitter||net.loss)?context.addInitScript(netShim,net):null;

// ---- lite bots (load tests) ---------------------------------------------------------------------------------------
// A lite bot is a player without the game page: from a page on the website origin it signs in (dev sign-in), takes a
// join ticket with the website's own API call (POST /servers/{id}/join-ticket, CSRF from GET /me) and speaks
// rlb-gateway.v1 itself like browser/net-client.mjs: admit, ClientFirstReady when ServerManagement appears, then
// stands at its spawn sending moves at the server send rate (turning on the spot; no collision world, so it never
// walks), answers deaths with RequestRespawn, and runs console probes and chat on request. Several bots share one
// page, each with its own WebSocket (the ticket, not the cookie, admits a socket). Counters live in the page, so 50
// bots' world traffic never crosses CDP frame by frame.
export function liteLib(){
 if(window.__lite)return;
 const SM=/(^|\/)ServerManagement$/i,bots=new Map();
 const csrf=()=>fetch('/me',{headers:{accept:'application/json'}}).then(r=>r.ok?r.json():null).then(m=>m?.csrf).catch(()=>null);
 async function ticket({subject,name,serverId}){
  const l=await fetch('/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({subject,name})});
  if(l.status!==200)throw Error('dev sign-in '+l.status+' '+(await l.text()).slice(0,120));
  const r=await fetch(`/servers/${encodeURIComponent(serverId)}/join-ticket`,{method:'POST',headers:{accept:'application/json','x-csrf-token':await csrf()},credentials:'same-origin'});
  const body=await r.json().catch(()=>null);if(r.status!==200)throw Error('join-ticket '+r.status+' '+JSON.stringify(body));return body;
 }
 const send=(b,cmd)=>{if(b.ws?.readyState===1){const s=JSON.stringify(cmd);b.ws.send(s);b.tx++;b.txBytes+=s.length;}};
 function moves(b){clearInterval(b.timer);b.timer=setInterval(()=>{if(b.char==null||!b.pos)return;b.yaw=(b.yaw+3)%360;
  send(b,{type:'move',origin:b.pos,angles:{yaw:b.yaw-180,pitch:0},stateFlags:0,at:Math.round(performance.now())});},b.sendMs*1.1);}
 function waiter(b,pred,ms){return new Promise(res=>{const w={pred,res,t:performance.now()};b.waiters.push(w);setTimeout(()=>{const i=b.waiters.indexOf(w);if(i>=0){b.waiters.splice(i,1);res(null);}},ms);});}
 async function join(n,{subject,name,serverId,timeoutMs=120000}){
  const old=bots.get(n);if(old){clearInterval(old.timer);old.ws?.close();}
  const b={n,ws:null,state:'ticket',sm:null,char:null,pos:null,spawn:null,yaw:Math.random()*360,sendMs:100,timer:null,rx:0,rxBytes:0,tx:0,txBytes:0,
   corrections:[],deaths:0,respawns:0,kp:null,ended:null,waiters:[],t0:performance.now(),times:{}};
  bots.set(n,b);
  const {ticket:tk,endpoint}=await ticket({subject,name,serverId});b.times.ticketMs=performance.now()-b.t0;
  return new Promise((resolve,reject)=>{
   const ws=b.ws=new WebSocket(endpoint,['rlb-gateway.v1']),timer=setTimeout(()=>{reject(Error('no spawn within '+timeoutMs+' ms ('+b.state+')'));ws.close();},timeoutMs);
   ws.addEventListener('open',()=>{b.state='admitting';ws.send(JSON.stringify({type:'admit',ticket:tk,name}));});
   ws.addEventListener('close',e=>{clearInterval(b.timer);b.ended??={code:e.code,reason:e.reason,at:Date.now()};b.state='closed';clearTimeout(timer);reject(Error('closed before spawn: '+e.code+' '+e.reason));});
   ws.addEventListener('message',m=>{const text=String(m.data);b.rx++;b.rxBytes+=text.length;let e;try{e=JSON.parse(text);}catch{return;}
    for(const w of [...b.waiters])if(w.pred(e)){b.waiters.splice(b.waiters.indexOf(w),1);w.res(performance.now()-w.t);}
    if(e.type==='approved'){b.state='approved';b.playerId=e.playerId;b.sendMs=1000/Math.max(1,e.world?.sendRate??10);b.times.approvedMs=performance.now()-b.t0;return;}
    if(e.type==='denied'){clearTimeout(timer);reject(Error('denied: '+e.reason));return;}
    if(e.type==='kicked'||e.type==='disconnected'||e.type==='error'){b.ended={type:e.type,reason:e.reason??e.error??null,at:Date.now()};return;}
    if(e.type==='create'){
     if(SM.test(e.prefab??'')&&b.sm==null){b.sm=e.viewId;send(b,{type:'ready'});}
     if(e.mine&&e.prefab===':player_soldier'){b.char=e.viewId;b.pos=e.position;b.spawn??=e.position;b.state='in-game';if(b.times.spawnMs==null){b.times.spawnMs=performance.now()-b.t0;clearTimeout(timer);resolve({...b.times,playerId:b.playerId,position:e.position});}moves(b);}
     return;}
    if(e.type==='destroy'&&e.kind==='view'&&e.viewId===b.char){b.char=null;b.state='dead';b.deaths++;
     setTimeout(()=>{if(b.state==='dead'&&b.sm!=null){b.respawns++;send(b,{type:'rpc',viewId:b.sm,name:'RequestRespawn',args:[false]});}},3000);return;}
    if(e.type==='rpc'){const v=e.args?.values??[];
     if(e.name==='ReadClientMove'&&e.viewId===b.char&&Array.isArray(v[0])){const d=b.pos?Math.hypot(v[0][0]-b.pos[0],v[0][2]-b.pos[2]):null;b.corrections.push({at:Date.now(),d,lateS:Number.isFinite(v[3])?v[3]:null});b.pos=v[0];}
     if(e.name==='UnstickMove'&&Array.isArray(v[0])){b.corrections.push({at:Date.now(),d:null,unstick:true});b.pos=v[0];}
     if(e.name==='KP'&&Number.isInteger(v[0]))b.kp=v[0];}
   });
  });
 }
 // Runs a console command; resolves with the round trip in ms when a frame matching `reply` arrives, else null.
 async function command(n,text,{reply,kind='CL_ConsoleMessage',ms=10000}){
  const b=bots.get(n);if(!b||b.state!=='in-game')return null;const re=new RegExp(reply);
  const p=waiter(b,e=>e.type==='rpc'&&e.name===kind&&typeof e.args?.values?.[0]==='string'&&re.test(e.args.values[0]),ms);
  send(b,{type:'rpc',viewId:997,name:'SV_RunConsoleCommand',args:[text]});return p;
 }
 function stats(){return [...bots.values()].map(b=>({n:b.n,state:b.state,open:b.ws?.readyState===1,rx:b.rx,rxBytes:b.rxBytes,tx:b.tx,txBytes:b.txBytes,corrections:b.corrections.length,correctionDistances:b.corrections.map(c=>c.d).filter(Number.isFinite),correctionTimes:b.corrections.map(c=>({at:c.at,lateS:c.lateS??null})),
  deaths:b.deaths,respawns:b.respawns,kp:b.kp,ended:b.ended,times:b.times,net:window.__rlbNet?{tx:window.__rlbNet.tx,rx:window.__rlbNet.rx,lost:window.__rlbNet.lost,addedMs:window.__rlbNet.addedMs}:null}));}
 function leave(n){const b=bots.get(n);if(b){clearInterval(b.timer);b.state='left';b.ws?.close();bots.delete(n);}}
 window.__lite={join,command,stats,leave};
}
// A page on the website origin hosting lite bots (liteLib). Same-origin, so sign-in and ticket calls are first-party.
export async function openLitePage(browser,{origin,ignoreHttpsErrors=false,net=null}={}){
 const context=await browser.newContext({viewport:{width:320,height:200},ignoreHTTPSErrors:ignoreHttpsErrors});await applyNetwork(context,net);
 await context.addInitScript(liteLib);const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(String(e.message).slice(0,500)));
 // A JSON API answer (GET /me, 401 before sign-in) as the page: the website's HTML and static files carry a CSP with
 // connect-src 'self', which blocks the gateway's WebSocket on its own port; API answers carry none.
 await page.goto(origin+'/me',{waitUntil:'load'});await page.waitForFunction(()=>Boolean(window.__lite),{},{timeout:10000});
 return {context,page,errors,close:()=>context.close().catch(()=>{})};
}

// A fresh context (own cookies + sessionStorage) and page with frame capture. `redact` strings never reach the log.
export async function openPlayer(browser,{viewport,ignoreHttpsErrors=false,redact=[],keep,net=null}={}){
 const context=await browser.newContext({viewport,ignoreHTTPSErrors:ignoreHttpsErrors});await applyNetwork(context,net);await context.addInitScript(netShaper);
 const page=await context.newPage(),frames=new FrameLog({redact,keep}),errors=[],sockets=[];
 page.on('pageerror',e=>errors.push(String(e.message).slice(0,500)));
 page.on('console',m=>{if(m.type()==='error'&&!/^Failed to load resource/.test(m.text()))errors.push(m.text().slice(0,500));});
 page.on('websocket',ws=>{
  let path='';try{path=new URL(ws.url()).pathname;}catch{}
  if(!/\/play$/.test(path))return;
  const s={url:ws.url(),openedAt:Date.now(),closedAt:null};sockets.push(s);
  ws.on('framereceived',d=>frames.add(typeof d.payload==='string'?d.payload:d.payload.toString(),'rx'));
  ws.on('framesent',d=>frames.add(typeof d.payload==='string'?d.payload:d.payload.toString(),'tx'));
  ws.on('close',()=>{s.closedAt=Date.now();});
  ws.on('socketerror',e=>errors.push('websocket: '+e));
 });
 pageFrames.set(page,frames);
 return {context,page,frames,errors,sockets,socketOpen:()=>sockets.length>0&&sockets.at(-1).closedAt==null,close:()=>context.close().catch(()=>{})};
}
// The frame log of a page opened with openPlayer (walkers read the server's corrections of their character from it).
const pageFrames=new WeakMap();
export const correctionCount=page=>pageFrames.get(page)?.correctionCount??0;
// Only the corrections that cost TruthDetector violation (not UnstickMove teleports, not late-dropped moves).
export const truthCorrectionCount=page=>pageFrames.get(page)?.truthCorrectionCount??0;

// Website usernames for a dev test account (site/js/form-rules.mjs: 3-20 of A-Z a-z 0-9 _ -, starting with a letter or
// digit; unique, case-insensitive): the requested name when it already fits, then the subject cut to 11 characters plus
// 8 hex of its hash, so subjects that share a long prefix (persist-bot-1, persist-bot-2) never collide.
export function usernameCandidates(account){
 const rule=/^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$/,out=[];
 const name=String(account.name??account.subject??'').trim();if(rule.test(name))out.push(name);
 const subject=String(account.subject??name),base=subject.replace(/[^A-Za-z0-9_-]/g,'-').replace(/^[^A-Za-z0-9]+/,'')||'t';
 out.push(base.slice(0,11)+'-'+createHash('sha256').update(subject).digest('hex').slice(0,8));
 return out;
}

// Signs in on the website origin. password: the real /signin form; dev: POST /auth/login (development verifier,
// only present on test centrals such as the mock stack), then a website username if the account has none (see the
// dev branch). Returns GET /me ({player, name}).
export async function signIn(page,origin,account,{env=process.env}={}){
 if(account.auth==='password'){
  const password=readSecret(account,'password',{env});
  await page.goto(origin+'/signin',{waitUntil:'load'});await page.waitForSelector('body[data-ready="1"]',{timeout:30000});
  await page.fill('#f-login',account.login);await page.fill('#f-password',password);
  await Promise.all([page.waitForURL(u=>!u.pathname.startsWith('/signin'),{timeout:30000}),page.click('#signin-form button[type=submit]')]);
 }else if(account.auth==='dev'){
  await page.goto(origin+'/',{waitUntil:'load'});
  const r=await page.evaluate(async a=>{const r=await fetch('/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({subject:a.subject,name:a.name??a.subject})});return {status:r.status,body:await r.text()};},account);
  if(r.status!==200)throw Error(`dev sign-in failed: ${r.status} ${r.body.slice(0,200)}`);
  // A dev account has no website username, so site/js/shell.mjs sends every page of it to /welcome?mode=username
  // (central/accounts.mjs needsUsername) — racing, and on the VM usually beating, the /servers/{id}?join=1 auto-join.
  // Give the test account one, as a finished real account has. Its requested name first (the username also becomes
  // the display name, so in-game names stay as asked), else a short one derived from the subject.
  const u=await page.evaluate(async names=>{
   const me=await fetch('/me',{headers:{accept:'application/json'}}).then(r=>r.ok?r.json():null);
   if(!me?.needsUsername)return {ok:true};
   let last=null;
   for(const username of names){
    const r=await fetch('/account/username',{method:'POST',headers:{'content-type':'application/json',accept:'application/json','x-csrf-token':me.csrf},body:JSON.stringify({username})});
    if(r.ok)return {ok:true};
    last={status:r.status,reason:(await r.json().catch(()=>({}))).error??null};
    if(last.reason==='username-set')return {ok:true};
    if(!['username-taken','reserved-username','invalid-username'].includes(last.reason))break;
   }
   return {ok:false,...last};
  },usernameCandidates(account));
  if(!u.ok)throw Error(`dev sign-in: could not give the account a website username: ${u.status} ${u.reason}`);
 }else throw Error('unknown auth '+account.auth);
 const me=await page.evaluate(async()=>{const r=await fetch('/me',{headers:{accept:'application/json'}});return r.ok?r.json():null;});
 if(!me?.player)throw Error('signed in but GET /me failed');
 return {player:me.player,name:me.name};
}

// Website API call from a signed-in page (same origin as central): session cookie plus the CSRF token from GET /me,
// exactly as site/js/api.mjs sends it. Returns {status, ok, body}.
export const siteApi=(page,method,path,data)=>page.evaluate(async({method,path,data})=>{
 const me=method==='GET'?null:await fetch('/me',{headers:{accept:'application/json'}}).then(r=>r.ok?r.json():null).catch(()=>null);
 const headers={accept:'application/json'};if(data!==undefined)headers['content-type']='application/json';if(me?.csrf)headers['x-csrf-token']=me.csrf;
 const r=await fetch(path,{method,headers,body:data!==undefined?JSON.stringify(data):undefined,credentials:'same-origin'});
 return {status:r.status,ok:r.ok,body:await r.json().catch(()=>null)};
},{method,path,data});

// The website join: /servers/{id}?join=1 asks central for a one-use ticket, stores it in sessionStorage and goes to the
// configured play page. If the site has no play page configured, the harness opens gameUrl itself (same origin).
export async function joinViaWebsite(session,{origin,serverId,gameUrl=null,loadMs=600000}){
 const {page,frames}=session,t0=Date.now();
 await page.goto(`${origin}/servers/${encodeURIComponent(serverId)}?join=1`,{waitUntil:'load'});
 const toPlay=await page.waitForURL(u=>u.pathname==='/play'||(gameUrl&&u.href.startsWith(gameUrl)),{timeout:20000}).then(()=>true,()=>false);
 if(!toPlay){
  const has=await page.evaluate(()=>Boolean(sessionStorage.getItem('rlb-join'))).catch(()=>false);
  if(!has){const text=await page.evaluate(()=>document.querySelector('#toasts,.toast,[role=status]')?.textContent??document.title).catch(()=>'');throw Error('website join did not produce a ticket: '+String(text).trim().slice(0,200));}
  await page.goto(gameUrl??origin+'/play',{waitUntil:'load'});
 }
 const ticketMs=Date.now()-t0,joinT=Date.now();
 // Only this join's frames: the page opens its socket during the navigation above, so from t0 (a lookback into an earlier
 // session picked up its spawn, e.g. a camp respawn just before a rejoin).
 const approved=await frames.waitFor(t0,f=>f.dir==='rx'&&(f.type==='approved'||f.type==='denied'),Math.min(loadMs,120000));
 if(!approved)throw Error('no gateway approval within 120 s (socket '+(session.sockets.length?'opened':'never opened')+')');
 if(approved.type==='denied')throw Error('gateway denied the join: '+approved.reason);
 const spawned=await frames.waitFor(approved.t,f=>f.dir==='rx'&&f.type==='create'&&f.mine&&f.prefab===':player_soldier',loadMs);
 if(!spawned)throw Error('approved, but the server never created our character');
 await page.waitForFunction(()=>window.explorerState?.online?.state==='in-game'&&window.explorerState.walk&&(!window.rlbFrontEnd||(window.rlbFrontEnd.state().inGame&&!window.rlbFrontEnd.state().loading)),{},{timeout:loadMs,polling:500});
 return {ticketMs,approvedMs:approved.t-joinT,spawnMs:spawned.t-joinT,inGameMs:Date.now()-joinT,approved,spawned};
}

export const state=page=>page.evaluate(()=>{const s=window.explorerState;return s&&{online:s.online,feet:s.player.feet,grounded:s.player.grounded,crouched:s.player.crouched,vitals:s.vitals,frames:s.frames};});
export const feet=async page=>(await page.evaluate(()=>window.explorerState?.player.feet))??null;
export const toUnity=([x,y,z])=>[x,y,-z];
export const distXZ=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);

// Pointer Lock (stand-in) like the player's first click into the game; game keys need it.
export async function lockPointer(page){
 if(await page.evaluate(()=>Boolean(document.pointerLockElement)))return true;
 const box=await page.locator('#world').boundingBox();if(!box)return false;
 await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
 return page.waitForFunction(()=>Boolean(document.pointerLockElement),{},{timeout:5000}).then(()=>true,()=>false);
}
export async function hold(page,keys,ms){for(const k of keys)await page.keyboard.down(k);await sleep(ms);for(const k of [...keys].reverse())await page.keyboard.up(k);}

// F1 console: open, type like a player (trusted Enter submit), close. Returns the time the command was submitted.
// F1 toggles (ConsoleWindow.Update), so it is pressed only when the window is not already open. Open/closed is read from
// the window's hidden flag: the section only holds absolutely placed dfGUI layers, so Playwright's visible check (a
// non-empty box) is not a reliable signal (2026-10-29 VM: "Timeout 5000ms" with the console drawn open).
const consoleShown=page=>page.evaluate(()=>{const c=document.querySelector('#game-console');return Boolean(c&&!c.hidden);});
export async function f1(page,command){
 if(!await consoleShown(page))await page.keyboard.press('F1');
 await page.waitForFunction(()=>{const c=document.querySelector('#game-console');return Boolean(c&&!c.hidden);},{},{timeout:5000});
 await page.locator('#console-input').fill(command);const at=Date.now();await page.locator('#console-input').press('Enter');
 await sleep(100);if(await consoleShown(page))await page.keyboard.press('F1');
 await page.waitForFunction(()=>document.querySelector('#game-console')?.hidden!==false,{},{timeout:5000}).catch(()=>{});
 return at;
}
// Runs a forwarded command and waits for a CL_ConsoleMessage matching `match` (any reply when omitted).
export async function consoleCommand(session,command,{match=null,ms=8000}={}){
 const t=Date.now()-1;await f1(session.page,command);
 const reply=await session.frames.waitFor(t,f=>consoleMessage(f)&&(!match||match.test(f.values[0])),ms);
 return {reply,text:reply?.values[0]??null,rttMs:reply?reply.t-t:null};
}
// HUD chat: Return opens ChatUI, typed text, Return sends chat.say (ChatUI.SendChat).
export async function say(page,text){
 await page.keyboard.press('Enter');await page.waitForFunction(()=>window.explorerDev?.chat?.()?.open,{},{timeout:5000});
 await sleep(120);await page.keyboard.type(text);const at=Date.now();await page.keyboard.press('Enter');
 await page.waitForFunction(()=>!window.explorerDev.chat().open,{},{timeout:5000}).catch(()=>{});
 return at;
}
// Inventory cells as the RPOS UI shows them (built only from the server's GNUP calls online).
export const inventoryCells=page=>page.evaluate(()=>{const seen=new Map();for(const b of document.querySelectorAll('#pack [data-slot], #inventory-belt [data-slot], #belt [data-slot], #equipment [data-slot]')){const slot=Number(b.dataset.slot),img=b.querySelector(':scope > img');if(!img||seen.has(slot))continue;seen.set(slot,{slot,name:img.getAttribute('alt'),count:Number((b.querySelector('.rpos-count')?.textContent??'x1').replace(/\D/g,''))||1});}return [...seen.values()].sort((a,b)=>a.slot-b.slot);});
export const countOf=(cells,re)=>cells.filter(c=>re.test(c.name)).reduce((a,c)=>a+c.count,0);
export async function openInventory(page){await page.keyboard.press('Tab');return page.waitForSelector('#inventory[open]',{timeout:5000}).then(()=>true,()=>false);}
// The free cursor is parked on the view's centre first: headless Edge sends locked-pointer clicks to whatever is under
// the last mouse position (a real browser sends them to the locked canvas), so a cursor left on a belt cell after a drag
// turned every later Fire click into a click on that cell's image (30 Oct: no placement, bow or gun shot was sent).
export async function closeInventory(page){if(await page.evaluate(()=>document.querySelector('#inventory')?.open)){
  const box=await page.locator('#world').boundingBox();if(box)await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.keyboard.press('Tab');await page.waitForFunction(()=>!document.querySelector('#inventory')?.open,{},{timeout:5000}).catch(()=>{});}}
export async function dragCell(page,from,to){
 const a=await page.locator(from).boundingBox(),b=await page.locator(to).boundingBox();if(!a||!b)throw Error(`cell not visible: ${!a?from:to}`);
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(a.x+a.width/2+8,a.y+a.height/2,{steps:2});
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:10});await page.mouse.up();
}
// The belt element itself moves into the inventory dialog while it is open (inventory-ui.mjs paint()).
export const cellSelector=slot=>slot>=36?`#equipment [data-slot="${slot}"]`:slot>=30?`#belt [data-slot="${slot}"]`:`#pack [data-slot="${slot}"]`;
export const lootSelector=slot=>`#loot [data-loot="${slot}"]`;
// Loot window cells (an open container's GNUP, as the RPOS loot window shows them).
export const lootCells=page=>page.evaluate(()=>[...document.querySelectorAll('#loot [data-loot]')].map(b=>{const img=b.querySelector(':scope > img');return img&&{slot:Number(b.dataset.loot),name:img.getAttribute('alt'),count:Number((b.querySelector('.rpos-count')?.textContent??'x1').replace(/\D/g,''))||1};}).filter(Boolean));
export const lootOpen=page=>page.evaluate(()=>Boolean(document.querySelector('#inventory')?.open&&!document.querySelector('#loot-panel')?.hidden));

// ---- gameplay helpers (tools/native/gameplay.mjs) ------------------------------------------------------------------
export const sleepMs=sleep;
// Mouse-look stand-in: turns the camera to a browser-space point (explorerDev.aimPoint only rotates the view).
export const aimAt=(page,p)=>page.evaluate(q=>window.explorerDev.aimPoint(q),p);
export async function click(page,ms=80){await page.mouse.down();await sleep(ms);await page.mouse.up();}
// Walks like a player towards a browser-space point: face it, hold W (Shift when far) in short bursts, re-aim each step.
// Stuck (three bursts gaining < 0.25 m): a jump and a sidestep. A server correction (TruthDetector rolled the move back:
// something the server has is on this line) is never walked into again straight away: truthYield steps aside, and stands
// still while the estimated violation is high (truth-guard.mjs). Returns {distance, arrived, steps, stuck, truth}.
export async function walkTo(page,target,{within=1.5,ms=60000,sprintBeyond=8,face=null,guard=null}={}){
 const end=Date.now()+ms;let d=Infinity,stalled=0,stuck=0,steps=0,side=1;
 const truth=guard??newTruthGuard(page),ts={corrections:0,pausedS:0,side:1};
 await lockPointer(page);
 while(Date.now()<end){
  if(await truthYield(page,truth,ts)){stalled=0;d=Infinity;continue;}
  const at=await feet(page);if(!at)break;const prev=d;d=distXZ(at,target);if(d<=within)break;
  stalled=prev-d<0.25?stalled+1:0;
  await aimAt(page,[target[0],at[1]+1.5,target[2]]);
  if(stalled>=3){stuck++;stalled=0;side=-side;await page.keyboard.down('Space');await sleep(120);await page.keyboard.up('Space');await hold(page,[side>0?'KeyD':'KeyA','KeyW'],700);continue;}
  await hold(page,d>sprintBeyond?['ShiftLeft','KeyW']:['KeyW'],Math.max(120,Math.min(900,(d-within*0.6)*(d>sprintBeyond?160:240))));steps++;
 }
 const at=await feet(page);d=at?distXZ(at,target):Infinity;
 if(face)await aimAt(page,face);
 return {distance:+d.toFixed(2),arrived:d<=within,steps,stuck,...(ts.corrections?{truth:{corrections:ts.corrections,pausedS:Math.round(ts.pausedS),estimate:Math.round(truth.estimate(Date.now()/1000))}}:{})};
}
// A TruthGuard that only counts corrections from now on.
export function newTruthGuard(page){const g=new TruthGuard();g.seen=truthCorrectionCount(page);return g;}
// After new server corrections of our character: let the teleport back land, step aside (strafe, no jump), and stand
// still (moves keep being accepted, one violation less each) while the estimate is above the guard's pause line.
export async function truthYield(page,guard,state){
 const fresh=guard.update(truthCorrectionCount(page),Date.now()/1000);if(!fresh)return false;
 state.corrections+=fresh;state.side=-state.side;
 for(const k of ['KeyW','ShiftLeft','KeyA','KeyD','KeyS','Space'])await page.keyboard.up(k).catch(()=>{});
 await sleep(400);await hold(page,[state.side>0?'KeyD':'KeyA'],700);
 const now=Date.now()/1000;if(guard.mustPause(now)){const s=guard.pauseSeconds(now);state.pausedS+=s;await sleep(s*1000);}
 guard.update(truthCorrectionCount(page),Date.now()/1000);
 return true;
}
// E like a player: a quick tap uses the target (Context:B), holding E opens the server's menu and `option` clicks one
// entry of it (Context:C). The view must already point at the entity. Returns the menu shown (option texts) or null.
export async function useKey(page,{option=null,ms=6000}={}){
 await lockPointer(page);
 if(option==null){await page.keyboard.down('KeyE');await sleep(60);await page.keyboard.up('KeyE');return null;}
 await page.keyboard.down('KeyE');
 try{
  const shown=await page.waitForSelector('#context-ui:not([hidden]) .ctx-button',{timeout:ms}).then(()=>true,()=>false);
  const menu=shown?await page.evaluate(()=>[...document.querySelectorAll('#context-ui .ctx-button')].map(b=>b.dataset.option)):[];
  if(shown&&menu.includes(option)){await page.locator(`#context-ui .ctx-button[data-option="${option}"]`).click();await sleep(300);}
  return menu;
 }finally{await page.keyboard.up('KeyE');}
}
// The browser's network between the page and the gateway, shaped in the page (harness only, like the Pointer Lock
// stand-in): every frame on a /play socket is delayed by delayMs + random jitter in order (TCP keeps order, so loss on
// the path shows up as delay), `hold` stalls both directions until released, drop() closes the socket like a lost
// connection. Inactive (no timers at all) until a row sets a delay or a hold.
export function netShaper(){
 const Native=window.WebSocket,shape={delayMs:0,jitterMs:0,hold:false,sockets:new Set(),sent:0,received:0,
  drop(){for(const s of this.sockets)try{s.__drop();}catch{}},release(){this.hold=false;for(const s of this.sockets)s.__flush();}};
 Object.defineProperty(window,'__rlbNetShape',{value:shape});
 const pass=new WeakSet();
 class Shaped extends Native{
  constructor(url,protocols){super(url,protocols);let play=false;try{play=/\/play$/.test(new URL(url,location.href).pathname);}catch{}this.__play=play;this.__q=[];this.__last=0;
   if(!play)return;shape.sockets.add(this);this.addEventListener('close',()=>shape.sockets.delete(this));
   this.addEventListener('message',e=>{if(pass.has(e))return;if(!shape.hold&&!shape.delayMs&&!shape.jitterMs&&!this.__q.length)return;e.stopImmediatePropagation();
    this.__enqueue(()=>{const copy=new MessageEvent('message',{data:e.data});pass.add(copy);shape.received++;this.dispatchEvent(copy);});});}
  __enqueue(fn){const at=Math.max(this.__last,performance.now()+shape.delayMs+Math.random()*shape.jitterMs);this.__last=at;this.__q.push({at,fn});this.__pump();}
  __pump(){clearTimeout(this.__t);if(shape.hold||!this.__q.length)return;const wait=this.__q[0].at-performance.now();if(wait>0){this.__t=setTimeout(()=>this.__pump(),wait);return;}while(this.__q.length&&this.__q[0].at<=performance.now())this.__q.shift().fn();this.__pump();}
  __flush(){this.__last=Math.max(this.__last,performance.now());this.__pump();}
  __drop(){this.__q.length=0;clearTimeout(this.__t);super.close(4000,'network drop');}
  send(data){if(!this.__play||(!shape.hold&&!shape.delayMs&&!shape.jitterMs&&!this.__q.length))return super.send(data);this.__enqueue(()=>{if(this.readyState===1){shape.sent++;super.send(data);}});}
 }
 window.WebSocket=Shaped;
}
export const shapeNet=(page,o)=>page.evaluate(o=>{const s=window.__rlbNetShape;if(!s)return false;if(o.release){s.release();return true;}if(o.drop){s.drop();return true;}Object.assign(s,o);return true;},o);
// Back to plain play after a row: no inventory, console or chat left open, pointer locked again.
export async function settle(page){
 for(const k of ['KeyW','KeyS','ShiftLeft','ControlLeft','Space'])await page.keyboard.up(k).catch(()=>{});
 await closeInventory(page).catch(()=>{});
 if(await page.evaluate(()=>!document.querySelector('#game-console')?.hidden).catch(()=>false))await page.keyboard.press('F1').catch(()=>{});
 if(await page.evaluate(()=>window.explorerDev?.chat?.()?.open).catch(()=>false))await page.keyboard.press('Escape').catch(()=>{});
 await lockPointer(page).catch(()=>{});
}
// The page's JS heap (Chromium performance.memory) and DOM node count via CDP.
export async function pageMemory(session){
 try{
  session.cdp??=await session.context.newCDPSession(session.page);if(!session.cdpEnabled){await session.cdp.send('Performance.enable');session.cdpEnabled=true;}
  const {metrics}=await session.cdp.send('Performance.getMetrics'),m=Object.fromEntries(metrics.map(x=>[x.name,x.value]));
  return {jsHeapUsedMB:+(m.JSHeapUsedSize/1048576).toFixed(1),jsHeapTotalMB:+(m.JSHeapTotalSize/1048576).toFixed(1),nodes:m.Nodes,listeners:m.JSEventListeners};
 }catch{return await session.page.evaluate(()=>performance.memory?{jsHeapUsedMB:+(performance.memory.usedJSHeapSize/1048576).toFixed(1)}:null).catch(()=>null);}
}
