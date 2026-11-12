// Headless check of the whole website (no GPU needed): the player journey at 1440×900 and 390×844, the forum, the owner tools and
// admin console, then every page again from a copy of site/ without generated/ (pending states, no server errors).
// The real site/generated is never moved, so other work using it (captures, a running preview) is not disturbed.
// Every page: no horizontal scroll, no console errors, no requests off this origin. Screenshots: analysis/site-qa/.
// BROWSER_PATH overrides the default Edge path. Uses the dev sign-in and a mock Steam provider only.
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import {mkdir,rename,access,cp,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {openCentralDb} from '../central/db.mjs';
import {createCentralService,createDevLoginVerifier} from '../central/service.mjs';
import {createSiteHandler} from '../central/site.mjs';
import {createSigningKey} from '../bridge/admission.mjs';
import {createRemoteAccount,enrolGateway} from '../bridge/remote-account.mjs';
import {createGameHandler} from './serve.mjs';

const OUT=new URL('../analysis/site-qa/',import.meta.url),GENERATED=new URL('../site/generated',import.meta.url),ASIDE=new URL('../site/generated.qa-aside',import.meta.url);
const VIEWPORTS=[[1440,900],[390,844]],PASSWORD='a long passphrase';
const exists=u=>access(u).then(()=>true,()=>false);
// Windows may hold a just-written folder briefly (indexing, antivirus): retry the move instead of stranding it.
async function move(from,to){for(let i=0;;i++){try{return await rename(from,to);}catch(e){if(i>=20||!['EPERM','EBUSY','EACCES'].includes(e.code))throw e;await new Promise(r=>setTimeout(r,500));}}}

// Central + site on a random port; Steam is a mock that sends the browser straight back to our own callback.
async function stack(siteRoot){
 const http=createServer();await listenServer(http);
 const base=`http://127.0.0.1:${http.address().port}`;let steamN=0;
 const steam={authorizeUrl:({state})=>`${base}/auth/steam/callback?state=${state}`,complete:async()=>({issuer:'steam',subject:'7656119000000'+String(++steamN).padStart(4,'0'),name:'Steamer'})};
 const db=openCentralDb();
 // Mail goes nowhere: the outbox records it for the opening-day email and unsubscribe checks.
 const outbox=[],mailer={enabled:true,from:'Rust Legacy <hello@rustlegacy.test>',async send(m){outbox.push(m);}};
 const site=createSiteHandler({providers:['steam','discord'],devLogin:true,...(siteRoot?{root:siteRoot}:{})});
 const api=createCentralService({db,keys:[createSigningKey('k1')],issuer:base,verifyLogin:createDevLoginVerifier(),providers:{steam,discord:{authorizeUrl:()=>base+'/'}},publicUrl:base+'/',allowedOrigins:[base],secureCookies:false,mailer,mailPauseMs:0,onNotFound:(q,r)=>site(q,r,{fallback:true})});
 // Routed like tools/central.mjs with serveGame: the game's own files (e.g. /key-bindings.mjs for the guide) share the origin.
 const game=createGameHandler();
 http.on('request',(q,r)=>{if(site(q,r))return;if((q.method==='GET'||q.method==='HEAD')&&/\.[a-z0-9]+$/i.test(new URL(q.url,base).pathname))return game(q,r);api.handle(q,r);});
 return {base,db,outbox,close:()=>{http.closeAllConnections();return new Promise(r=>http.close(r));}};
}

// Accessibility basics on every visited page (GAP-AUDIT "Release readiness 2026-10-23"): a language and a title, every
// visible form control labelled, every visible link/button named, every image with an alt (empty for decoration), no
// duplicate ids.
function a11yBasics(){
 const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden';};
 const named=e=>Boolean((e.getAttribute('aria-label')||(e.getAttribute('aria-labelledby')&&document.getElementById(e.getAttribute('aria-labelledby'))?.textContent)||e.textContent||e.title||e.querySelector('img[alt]:not([alt=""])')?.alt||'').trim());
 const tag=e=>e.outerHTML.slice(0,80);const out=[];
 if(!document.documentElement.lang)out.push('no <html lang>');if(!document.title.trim())out.push('no <title>');
 for(const e of document.querySelectorAll('input:not([type=hidden]),select,textarea'))if(shown(e)&&!(e.labels?.length||e.getAttribute('aria-label')||e.getAttribute('aria-labelledby')||e.title))out.push('unlabelled '+tag(e));
 for(const e of document.querySelectorAll('a[href],button'))if(shown(e)&&!named(e))out.push('nameless '+tag(e));
 for(const e of document.querySelectorAll('img:not([alt])'))out.push('no alt '+tag(e));
 const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);for(const id of new Set(ids.filter((x,i)=>ids.indexOf(x)!==i)))out.push('duplicate id '+id);
 return out;
}

// A page with error, request and server-error tracking; visit() waits for data-ready, checks width, screenshots.
async function open(browser,{base,width,height,allow404=false}){
 const context=await browser.newContext({viewport:{width,height}});
 await context.addInitScript(()=>{window.__plays=[];const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){window.__plays.push(navigator.userActivation?.hasBeenActive??null);return play.call(this);};});
 const page=await context.newPage(),errors=[],external=[],failures=[],missing=[],a11y=[];
 page.on('pageerror',e=>errors.push(e.message));
 // Chromium logs every non-2xx fetch as a console error. 401/403/404/409 are ordinary answers anywhere; any other status
 // passes only for a request a step makes on purpose to be refused (expectRefusal), matched by status and path.
 const refusals=[];
 page.on('console',m=>{if(m.type()!=='error')return;const t=m.text();if(/status of (401|403|404|409)\b/.test(t))return;
  const st=/status of (\d{3})\b/.exec(t),at=m.location()?.url;if(st&&at&&refusals.some(([s,re])=>s===Number(st[1])&&re.test(new URL(at).pathname)))return;errors.push(at?`${t} (${at})`:t);});
 page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('data:'))external.push(r.url());});
 // 404s are checked by URL: only the optional classic map, the 404 page itself and (without site/generated) generated files.
 page.on('response',r=>{const u=new URL(r.url());if(r.status()>=500)failures.push(`${r.status()} ${u.pathname}`);
  if(r.status()===404&&u.pathname!=='/site/generated/map/classic.json'&&u.pathname!=='/nowhere'&&!(allow404&&u.pathname.startsWith('/site/generated/')))missing.push(u.pathname);});
 const ready=()=>page.waitForSelector('body[data-ready="1"]',{timeout:20000}).catch(e=>{throw new Error(`${page.url()} @${width}: never ready (${errors.join(' | ')||'no console errors'})`);});
 async function visit(path,name,{status,full=true}={}){
  const res=await page.goto(base+path);if(status)assert.equal(res.status(),status,path);await ready();await page.waitForTimeout(250);
  a11y.push(...(await page.evaluate(a11yBasics)).map(x=>`${path}: ${x}`));
  await shot(name,full);
 }
 // full=false for very long pages (the roadmap): the first screen only.
 async function shot(name,full=true){
  const sw=await page.evaluate(()=>document.documentElement.scrollWidth);assert.ok(sw<=width,`${name} @${width}: horizontal scroll (${sw}px)`);
  await page.screenshot({path:fileURLToPath(new URL(`${name}-${width}.png`,OUT)),fullPage:full});
 }
 const check=label=>{assert.deepEqual(errors,[],`${label} @${width}: console errors`);assert.deepEqual(external,[],`${label} @${width}: external requests`);assert.deepEqual(failures,[],`${label} @${width}: server errors`);assert.deepEqual(missing,[],`${label} @${width}: unexpected 404s`);assert.deepEqual([...new Set(a11y)],[],`${label} @${width}: accessibility basics`);};
 const expectRefusal=(status,pathRe)=>refusals.push([status,pathRe]);
 return {page,context,ready,visit,shot,check,expectRefusal};
}
const signOut=page=>page.evaluate(()=>document.querySelector('[data-action=sign-out]').click());

async function journey(browser,s,[width,height],shared){
 const {page,context,ready,visit,shot,check,expectRefusal}=await open(browser,{base:s.base,width,height});
 const user=`Rook${width}`;
 try{
  // Title screen: no music before a gesture; ↓ moves the selection and Enter opens it.
  await visit('/','home');
  assert.deepEqual(await page.evaluate(()=>window.__plays.filter(a=>!a)),[],'audio started before a gesture');
  const items=await page.locator('.ts-menu a').evaluateAll(a=>a.map(x=>x.getAttribute('href')));
  const at=async()=>page.locator('.ts-menu a').evaluateAll(a=>a.findIndex(x=>x.hasAttribute('data-selected')));
  const from=await at();await page.keyboard.press('ArrowDown');const to=await at();assert.equal(to,(from+1)%items.length);
  await page.keyboard.press('Enter');await page.waitForURL(u=>new URL(u).pathname===items[to]);await ready();

  // Register → servers, sign out, sign-in errors, sign in.
  await visit('/register','register');
  await page.fill('#f-email',`${user.toLowerCase()}@example.com`);await page.fill('#f-username',user);await page.fill('#f-password',PASSWORD);
  await page.click('#register-form button[type=submit]');await page.waitForURL(/\/servers\?welcome=1$|\/servers$/);await ready();
  await signOut(page);await page.waitForURL(s.base+'/');await ready();
  await visit('/signin','signin');
  await page.click('#signin-form button[type=submit]');await page.waitForSelector('#signin-form .error-summary');
  await page.fill('#f-login',user);await page.fill('#f-password','wrong password');await page.click('#signin-form button[type=submit]');
  await page.waitForFunction(()=>/incorrect/.test(document.querySelector('#signin-form').textContent));await shot('signin-error');
  await page.fill('#f-password',PASSWORD);await page.click('#signin-form button[type=submit]');await page.waitForURL(u=>!u.pathname.startsWith('/signin'));await ready();
  await signOut(page);await page.waitForURL(s.base+'/');await ready();

  // Steam sign-up: the mock provider returns a new Steam account, which picks a username on /welcome.
  await page.goto(s.base+'/auth/steam/start');await page.waitForURL(/\/welcome/);await ready();await shot('welcome');
  await page.fill('#f-username',`Steam${width}`);await page.click('#welcome-form button[type=submit]');await page.waitForURL(/\/servers/);await ready();
  await signOut(page);await page.waitForURL(s.base+'/');await ready();

  // Launch sign-up page (the one advertised before opening day): an email, then the offer to make an account.
  await visit('/launch','launch');
  await page.fill('#notify-email',`${user.toLowerCase()}@example.com`);await page.click('#notify-form button[type=submit]');
  await page.waitForSelector('#account-step:not([hidden])');await shot('launch-done');
  // The homepage has the same progress figure as the roadmap and the same opening-day sign-up.
  await visit('/','home-notify');assert.match(await page.getAttribute('#hp-bar','aria-valuenow'),/^\d+$/);
  await page.fill('#hn-email',`${user.toLowerCase()}.home@example.com`);await page.click('#hn-form button[type=submit]');
  await page.waitForSelector('#hn-done:not([hidden])');assert.equal(await page.getAttribute('#hn-create','href'),'/register');

  if(width===1440){
   // Owner tools: register a server, enrol the gateway with the shown code, heartbeat, publish.
   await page.goto(s.base+'/signin');await ready();await page.fill('#f-login',user);await page.fill('#f-password',PASSWORD);
   await page.click('#signin-form button[type=submit]');await page.waitForURL(u=>!u.pathname.startsWith('/signin'));await ready();
   await visit('/owner','owner-empty');
   await page.fill('#srv-name','Pilot EU');await page.fill('#srv-region','EU');await page.fill('#srv-endpoint','wss://pilot.example/play');
   await page.click('#register button[type=submit]');await page.waitForSelector('#enrolment:not([hidden])');
   const code=/enrol gateway\.json (\S+)/.exec(await page.textContent('#enrol-command'))[1];
   const remote=createRemoteAccount({baseUrl:s.base,credential:(await enrolGateway({baseUrl:s.base,code})).credential});
   await remote.heartbeat({players:3,capacity:50,wipe:'2026-10'});
   await page.reload();await ready();await page.click('#owned button:has-text("Publish")');
   await page.waitForFunction(()=>/Listed\s*Yes/.test(document.querySelector('#owned').textContent));await shot('owner');
   shared.remote=remote;shared.owner=user;

   // Servers: filters, detail, join ticket (genuine, redeemable once), desktop-character link failure path.
   await visit('/servers','servers');
   assert.match(await page.textContent('#list'),/Pilot EU/);
   await page.fill('#q','zzz');await page.waitForFunction(()=>!document.querySelector('#state').hidden);await shot('servers-empty');
   await page.fill('#q','');await page.waitForSelector('#list li[data-id]');
   await page.click('#list li[data-id] .join');await page.waitForFunction(()=>sessionStorage.getItem('rlb-join'));
   const join=JSON.parse(await page.evaluate(()=>sessionStorage.getItem('rlb-join')));
   assert.equal(join.endpoint,'wss://pilot.example/play');assert.equal(join.ticket.split('.').length,3);
   assert.ok(await remote.redeemAdmission(join.ticket,{serverId:join.server}));
   await page.click('#detail button:has-text("Link desktop character")');await page.fill('#link-code','ABCDEFGHJK');await page.click('#detail .link-form button[type=submit]');
   let task;for(let i=0;i<50&&!task;i++){[task]=await remote.tasks();if(!task)await new Promise(r=>setTimeout(r,100));}
   assert.equal(task.code,'ABCDEFGHJK');await remote.linkReserved(task.request,{ok:false,reason:'unknown-code'});
   await page.waitForFunction(()=>/not recognised|expired/.test(document.querySelector('#detail').textContent),null,{timeout:20000});
   await visit(`/servers/${join.server}`,'server');

   // Admin console from the owner page: flagged player, evidence plot, kick, ban, audit, unban.
   const cheater=await (await fetch(s.base+'/auth/login',{method:'POST',headers:{origin:s.base,'content-type':'application/json'},body:JSON.stringify({subject:'cheater',name:'Cheater'})})).json();
   const rosterRow={subject:cheater.player,name:'Cheater',playerId:2,score:62,flags:{teleport:1,speed:2},connectedAt:Date.now()-60000};
   const replay=Array.from({length:20},(_,i)=>({t:i/10,kind:'move',pos:[i<19?i*0.8:300,10,0]}));
   await remote.report({players:[rosterRow],flags:[{subject:cheater.player,kind:'teleport',severity:40,score:62,at:Date.now(),detail:{distance:285.6,budget:10},replay}]});
   await page.goto(s.base+'/owner');await ready();await page.click('#owned a:has-text("Admin")');await ready();await page.waitForSelector('#players tbody tr.review');
   assert.match(await page.textContent('#players tbody'),/Cheater[\s\S]*62[\s\S]*teleport ×1, speed ×2/);
   await page.click('#players button:has-text("Evidence")');await page.waitForSelector('#evidence:not([hidden]) svg.plot');
   assert.equal(await page.evaluate(()=>document.querySelector('svg.plot polyline').getAttribute('points').split(' ').length),20);
   assert.match(await page.textContent('#flags'),/teleport[\s\S]*"distance": 285.6/);await shot('admin-evidence');
   await page.click('#players button:has-text("Kick")');await page.fill('#action-form input[name=reason]','teleport evidence');await page.click('#action-form button:has-text("Confirm")');
   await page.waitForFunction(()=>/Kick queued/.test(document.querySelector('#notice').textContent));
   assert.deepEqual((await remote.report({players:[rosterRow],flags:[]})).kicks,[{subject:cheater.player,reason:'kicked'}]);
   await page.click('#players button:has-text("Ban")');await page.selectOption('#action-form select[name=minutes]','');
   await page.fill('#action-form input[name=reason]','teleport, reviewed');await page.click('#action-form button:has-text("Confirm")');await page.waitForSelector('#bans tbody tr');
   assert.match(await page.textContent('#bans tbody'),/Cheater[\s\S]*server[\s\S]*teleport, reviewed[\s\S]*never[\s\S]*active/);
   assert.match(await page.textContent('#audit tbody'),/admin\.ban[\s\S]*admin\.kick/);
   assert.deepEqual((await remote.report({players:[rosterRow],flags:[]})).kicks,[{subject:cheater.player,reason:'banned'}]);
   await shot('admin');
   await page.click('#bans button:has-text("Unban")');await page.waitForFunction(()=>/lifted/.test(document.querySelector('#notice').textContent));
   assert.match(await page.textContent('#bans tbody'),/lifted/);
   // In-game action through the server plugin, and the join policy (ban-evasion settings).
   await page.click('#players button:has-text("Go to")');await page.waitForSelector('#action-form .in-game-only:not([hidden])');
   assert.ok(await page.isHidden('#action-form .reason-field'));
   await page.click('#action-form button:has-text("Confirm")');await page.waitForFunction(()=>/Sent to the game server/.test(document.querySelector('#notice').textContent));
   await page.waitForSelector('#commands tbody tr');assert.match(await page.textContent('#commands tbody'),/teleport to[\s\S]*Cheater[\s\S]*queued/);
   assert.deepEqual((await remote.report({players:[rosterRow],flags:[]})).commands.map(c=>[c.action,c.subject]),[['teleport-to',cheater.player]]);
   await page.fill('#policy-form input[name=hours]','2');await page.check('#policy-form input[name=steam]');await page.click('#policy-form button');
   await page.waitForFunction(()=>/Join policy saved/.test(document.querySelector('#notice').textContent));
   assert.match(await page.textContent('#audit tbody'),/admin\.policy[\s\S]*admin\.command/);await shot('admin-actions');
   // Desktop players (from the server plugin, as opaque handles): kick through the game server.
   await remote.report({players:[rosterRow],flags:[],desktop:[{handle:'DeskHandle000001',name:'Desk Player',score:40,flags:{teleport:1}}],
    events:[{type:'desktop-flag',handle:'DeskHandle000001',name:'Desk Player',kind:'teleport',severity:40,score:40,at:Date.now(),detail:{distance:390},replay:[{t:0,kind:'move',pos:[2010,30,2000]},{t:2,kind:'move',pos:[2400,30,2000]}]}]});
   await page.reload();await ready();await page.waitForSelector('#desktop tbody tr');
   assert.match(await page.textContent('#desktop tbody'),/Desk Player[\s\S]*not linked[\s\S]*40[\s\S]*teleport ×1/);
   await page.click('#desktop button:has-text("Evidence")');await page.waitForFunction(()=>/Desk Player: 1 most recent/.test(document.querySelector('#evidence-who').textContent));
   assert.match(await page.textContent('#flags'),/teleport[\s\S]*"distance": 390/);
   await page.click('#desktop button:has-text("Kick")');await page.waitForSelector('#action-form .desktop-only:not([hidden])');
   assert.ok(await page.isHidden('#action-form select[name=scope]'));
   await page.fill('#action-form input[name=reason]','wallhack report');await page.click('#action-form button:has-text("Confirm")');
   await page.waitForFunction(()=>/Sent to the game server for Desk Player/.test(document.querySelector('#notice').textContent));
   assert.match(await page.textContent('#commands tbody'),/kick \(game server\)[\s\S]*Desk Player \(desktop\)/);
   assert.deepEqual((await remote.report({players:[rosterRow],flags:[]})).commands.map(c=>[c.action,c.handle]),[['kick-native','DeskHandle000001']]);
   await shot('admin-desktop');
   // IP bans (central/ip-bans.mjs): the gateway's own (local) address is refused; a public one is banned and lifted.
   // The refusal is central's 400 unbannable-ip (the only 400 the journey expects), shown as the page's notice.
   const banPath=/^\/admin\/servers\/[^/]+\/ip-bans$/;expectRefusal(400,banPath);
   const refused=page.waitForResponse(r=>r.request().method()==='POST'&&banPath.test(new URL(r.url()).pathname));
   await page.fill('#ip-ban-form input[name=ip]','127.0.0.1');await page.fill('#ip-ban-form input[name=reason]','test');await page.click('#ip-ban-form button');
   {const r=await refused;assert.equal(r.status(),400,'local IP ban refused');assert.equal((await r.json()).error,'unbannable-ip');}
   await page.waitForFunction(()=>/can't be banned/.test(document.querySelector('#notice').textContent));
   await page.fill('#ip-ban-form input[name=ip]','203.0.113.0/24');await page.click('#ip-ban-form button');await page.waitForSelector('#ip-bans tbody tr');
   assert.match(await page.textContent('#ip-bans tbody'),/203\.0\.113\.0\/24[\s\S]*server[\s\S]*test[\s\S]*active/);
   assert.match(await page.textContent('#audit tbody'),/admin\.ip-ban/);await shot('admin-ip-bans');
   await page.click('#ip-bans button:has-text("Lift")');await page.waitForFunction(()=>/IP ban on 203\.0\.113\.0\/24 lifted/.test(document.querySelector('#notice').textContent));
   await visit('/account','account');
   // Changing the email asks for the current password (resets go to that address).
   await page.click('#email-edit');await page.fill('#f-email',`${user.toLowerCase()}.new@example.com`);await page.fill('#f-email-current','wrong password');
   await page.click('#email-form button[type=submit]');await page.waitForFunction(()=>/incorrect/.test(document.querySelector('#email-form').textContent));
   await page.fill('#f-email-current',PASSWORD);await page.click('#email-form button[type=submit]');
   await page.waitForFunction(e=>document.querySelector('#acc-email').textContent===e,`${user.toLowerCase()}.new@example.com`);
   // Platform staff see the launch sign-ups (this account is made staff for the check).
   s.db.addStaff(await page.evaluate(async()=>(await (await fetch('/me')).json()).player),Date.now());
   await page.reload();await ready();assert.ok(await page.isVisible('#staff-links'));
   await visit('/signups','signups');assert.match(await page.textContent('#su-rows'),new RegExp(`${user.toLowerCase()}@example\\.com`));
   // Opening-day email: a test to the staff member, then the mailing to the list, each with its own unsubscribe link.
   const mailed=s.outbox.length;await page.fill('#su-subject','The servers are open');await page.fill('#su-text','Join now from the server list.');
   await page.click('#su-test');await page.waitForFunction(n=>document.querySelector('#su-mail-err').hidden,mailed);
   const test=s.outbox.at(-1);assert.equal(test.subject,'[Test] The servers are open');assert.equal(test.to,`${user.toLowerCase()}.new@example.com`);
   page.once('dialog',d=>d.accept());await page.click('#su-send');
   await page.waitForFunction(()=>/Done/.test(document.querySelector('#su-mailings')?.textContent??''));await shot('signups-mail');
   const letters=s.outbox.slice(mailed+1).filter(m=>m.subject==='The servers are open');assert.ok(letters.length>=2,'mailing sent to the list');
   const link=/Unsubscribe: (\S+)/.exec(letters.find(m=>m.to===`${user.toLowerCase()}@example.com`).text)[1];
   await page.goto(link);await ready();await page.click('#un-go');await page.waitForSelector('#un-done:not([hidden])');await shot('unsubscribe');
   await visit('/signups','signups-after');assert.doesNotMatch(await page.textContent('#su-rows'),new RegExp(`^${user.toLowerCase()}@example\\.com`,'m'));
   await signOut(page);await page.waitForURL(s.base+'/');await ready();
   await visit('/signups','signups-gate');assert.ok(await page.isVisible('#su-gate'));
  }else{
   await visit('/servers','servers');assert.match(await page.textContent('#list'),/Pilot EU/);
  }

  // The island: switch layers, search a place, open its card.
  await visit('/island','island');
  // The classic community map, placed by its own X/Z grid (site/content/classic-map.json).
  await page.click('#layer-ctl [data-layer=classic]');await page.waitForSelector('.map-stack img.classic');assert.match(await page.textContent('.map-stack .credit'),/community map/i);
  await page.click('#layer-ctl [data-layer=aerial]');assert.equal(await page.getAttribute('#layer-ctl [data-layer=aerial]','aria-pressed'),'true');
  await page.fill('#place-q','bunker');await page.click('#place-list button >> nth=0');await page.waitForSelector('#place-card:not([hidden])');
  assert.match(await page.textContent('#place-card'),/Bunker/i);await shot('island-place');
  // Crate spots and zones: click a crate marker, then read the height under the cursor with elevation on.
  assert.equal(await page.locator('.map-vector .crates rect').count(),80);
  await page.waitForTimeout(800);await page.locator('#map').scrollIntoViewIfNeeded();await page.waitForTimeout(300); // phones: the place click scrolls smoothly
  const crate=await page.evaluate(()=>{const m=document.querySelector('#map').getBoundingClientRect();for(const r of document.querySelectorAll('.map-vector .crates rect')){const b=r.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;
   if(x>m.left+40&&x<m.right-40&&y>m.top+40&&y<m.bottom-60&&!document.elementsFromPoint(x,y).some(e=>e.closest?.('.place')))return [x,y];}return null;});
  assert.ok(crate,'a crate marker is on screen');
  // Hovering names what is under the mouse.
  await page.mouse.move(crate[0],crate[1]);await page.waitForSelector('.map-tip:not([hidden])');assert.match(await page.textContent('.map-tip b'),/Loot crate/);
  await page.mouse.click(crate[0],crate[1]);
  await page.waitForFunction(()=>/Crate spawn[\s\S]*Respawn10–20 min/.test(document.querySelector('#place-card').textContent));await shot('island-crate');
  await page.check('[data-overlay=elevation]');assert.ok(await page.locator('.map-vector .contours path').count()>10);
  await page.mouse.move(crate[0]+30,crate[1]+30);await page.waitForFunction(()=>/ m$|sea$/.test(document.querySelector('.map-hud .readout').textContent));

  // Server console and staff panel, signed out at this point of the journey: both show their sign-in gate.
  await visit('/console','console');assert.ok(await page.isVisible('#con-gate'),'console: sign-in gate');
  await visit('/staff','staff-gate');assert.ok(await page.isVisible('#st-gate'),'staff panel: gate');

  // Wiki: "/" search to an item page with its recipe.
  await visit('/wiki','wiki');
  await page.keyboard.press('/');await page.keyboard.type('hatchet');await page.waitForSelector('#wiki-results li[role=option]');await page.keyboard.press('Enter');
  await page.waitForURL(/\/wiki\/items\/hatchet$/);await ready();assert.ok(await page.locator('.wiki-sec .ings .chip-item').count()>0);await shot('wiki-item');
  for(const [path,name] of [['/wiki/items','wiki-items'],['/wiki/raiding','wiki-raiding'],['/updates','updates'],['/guide','guide'],['/privacy','privacy'],['/terms','terms'],['/cookies','cookies'],['/contact','contact'],['/list-your-server','list-server'],['/docs','docs'],['/docs/manage-from-the-website','doc']])await visit(path,name);
  // The calculator, reached from the Wiki tab's dropdown on desktop: big totals fit their tiles.
  if(width>1180){
   await page.hover('.tabs [data-tab=wiki]');await page.waitForSelector('.tab-menu a[href="/wiki/calculator"]',{state:'visible'});await shot('wiki-menu',false);
   await page.click('.tab-menu a[href="/wiki/calculator"]');await page.waitForURL(/\/wiki\/calculator$/);await ready();
  }else await visit('/wiki/calculator','calculator');
  await page.click('.calc-item[data-slug=explosive-charge]');await page.fill('.calc-rows input','99');await page.press('.calc-rows input','Enter');
  await page.waitForFunction(()=>document.querySelector('.calc-for')?.textContent.includes('99 ×'));await page.waitForTimeout(500);
  assert.deepEqual(await page.$$eval('.calc-tile',ts=>ts.filter(t=>t.querySelector('b').getBoundingClientRect().right>t.getBoundingClientRect().right-4).length),0,'calculator totals fit their tiles');
  await shot('calculator');
  // In-game pictures on the mutant and airdrop pages (site/generated/media/guides from tools/capture-guide-images.mjs).
  for(const [path,name,n] of [['/wiki/resources/mutant-loot-sack','wiki-mutant-sack',2],['/wiki/animals/mutant-wolf','wiki-mutant-wolf',2],['/wiki/resources/supply-crate','wiki-supply-crate',3]]){
   await visit(path,name);await page.waitForFunction(k=>[...document.querySelectorAll('.detail-pics img')].filter(i=>i.complete&&i.naturalWidth>0).length===k,n,{timeout:10000});}
  // Roadmap: the dated entries from the first build, the Roadmap tab current, What's coming at the end.
  await visit('/roadmap','roadmap',{full:false});
  assert.ok(await page.locator('.rm-entry').count()>=20,'roadmap entries');assert.match(await page.textContent('.rm-entry time'),/16 Oct 2026/);
  assert.ok(await page.isVisible('#coming h2'),"What's coming");
  // Progress from the public journal (the committed snapshot here), with the GitHub and Discord links.
  assert.match(await page.getAttribute('#rm-bar','aria-valuenow'),/^\d+$/);assert.ok(await page.locator('#rm-areas li').count()>=5,'progress areas');
  assert.equal(await page.getAttribute('.rm-link-gh','href'),'https://github.com/OWNER/rust-legacy-browser');
  assert.equal(await page.getAttribute('.rm-link-dc','href'),'https://discord.gg/your-invite');
  // Search: a word narrows the entries and says how many of the total match; clearing it brings them all back.
  const total=await page.locator('.rm-entry').count();
  await page.fill('#rm-q','mutant');await page.waitForFunction(()=>/ of /.test(document.querySelector('#rm-search-count').textContent));
  const shown=await page.locator('.rm-entry:not([hidden])').count();assert.ok(shown>0&&shown<total,`roadmap search: ${shown} of ${total}`);
  await page.fill('#rm-q','');await page.waitForFunction(()=>!document.querySelector('#rm-search-count').textContent);
  assert.equal(await page.locator('.rm-entry:not([hidden])').count(),total,'roadmap search cleared');
  if(width>1180)assert.equal(await page.getAttribute('.tabs [data-tab=roadmap]','aria-current'),'page');
  await visit('/nowhere','404',{status:404});
  check('journey');
 }finally{await context.close();}
}

// The forum: categories signed out, then a staff account (exempt from the posting wait) starts a thread, replies,
// pins it, and sees the posting-bans panel.
async function forum(browser,s,[width,height]){
 const {page,context,ready,visit,shot,check}=await open(browser,{base:s.base,width,height});
 try{
  await visit('/forum','forum');assert.equal(await page.locator('.fm-cat').count(),6);
  const me=await page.evaluate(async name=>(await (await fetch('/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({subject:name,name})})).json()).player,`Scribe${width}`);
  s.db.addStaff(me,Date.now());
  await visit('/forum/general','forum-category');
  await page.click('#fm-new-btn');await page.fill('#fm-title',`Wipe day ${width}`);await page.fill('#fm-body','Who is **in**?\n\n- bring a hatchet\n- [[item:Hatchet]]');
  await page.click('#fm-new .fm-submit');await page.waitForURL(/\/forum\/t\/\d+$/);await ready();
  assert.match(await page.textContent('.fm-post-b'),/Who is in\?/);
  await page.fill('#fm-reply textarea','See you there.');await page.click('#fm-reply .fm-submit');
  await page.waitForFunction(()=>document.querySelectorAll('.fm-post').length===2);
  await page.click('.fm-tools button:has-text("Pin")');await page.waitForSelector('.fm-tools button:has-text("Unpin")');await shot('forum-thread');
  await visit('/forum','forum-staff');assert.ok(await page.isVisible('#fm-mod'));
  if(width>1180)assert.equal(await page.getAttribute('.tabs [data-tab=forum]','aria-current'),'page');
  // Leaderboard: the anti-cheat reports above give playtime only, so Hunters shows the empty state. Its boards and the
  // hide toggle on the account page.
  await visit('/leaderboard','leaderboard');assert.equal(await page.locator('.lb-board').count(),7);
  await page.click('.lb-board:has-text("Hunters")');await page.waitForURL(/board=animals/);await page.waitForSelector('.pending');
  await visit('/account','account-leaderboard');await page.click('#board-toggle');await page.waitForFunction(()=>document.querySelector('#acc-board-state').textContent==='Hidden');
  check('forum');
 }finally{await context.close();}
}

// The widths between phone and desktop, where the top bar changes layout: no horizontal scroll, header on one line.
async function sweep(browser,s){
 for(const width of [600,768,900,1024,1181,1200,1301,1361,1440,1601]){
  const {page,context,visit,check}=await open(browser,{base:s.base,width,height:800});
  try{
   for(const [path,name] of [['/','sweep-home'],['/servers','sweep-servers'],['/wiki','sweep-wiki'],['/forum','sweep-forum'],['/leaderboard','sweep-leaderboard'],['/roadmap','sweep-roadmap']])await visit(path,name,{full:path!=='/roadmap'});
   // A label has wrapped when its text lays out on more than one line.
   const tall=await page.evaluate(()=>[...document.querySelectorAll('.bar a,.bar button')].filter(e=>{if(!e.offsetParent)return false;
    const w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT),tops=new Set();for(let t;(t=w.nextNode());){if(!t.textContent.trim())continue;const r=document.createRange();r.selectNodeContents(t);for(const b of r.getClientRects())if(b.width>0)tops.add(Math.round(b.top/4));}
    return tops.size>1;}).map(e=>e.textContent.trim()));
   assert.deepEqual(tall,[],`@${width}: header items wrapped`);
   check('sweep');
  }finally{await context.close();}
 }
}

// Without site/generated: pages still load and show their pending states, never a server error.
async function pendingPass(browser,s,[width,height]){
 const {page,context,visit,check}=await open(browser,{base:s.base,width,height,allow404:true});
 try{
  for(const [path,name,pending] of [['/','home'],['/servers','servers'],['/island','island','.pending'],['/wiki','wiki','.pending'],['/wiki/items/hatchet','wiki-item','.pending'],['/updates','updates','.pending'],['/guide','guide'],['/forum','forum'],['/leaderboard','leaderboard'],['/docs','docs','.pending']]){
   await visit(path,name+'-pending');if(pending)assert.ok(await page.locator(pending).first().isVisible(),`${path}: pending state shown`);
  }
  // The roadmap's text is not generated: without its pictures and clips the entries still show.
  await visit('/roadmap','roadmap-pending',{full:false});assert.ok(await page.locator('.rm-entry').count()>=20,'roadmap entries without media');
  check('pending');
 }finally{await context.close();}
}

await mkdir(OUT,{recursive:true});
let browser,bareDir=null;
try{
 browser=await chromium.launch({executablePath:process.env.BROWSER_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--mute-audio']});
 // Older versions of this check moved the folder aside; put back one left by a run that was killed mid-way.
 if(!(await exists(GENERATED))&&await exists(ASIDE)){await move(ASIDE,GENERATED);console.error('restored site/generated from an interrupted run');}
 assert.ok(await exists(GENERATED),'site/generated is missing: run npm run build:site first');
 const s=await stack(),shared={};
 // Headers and crawler files as served (tests/site-release.test.mjs covers them in detail).
 {const home=await fetch(s.base+'/',{headers:{accept:'text/html'}});assert.equal(home.headers.get('x-frame-options'),'DENY');assert.match(home.headers.get('permissions-policy')??'',/camera=\(\)/);
  assert.match(await (await fetch(s.base+'/robots.txt')).text(),/Disallow: \/admin/);
  const lost=await fetch(s.base+'/nowhere',{headers:{accept:'text/html'}});assert.equal(lost.status,404);assert.match(await lost.text(),/<meta name="robots" content="noindex">/);}
 try{for(const vp of VIEWPORTS){await journey(browser,s,vp,shared);await forum(browser,s,vp);}await sweep(browser,s);}finally{await s.close();}
 const SITE=fileURLToPath(new URL('../site/',import.meta.url));bareDir=await mkdtemp(path.join(tmpdir(),'rlb-site-bare-'));
 await cp(SITE,bareDir,{recursive:true,filter:src=>path.relative(SITE,src).split(path.sep)[0]!=='generated'});
 const bare=await stack(pathToFileURL(bareDir+path.sep));
 try{for(const vp of VIEWPORTS)await pendingPass(browser,bare,vp);}finally{await bare.close();}
 console.log(JSON.stringify({ok:true,viewports:VIEWPORTS.map(v=>v.join('x')),screenshots:fileURLToPath(OUT)}));
}finally{
 if(bareDir)await rm(bareDir,{recursive:true,force:true});
 await browser?.close();
}
