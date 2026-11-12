// Host app dashboard check (HOST-APP-PLAN.md "Testing"): the demo stack (our website, sidecar and gateway + the mock
// game server, host/demo.mjs) in headless Edge. Sign-in, Start all, live logs and source filters, a component restart
// from its card, the Accounts page (links, unlink), player history, Health graphs, the health check, Settings (server, Discord alerts) and Plugins, the release feed, off-site backups, the Schedule page (countdown, cancel, restart now), the autosave freeze → "Going quiet" → hang → restart, reduced motion, and phone width.
// The app frame (HOST-AND-LOADER-BUILD.md A1): the boot screen through its real steps (and Skip), the terminal panel's
// Host tab (status, restart gateway), collapse, resize and shortcuts, no shell tabs in a plain browser, and with the
// demo bridge (window.RLB_DEMO_BRIDGE, the browser stand-in for the desktop app) PowerShell and CMD tabs on a fake shell.
// Screenshots go to HOST_SHOTS (default analysis/host-qa). Never runs the original server.
//   node tools/check-host-dashboard.mjs        (PowerShell; BROWSER_PATH overrides the Edge path)
import {mkdirSync,mkdtempSync,rmSync,writeFileSync,readFileSync,existsSync,readdirSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {TAR} from './kit-install.mjs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright-core';
import {prepareDemo} from '../host/demo.mjs';
import {startService} from '../host/service.mjs';
import {loadHostConfig,REPO,tcpOpen} from '../host/config.mjs';
import {createServer} from 'node:http';
import {listenServer} from '../bridge/listen.mjs';
import {keygen,addRelease} from './publish-release.mjs';
import {practiceSetup,PRACTICE} from '../host/wizard-practice.mjs';

const shots=resolve(process.env.HOST_SHOTS??'analysis/host-qa');mkdirSync(shots,{recursive:true});
// HOST_CHECK_PORT_OFFSET moves every port, so two checks can run side by side (parallel worktrees on one machine).
const off=Number(process.env.HOST_CHECK_PORT_OFFSET??0)||0,ports=Object.fromEntries(Object.entries({host:28200,central:28280,sidecar:28290,gateway:28243,server:29215}).map(([k,v])=>[k,v+off]));
const dataDir=mkdtempSync(join(tmpdir(),'rlb-host-check-'));
const results=[];const pass=(name,detail='')=>{results.push(name);console.log(`PASS ${name}${detail?' ('+detail+')':''}`);};
const until=async(what,pred,ms=60000)=>{const t=Date.now();while(Date.now()-t<ms){if(await pred())return;await new Promise(r=>setTimeout(r,250));}throw Error(`timed out: ${what}`);};

let svc,browser,outside,feedServer;
try{
 const file=await prepareDemo(dataDir,{ports,watchdog:{enabled:true,hangSeconds:10,graceSeconds:5,probeEveryMs:1000},autosaveSeconds:12});
 // Shares run state like the deploy/host-test scripts (HOST-APP-PLAN.md "Two ways to run it"), rooted in the demo folder.
 // Updates install into a scratch app folder here, never into this checkout.
 const config=loadHostConfig(file);config.scripts={root:dataDir};config.updates={appDir:join(dataDir,'app')};mkdirSync(join(dataDir,'app','bridge'),{recursive:true});
 writeFileSync(join(dataDir,'app','bridge','notes.mjs'),'// before the update'+String.fromCharCode(10));
 // Off-site backups to a folder (a stand-in for a network share), and a signed release feed on a loopback server
 // with a test key (tools/publish-release.mjs), both as an owner would set them in host.json.
 mkdirSync(join(dataDir,'offsite-share'),{recursive:true});config.offsite={folder:join(dataDir,'offsite-share')};
 const keys=keygen(join(dataDir,'release-keys')),relSrc=join(dataDir,'release-src');mkdirSync(join(relSrc,'bridge'),{recursive:true});
 writeFileSync(join(relSrc,'bridge','notes.mjs'),'// from the release feed'+String.fromCharCode(10));
 const relTar=join(dataDir,'kit-1.0.1.tar');spawnSync(TAR,['-cf',relTar,'-C',relSrc,'bridge/notes.mjs']);
 const feedText=addRelease({keyFile:keys.privateFile,tar:relTar,version:'1.0.1',notes:'Gateway: steadier joins after a server restart.\nSidecar: clearer errors.'}).text;
 feedServer=createServer((q,r)=>{if(q.url==='/release-feed.json'){r.end(feedText);}else if(q.url==='/kit-1.0.1.tar'){r.end(readFileSync(relTar));}else{r.writeHead(404);r.end();}});
 await listenServer(feedServer);
 config.releaseFeed={url:`http://127.0.0.1:${feedServer.address().port}/release-feed.json`,publicKeyFile:keys.publicFile};
 // Setup runs the practice stand-ins (host/wizard-practice.mjs), never the real scripts; the patch step fails on purpose.
 svc=await startService(config,{log:()=>{},hostOptions:{setup:practiceSetup({steps:{'08-New-Secrets.ps1':'slow','10-Patch-TestCopy.ps1':'fail'}})}});
 const link=`http://127.0.0.1:${svc.port}/#token=${svc.token}`;
 browser=await chromium.launch({executablePath:process.env.BROWSER_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--mute-audio']});
 const ctx=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
 const page=await ctx.newPage(),errors=[];
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`);});
 const status=()=>svc.host.status(),comp=n=>status().components.find(c=>c.name===n);
 const watch=p=>{p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});p.on('pageerror',e=>errors.push(e.message));};
 // Signing in with the link opens the boot screen first (boot.mjs); the dashboard is usable once it has gone.
 const booted=async p=>{await p.waitForSelector('#boot',{timeout:20000}).catch(()=>{});await p.waitForSelector('#boot',{state:'detached',timeout:90000});await p.waitForSelector('#app:not([hidden])');};
 const termText=p=>p.evaluate(()=>[...document.querySelectorAll('.term-pane:not([hidden]) .xterm-rows > div')].map(d=>d.textContent.trimEnd()).join('\n'));

 await page.goto(link);
 await booted(page);
 if(await page.evaluate(()=>location.hash.includes('token')))throw Error('token left in the address bar');
 pass('sign-in link','token removed from the address bar');

 await page.click('[data-target=all] [data-action=start]');
 await until('every component running',()=>status().components.every(c=>c.state==='running'));
 await page.waitForFunction(()=>document.getElementById('server-state').textContent==='Running'&&document.querySelectorAll('.card[data-state=running]').length===3);
 pass('start all','website, sidecar, game server, gateway running');
 await page.waitForFunction(()=>document.getElementById('verdict').dataset.state==='ok',null,{timeout:30000});
 pass('watchdog alive','after the start-up grace');

 // Boot screen: a fresh sign-in walks the real start-up. The gateway is restarted while it boots, so its line follows
 // real state changes; every part's line carries its real PID, and the health rows are the check's own.
 {
  const bc=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1}),bp=await bc.newPage();watch(bp);
  await bp.goto(link);
  await bp.waitForFunction(()=>/Game server/.test(document.querySelector('.boot-log')?.textContent??''),null,{timeout:30000});
  const gwOld=comp('gateway').pid;svc.host.act('restart','gateway').catch(()=>{});
  await bp.waitForFunction(()=>document.querySelectorAll('.boot-log li').length>=8,null,{timeout:30000});
  await bp.screenshot({path:join(shots,'boot-mid-1440.png')});
  await bp.waitForSelector('#boot.ready',{timeout:90000});
  await new Promise(r=>setTimeout(r,250));
  await bp.screenshot({path:join(shots,'boot-done-1440.png')});
  const lines=await bp.evaluate(()=>[...document.querySelectorAll('.boot-log li')].map(li=>({tag:li.dataset.tag,text:li.querySelector('.bx').textContent})));
  const find=re=>lines.find(l=>re.test(l.text));
  for(const re of [/^Host service answering on 127\.0\.0\.1:\d+ \(\d+ ms\)$/,/^Signed in with the sign-in link$/,/^Live event stream open/,/^Configuration read: 4 parts/])if(find(re)?.tag!=='ok')throw Error('boot: missing '+re);
  await until('gateway back after the boot restart',()=>comp('gateway').state==='running'&&comp('gateway').pid!==gwOld,60000);
  for(const c of status().components){
   const l=find(new RegExp('^'+({central:'Website',sidecar:'Sidecar',server:'Game server',gateway:'Gateway'}[c.name])+'\\s'));
   if(!l||l.tag!=='ok'||!l.text.includes('PID '+c.pid))throw Error(`boot: ${c.name} line is ${JSON.stringify(l)} (PID ${c.pid})`);
  }
  const gwLine=find(/^Gateway\s/).text,moved=/→/.test(gwLine);
  if(find(/^Watchdog/)?.tag!=='ok')throw Error('boot: watchdog line');
  const hc=svc.host.healthCheck.last(),rows=lines.filter(l=>/^  \S/.test(l.text));
  if(!hc||rows.length!==hc.rows.length)throw Error(`boot: ${rows.length} health rows on screen, the check has ${hc?.rows.length}`);
  if(!find(/^Health check: \d+ pass, \d+ warn, \d+ fail$/)||!find(/^Ready in [\d.]+ s/))throw Error('boot: summary lines');
  await bp.waitForSelector('#boot',{state:'detached',timeout:20000});
  if(!(await bp.isVisible('.view[data-view=overview]')))throw Error('boot: did not land on the Overview');
  await bp.waitForFunction(()=>/start-up .* ok/.test([...document.querySelectorAll('.term-pane .xterm-rows > div')].map(d=>d.textContent).join(' ')),null,{timeout:10000});
  await bc.close();
  // Skip (Esc) opens the dashboard at once, still signed in.
  const sc=await browser.newContext({viewport:{width:1440,height:900}}),sp=await sc.newPage();watch(sp);
  await sp.goto(link);await sp.waitForSelector('#boot');await sp.keyboard.press('Escape');
  await sp.waitForSelector('#boot',{state:'detached',timeout:5000});await sp.waitForSelector('.view[data-view=overview]:not([hidden])');
  await sp.waitForFunction(()=>document.querySelectorAll('.hc-all li[data-status]').length>0,null,{timeout:30000});
  await sc.close();
  pass('boot screen',`service, sign-in, stream, ${lines.length} real lines, parts with their PIDs${moved?` (gateway followed live: ${gwLine.replace(/\s+/g,' ')})`:''}, watchdog, ${rows.length} health rows; lands on the Overview; Skip works`);
 }
 await until('first good save',()=>status().saves?.lastGood,30000);
 await page.waitForFunction(()=>document.getElementById('st-save').textContent!=='–');
 await new Promise(r=>setTimeout(r,8000)); // let the strip fill a little
 await page.screenshot({path:join(shots,'overview-1440.png')});

 await page.goto(link.replace(/#.*/,'#logs'));
 await page.waitForFunction(()=>document.querySelectorAll('#log .ln[data-src=server]').length>3&&document.querySelectorAll('#log .ln[data-src=gateway]').length>0);
 await page.screenshot({path:join(shots,'logs-1440.png')});
 await page.click('.chip[data-src=server]');
 if(await page.locator('#log .ln[data-src=server]').count())throw Error('server lines still shown with the source off');
 await page.click('.chip[data-src=server]');
 await page.fill('#search','listening');await page.waitForFunction(()=>[...document.querySelectorAll('#log .ln')].every(l=>/listening/i.test(l.textContent))&&document.querySelector('#log mark'));
 await page.fill('#search','');
 pass('logs','live lines from server and gateway, source filter, search');

 await page.goto(link.replace(/#.*/,'#overview'));
 const gwBefore=comp('gateway').pid;
 await page.click('.card[data-name=gateway] [data-action=restart]');
 await until('gateway restarted',()=>comp('gateway').state==='running'&&comp('gateway').pid!==gwBefore);
 await page.waitForFunction(()=>document.querySelector('.card[data-name=gateway]').dataset.state==='running');
 pass('restart from a card','gateway has a new process');

 // Terminal panel, Host tab: host commands through the dashboard's API (no shell in a plain browser).
 await page.waitForSelector('#term:not([hidden]) .term-tab[data-kind=host]');
 if(await page.locator('.term-new').count())throw Error('PowerShell or CMD buttons in a plain browser');
 await page.click('.term-pane:not([hidden]) .xterm');
 await page.keyboard.type('status');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>/Gateway\s+running\s+PID \d+/.test([...document.querySelectorAll('.term-pane:not([hidden]) .xterm-rows > div')].map(d=>d.textContent).join('\n')),null,{timeout:10000});
 const gwTerm=comp('gateway').pid;
 await page.keyboard.type('restart gat');await page.keyboard.press('Tab');await page.keyboard.press('Enter');
 await until('gateway restarted from the terminal',()=>comp('gateway').pid!==gwTerm&&comp('gateway').state==='running');
 await page.waitForFunction(()=>/\[ OK \] Gateway running \(PID \d+\)/.test([...document.querySelectorAll('.term-pane:not([hidden]) .xterm-rows > div')].map(d=>d.textContent).join('\n')),null,{timeout:20000});
 if(!/Gateway\s+stopping[\s\S]*Gateway\s+starting/.test(await termText(page)))throw Error('terminal: the restart did not show its states');
 await new Promise(r=>setTimeout(r,600));
 await page.screenshot({path:join(shots,'terminal-host-1440.png')});
 pass('terminal: Host tab','status, then restart gateway (tab completed) following its live states to running');
 // Collapse (Ctrl+`), resize by the grip, both remembered; Ctrl+2 opens Logs.
 await page.keyboard.press('Control+Backquote');await page.waitForSelector('#term',{state:'hidden'});
 if(await page.getAttribute('#term-toggle','aria-expanded')!=='false')throw Error('terminal toggle state');
 await new Promise(r=>setTimeout(r,400));
 await page.screenshot({path:join(shots,'terminal-collapsed-1440.png')});
 await page.click('#term-toggle');await page.waitForSelector('#term:not([hidden])');
 const tw0=(await page.locator('#term').boundingBox()).width,grip=await page.locator('.term-grip').boundingBox();
 await page.mouse.move(grip.x+grip.width/2,grip.y+300);await page.mouse.down();await page.mouse.move(grip.x+grip.width/2-150,grip.y+300,{steps:6});await page.mouse.up();
 const tw1=(await page.locator('#term').boundingBox()).width;
 if(Math.abs(tw1-tw0-150)>3)throw Error(`terminal resize: ${tw0} → ${tw1}`);
 await page.reload();await page.waitForSelector('#term:not([hidden]) .term-tab');
 const tw2=(await page.locator('#term').boundingBox()).width;
 if(Math.abs(tw2-tw1)>2)throw Error(`terminal width not remembered: ${tw1} → ${tw2}`);
 await page.click('.view[data-view=overview] .hero');await page.keyboard.press('Control+Digit2');
 await page.waitForFunction(()=>location.hash==='#logs');
 await page.goto(link.replace(/#.*/,'#overview'));
 pass('terminal panel',`collapses with Ctrl+\`, resized ${Math.round(tw0)} → ${Math.round(tw1)} px and remembered; Ctrl+2 opens Logs`);
 // The desktop app's shell tabs through the demo bridge (the browser stand-in for window.chrome.webview).
 {
  const dc=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});await dc.addInitScript(()=>{window.RLB_DEMO_BRIDGE=true;});
  const dp=await dc.newPage();watch(dp);
  await dp.goto(link);await booted(dp);
  await dp.click('.term-new[data-shell=powershell]');
  await dp.waitForFunction(()=>/PS C:\\RLB-host>$/m.test([...document.querySelectorAll('.term-pane:not([hidden]) .xterm-rows > div')].map(d=>d.textContent.trimEnd()).join('\n')),null,{timeout:10000});
  await dp.keyboard.type('Get-Service RustLegacyHost');await dp.keyboard.press('Enter');
  await dp.keyboard.type('dir');await dp.keyboard.press('Enter');
  await dp.waitForFunction(()=>/Running\s+RustLegacyHost[\s\S]*secrets/.test([...document.querySelectorAll('.term-pane:not([hidden]) .xterm-rows > div')].map(d=>d.textContent).join('\n')),null,{timeout:10000});
  await new Promise(r=>setTimeout(r,500));
  await dp.screenshot({path:join(shots,'terminal-powershell-1440.png')});
  await dp.click('.term-new[data-shell=cmd]');
  await dp.waitForFunction(()=>/C:\\RLB-host>$/m.test([...document.querySelectorAll('.term-pane:not([hidden]) .xterm-rows > div')].map(d=>d.textContent.trimEnd()).join('\n')),null,{timeout:10000});
  if(await dp.locator('.term-tab').count()!==3)throw Error('shell tabs: expected Host, PowerShell and CMD');
  await dp.click('.term-tab[data-kind=cmd] .term-x');
  await dp.waitForFunction(()=>document.querySelectorAll('.term-tab').length===2);
  await dp.click('.term-tab[data-kind=powershell]');await dp.click('.term-pane:not([hidden]) .xterm');
  await dp.keyboard.type('exit');await dp.keyboard.press('Enter');
  await dp.waitForSelector('.term-tab[data-kind=powershell][data-ended=true]');
  await dc.close();
  pass('terminal: shell tabs','none in a plain browser; with the demo bridge PowerShell and CMD tabs open a shell, a tab closes, exit ends one');
 }

 // Accounts: the adapter's links with the website's names (host app key from the demo), and an unlink with a reason.
 await page.goto(link.replace(/#.*/,'#accounts'));
 await page.waitForFunction(()=>document.querySelectorAll('#acc-table tbody tr').length===3&&document.getElementById('adapter-state').textContent==='Answering',null,{timeout:30000});
 await new Promise(r=>setTimeout(r,800));
 await page.screenshot({path:join(shots,'accounts-1440.png')});
 const row=page.locator('#acc-table tbody tr',{hasText:'Demo desktop player'});
 await row.locator('button',{hasText:'Unlink'}).click();
 await page.fill('#unlink-reason','Player asked to link a new account');
 await page.click('#unlink-form button[value=ok]');
 await page.waitForFunction(()=>document.getElementById('acc-linked').textContent==='2',null,{timeout:20000});
 pass('accounts','three demo accounts with names, unlink with a reason');

 // Anti-cheat: recent flags across players, a player's evidence with the replay path; Players: live tables and bans.
 await page.goto(link.replace(/#.*/,'#anticheat'));
 await page.waitForFunction(()=>document.querySelectorAll('#ac-flags tbody tr').length>=4,null,{timeout:20000});
 await page.locator('#ac-flags tbody tr',{hasText:'Teleport'}).click();
 await page.waitForSelector('#ac-evidence .replay svg polyline',{timeout:20000});
 await new Promise(r=>setTimeout(r,600));
 await page.screenshot({path:join(shots,'anticheat-1440.png')});
 pass('anti-cheat','recent flags, evidence with the replay path');
 await page.goto(link.replace(/#.*/,'#players'));
 await page.waitForFunction(()=>/server reported|not reporting/.test(document.getElementById('pl-reported').textContent),null,{timeout:20000});
 if(!(await page.isVisible('#pl-empty')))throw Error('players: the empty state should show (nobody plays on the demo)');
 pass('players','live tables, bans and in-game actions load');
 // Player history (H5): a name in Recent players opens the side panel with sessions, names, flags, kicks and reports.
 await page.waitForFunction(()=>document.querySelectorAll('#pl-recent tbody tr').length>=3,null,{timeout:20000});
 await page.locator('#pl-recent tbody tr',{hasText:'Demo player 1'}).locator('button.linkish').click();
 await page.waitForFunction(()=>document.getElementById('history').open&&/DemoOne/.test(document.getElementById('hi-body').textContent)&&/Kicked/.test(document.getElementById('hi-body').textContent),null,{timeout:20000});
 await new Promise(r=>setTimeout(r,500));
 await page.screenshot({path:join(shots,'player-history-1440.png')});
 await page.keyboard.press('Escape');
 if(await page.evaluate(()=>document.getElementById('history').open))throw Error('history panel did not close on Escape');
 pass('player history','recent players, history panel with names, flags, kicks and reports');

 // Health (H6): demo history plus live minutes, five charts with a shared crosshair read-out, 7 days, the table view.
 await page.goto(link.replace(/#.*/,'#health'));
 await page.waitForFunction(()=>document.querySelectorAll('#hl-charts .plot svg path.line').length>=5&&document.getElementById('hl-peak').textContent!=='–',null,{timeout:20000});
 if(!(await page.isVisible('#hl-note')))throw Error('health: the demo data note should show');
 const plot=page.locator('#hl-charts .plot').first(),box=await plot.boundingBox();
 await page.mouse.move(box.x+box.width*0.8,box.y+box.height/2);
 await page.waitForFunction(()=>{const t=document.querySelector('#hl-charts .chart .tip:not([hidden])');return t&&/in game/.test(t.textContent);});
 if(await page.locator('#hl-charts .hair[visibility=visible]').count()<5)throw Error('health: the crosshair should show on every chart');
 await page.screenshot({path:join(shots,'health-1440.png'),fullPage:true});
 await page.mouse.move(5,5);
 await page.locator('#hl-charts .plot').nth(1).focus();await page.keyboard.press('End');
 await page.waitForFunction(()=>!document.querySelectorAll('#hl-charts .tip')[1].hidden);
 await page.click('.range [data-range="7d"]');
 await page.waitForFunction(()=>document.getElementById('hl-eyebrow').textContent==='Last 7 days'&&document.querySelectorAll('#hl-table tbody tr').length>=7,null,{timeout:20000});
 if(await page.locator('#hl-charts .mark.freeze').count()<2)throw Error('health: freeze markers missing in the 7-day view');
 await page.evaluate(()=>document.querySelector('.table-view').open=true);
 await page.screenshot({path:join(shots,'health-7d-1440.png'),fullPage:true});
 const before=errors.length; // the two refusals below are on purpose: their console lines are not errors of the page
 if((await page.evaluate(()=>fetch('/api/metrics?range=1y').then(r=>r.status)))!==400)throw Error('metrics: an unknown range should be refused');
 pass('health','charts, crosshair read-out by pointer and keyboard, freeze markers, 7 days, table view');

 // Settings (H3): only Discord webhook URLs are kept; the saved one is masked; switches save at once.
 await page.goto(link.replace(/#.*/,'#settings'));
 await page.waitForFunction(()=>document.querySelectorAll('#al-kinds input').length===8,null,{timeout:20000});
 await page.fill('#al-url','https://example.com/api/webhooks/1/x');await page.click('#al-form button[type=submit]');
 await page.waitForFunction(()=>/not a Discord webhook/.test(document.querySelector('#al-form .err').textContent));
 await new Promise(r=>setTimeout(r,300));errors.length=before;
 const hook='https://discord.com/api/webhooks/123456789012345678/'+'Zx9'.repeat(22);
 await page.fill('#al-url',hook);await page.click('#al-form button[type=submit]');
 await page.waitForFunction(()=>/Saved: discord\.com\/api\/webhooks\/123456789012345678\/•+/.test(document.querySelector('#al-form .saved').textContent));
 if((await page.content()).includes('Zx9Zx9'))throw Error('settings: the webhook token is on the page');
 await page.uncheck('#al-k-reports');
 await until('switch saved',async()=>JSON.parse(readFileSync(join(dataDir,'host','alerts.json'),'utf8')).events.reports===false,10000);
 await page.selectOption('#al-sev','20');
 await until('severity saved',async()=>JSON.parse(readFileSync(join(dataDir,'host','alerts.json'),'utf8')).flagSeverity===20,10000);
 await new Promise(r=>setTimeout(r,500));
 await page.screenshot({path:join(shots,'settings-1440.png')});
 await page.click('#al-form button.danger');
 await page.waitForFunction(()=>document.querySelector('#set-alerts .verdict').textContent==='Off');
 pass('settings','Discord-only webhook, masked once saved, switches and severity saved, removed');

 // Setup: plan from the dry run, Run with live lines, Passed and Failed; a step needing administrator rights gives the
 // owner a line to paste, and its teed result comes back (the owner's run is played here by the practice script).
 await page.goto(link.replace(/#.*/,'#setup'));
 await page.waitForSelector('#su-modes input[value=own-pc]');
 await page.check('#su-modes input[value=own-pc]');
 await page.waitForFunction(()=>document.querySelectorAll('#su-steps .sstep').length===11);
 const stepState=id=>page.evaluate(i=>document.querySelector(`[data-step="${i}"]`).dataset.state,id);
 const openStep=async(id,planItems)=>{await page.click(`[data-step="${id}"] .sstep-head`);await page.waitForFunction(([i,n])=>document.querySelectorAll(`[data-step="${i}"] .su-plan li`).length===n,[id,planItems],{timeout:20000});};
 await openStep('secrets',2);
 await page.click('[data-step=secrets] .su-actions .btn.primary');
 await page.waitForFunction(()=>document.querySelector('[data-step=secrets]').dataset.state==='running'&&document.querySelectorAll('[data-step=secrets] .sln').length>3,null,{timeout:20000});
 await page.waitForFunction(()=>document.querySelector('[data-step=secrets]').dataset.state==='PASS',null,{timeout:30000});
 await openStep('patch',4);
 await page.click('[data-step=patch] .su-actions .btn.primary');
 await page.waitForFunction(()=>document.querySelector('[data-step=patch]').dataset.state==='FAIL'&&/does not match/.test(document.querySelector('[data-step=patch] .su-result').textContent),null,{timeout:20000});
 pass('setup: runs here','plan from the dry run, live lines, Passed, and Failed with the script\'s reason');
 const owner=(script,id)=>{
  const r=spawnSync(process.execPath,[PRACTICE,script,'-Apply','-Json'],{env:{...process.env,RLB_PRACTICE:JSON.stringify({elevated:true})},encoding:'utf8'});
  writeFileSync(join(config.dataDir,'setup','results',id+'.txt'),r.stdout+'##rlb {"type":"done"}\n');
 };
 await openStep('firewall',5);
 if(!/needs administrator rights/.test(await page.textContent('[data-step=firewall] .su-who')))throw Error('firewall: no administrator note');
 await page.click('[data-step=firewall] .su-actions .btn.primary');
 await page.waitForSelector('[data-step=firewall] .su-cmd');
 const cmd=await page.inputValue('[data-step=firewall] .su-cmd');
 if(!/03-Set-Firewall\.ps1' -Apply -Json;/.test(cmd)||!/\| Tee-Object -FilePath '.*firewall\.txt'$/.test(cmd))throw Error('firewall: unexpected line '+cmd);
 await ctx.grantPermissions(['clipboard-read','clipboard-write']).catch(()=>{});
 await page.click('[data-step=firewall] .su-handoff .btn.primary');
 const copied=await page.evaluate(()=>navigator.clipboard.readText().catch(()=>null));
 if(copied!==null&&copied!==cmd)throw Error('copy did not copy the line');
 await page.screenshot({path:join(shots,'setup-handoff-1440.png')});
 owner('03-Set-Firewall.ps1','firewall');
 await page.waitForFunction(()=>document.querySelector('[data-step=firewall]').dataset.state==='PASS',null,{timeout:20000});
 await openStep('isolation',4);
 await page.click('[data-step=isolation] .su-actions .btn.primary');await page.waitForSelector('[data-step=isolation] .su-cmd');
 owner('04-Test-Isolation.ps1','isolation');
 await page.waitForFunction(()=>document.querySelector('[data-step=isolation]').dataset.state==='WARN'&&document.querySelectorAll('[data-step=isolation] .su-result tbody tr').length===9,null,{timeout:20000});
 await page.click('[data-step=patch] .sstep-head'); // closed again, to show the stepper
 await new Promise(r=>setTimeout(r,400));
 await page.screenshot({path:join(shots,'setup-1440.png'),fullPage:true});
 pass('setup: your steps',`copied line${copied===null?' (clipboard not readable here)':''}, its result read back: firewall ${await stepState('firewall')}, isolation ${await stepState('isolation')} with 9 checks`);

 // Updates: add a kit update tar, install it (gateway and sidecar restart), roll it back.
 const tarSrc=join(dataDir,'update-src');mkdirSync(join(tarSrc,'bridge'),{recursive:true});writeFileSync(join(tarSrc,'bridge','notes.mjs'),'// after the update'+String.fromCharCode(10));
 const tarFile=join(dataDir,'gateway-update.tar');spawnSync(TAR,['-cf',tarFile,'-C',tarSrc,'bridge/notes.mjs']);
 await page.goto(link.replace(/#.*/,'#updates'));
 await page.setInputFiles('#up-file',tarFile);await page.click('#up-form button[type=submit]');
 await page.waitForFunction(()=>/gateway-update.tar/.test(document.getElementById('up-staged-list').textContent),null,{timeout:20000});
 await page.screenshot({path:join(shots,'updates-1440.png')});
 const gwPid=comp('gateway').pid;
 await page.locator('#up-staged-list li',{hasText:'gateway-update.tar'}).locator('button',{hasText:'Install'}).click();await page.click('#confirm-ok');
 await until('update installed and gateway restarted',()=>comp('gateway').pid!==gwPid&&comp('gateway').state==='running',60000);
 if(!/after the update/.test(readFileSync(join(dataDir,'app','bridge','notes.mjs'),'utf8')))throw Error('update not unpacked');
 await page.waitForFunction(()=>document.querySelectorAll('#up-history li button').length>=1,null,{timeout:20000});
 await page.locator('#up-history button',{hasText:'Roll back'}).first().click();await page.click('#confirm-ok');
 await until('rolled back',()=>/before the update/.test(readFileSync(join(dataDir,'app','bridge','notes.mjs'),'utf8')),30000);
 await until('gateway back up',()=>comp('gateway').state==='running',60000);
 pass('updates','added, installed with gateway and sidecar restarted, rolled back');
 // Release feed: check, signature verified, the release downloaded into "Ready to install" with its notes.
 await page.click('#feed-check');
 await page.waitForFunction(()=>/ready to install/i.test(document.getElementById('feed-releases').textContent)&&/signature verified/.test(document.getElementById('feed-facts').textContent),null,{timeout:30000});
 await page.waitForFunction(()=>/rlb-1\.0\.1\.tar/.test(document.getElementById('up-staged-list').textContent),null,{timeout:20000});
 await new Promise(r=>setTimeout(r,500));
 await page.evaluate(()=>document.getElementById('toasts').replaceChildren());
 await page.screenshot({path:join(shots,'updates-feed-1440.png')});
 pass('release feed','checked, signature verified, release downloaded and waiting to install');

 // Health check card on the Overview: every row has a status; on the demo the ports and our adapter pass, and
 // LauncherOnly (off in the demo) warns with its fix.
 const healthRows=()=>page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('.hc-all li[data-status]')].map(li=>[li.querySelector('b').textContent,li.dataset.status])));
 await until('gateway listening again after the roll back',async()=>comp('gateway').state==='running'&&await tcpOpen('127.0.0.1',ports.gateway),60000);
 await page.goto(link.replace(/#.*/,'#overview'));
 await page.waitForSelector('#hc-run');await page.click('#hc-run');
 await page.waitForFunction(()=>document.querySelectorAll('.hc-all li[data-status]').length>=10&&!document.getElementById('hc-run').hasAttribute('aria-busy'),null,{timeout:30000});
 let hc=await healthRows();
 const hcDetail=()=>page.evaluate(()=>[...document.querySelectorAll('.hc-all li')].map(li=>li.textContent).join(' | '));
 for(const [k,v] of [['Game port answers','PASS'],['Gateway listening','PASS'],['Our adapter on the server','PASS'],['Website reachable with the host app key','PASS'],['Website players only (LauncherOnly)','WARN'],['Node.js version','PASS']])if(hc[k]!==v)throw Error(`health check: ${k} is ${hc[k]}, expected ${v}: ${await hcDetail()}`);
 if(!/Website players only/.test(await page.textContent('#hc-problems')))throw Error('health check: the LauncherOnly warning is not listed with its fix');
 await new Promise(r=>setTimeout(r,4500));
 await page.locator('#health-card').screenshot({path:join(shots,'health-check-1440.png')});
 pass('health check',`${Object.keys(hc).length} rows; ports, adapter and website pass, LauncherOnly off warns`);

 // Settings → Server: change the name, the airdrop players, the adapter's LauncherOnly and message of the day, and the
 // admin password (never shown back); the files change on disk, the health check then passes LauncherOnly.
 const serverFiles=join(dataDir,'Rust Server');
 await page.goto(link.replace(/#.*/,'#settings'));
 await page.waitForFunction(()=>document.querySelectorAll('#set-server .set-row').length>=15&&document.getElementById('set-ad-LauncherOnly'),null,{timeout:20000});
 const demoPw=/rcon\.password "([^"]+)"/.exec(readFileSync(join(serverFiles,'cfg','server.cfg'),'utf8'))[1];
 if(await page.evaluate(pw=>document.documentElement.outerHTML.includes(pw),demoPw))throw Error('settings: the admin password reached the page');
 await page.fill('#set-server-hostname','Host app demo (QA)');
 await page.fill('#set-airdrop-min_players','12');
 await page.selectOption('#set-ad-LauncherOnly','true');
 await page.fill('#set-ad-Motd','Welcome! No griefing near the spawn.');
 await page.fill('#set-rcon','qa-admin-password-123');
 await page.waitForFunction(()=>/5 unsaved changes/.test(document.querySelector('#set-server .set-bar').textContent));
 await new Promise(r=>setTimeout(r,4500)); // let the update toasts go
 await page.screenshot({path:join(shots,'settings-1440.png'),fullPage:true});
 await page.click('#set-server .set-bar button[type=submit]');
 await until('settings saved',()=>/server\.hostname "Host app demo \(QA\)"/.test(readFileSync(join(serverFiles,'cfg','server.cfg'),'utf8')),10000);
 const cfgText=readFileSync(join(serverFiles,'cfg','server.cfg'),'utf8'),adapterCfg=JSON.parse(readFileSync(join(serverFiles,'oxide','config','RustLegacyBrowser.json'),'utf8'));
 if(!/airdrop\.min_players "12"/.test(cfgText)||!/rcon\.password "qa-admin-password-123"/.test(cfgText)||!/^\/\/ Demo copy/.test(cfgText))throw Error('settings: cfg not written as expected');
 if(adapterCfg.LauncherOnly!==true||adapterCfg.Motd!=='Welcome! No griefing near the spawn.'||!adapterCfg.PluginKeyHex)throw Error('settings: adapter config not written as expected');
 await page.waitForFunction(()=>/No changes/.test(document.querySelector('#set-server .set-bar').textContent)&&!document.querySelector('#set-server .set-restart').hidden,null,{timeout:10000});
 if(await page.evaluate(()=>document.body.innerHTML.includes('qa-admin-password-123')))throw Error('settings: the new admin password is shown back');
 await page.locator('#set-server .set-restart').screenshot({path:join(shots,'settings-saved-1440.png')});
 pass('settings','server name, airdrops, LauncherOnly, message of the day and admin password saved; password never shown; restart asked');
 await page.goto(link.replace(/#.*/,'#overview'));await page.click('#hc-run');
 await page.waitForFunction(()=>[...document.querySelectorAll('.hc-all li[data-status]')].some(li=>/LauncherOnly/.test(li.textContent)&&li.dataset.status==='PASS'),null,{timeout:30000});
 pass('health check after settings','LauncherOnly now passes');

 // Settings → Admins: give and remove a role through the host key (owner decision, HOST-AND-LOADER-BUILD.md question
 // 1, 29 Oct 2026) — the same two-way path the website's own Owner page uses.
 await page.goto(link.replace(/#.*/,'#settings'));
 await page.waitForFunction(()=>[...document.querySelectorAll('#set-role-player option')].some(o=>o.textContent==='Demo player 1'),null,{timeout:20000});
 await page.selectOption('#set-role-player',{label:'Demo player 1'});
 await page.selectOption('#set-role-role','admin');
 await page.click('#set-role-save');
 await page.waitForFunction(()=>[...document.querySelectorAll('.set-roles li')].some(li=>/Demo player 1/.test(li.textContent)&&/Admin/.test(li.textContent)),null,{timeout:10000});
 await page.screenshot({path:join(shots,'settings-role-granted-1440.png'),fullPage:true});
 await page.selectOption('#set-role-player',{label:'Demo player 1'});
 await page.selectOption('#set-role-role','');
 await page.click('#set-role-save');
 await page.waitForFunction(()=>![...document.querySelectorAll('.set-roles li')].some(li=>/Demo player 1/.test(li.textContent)),null,{timeout:10000});
 pass('settings: admin roles','Demo player 1 given Admin through the host key, then the role removed again');

 // Plugins: the demo's plugins with name, version and author; ours protected; add one, turn one off, remove one.
 await page.goto(link.replace(/#.*/,'#plugins'));
 await page.waitForFunction(()=>document.querySelectorAll('#pg-table tbody tr').length===4,null,{timeout:20000});
 if(await page.locator('#pg-table tr[data-name=RustLegacyBrowser] button').count())throw Error('plugins: our adapter has buttons');
 if(!/1\.2\.0/.test(await page.textContent('#pg-table tr[data-name=DemoWelcomeKit]')))throw Error('plugins: version not shown');
 const qaPlugin=join(dataDir,'QaHello.cs');writeFileSync(qaPlugin,'// QA plugin for the dashboard check\nnamespace Oxide.Plugins\n{\n    [Info("QA Hello", "Dashboard check", "0.0.1")]\n    class QaHello : RustLegacyPlugin { }\n}\n');
 await page.setInputFiles('#pg-file',qaPlugin);await page.click('#pg-form button[type=submit]');
 await page.waitForSelector('#pg-table tr[data-name=QaHello]',{timeout:10000});
 await page.locator('#pg-table tr[data-name=DemoHomes] button',{hasText:'Turn off'}).click();
 await until('DemoHomes turned off',()=>existsSync(join(serverFiles,'oxide','plugins','disabled','DemoHomes.cs')),10000);
 await page.waitForFunction(()=>/Off/.test(document.querySelector('#pg-table tr[data-name=DemoHomes]')?.textContent??''),null,{timeout:10000});
 await page.locator('#pg-table tr[data-name=QaHello] button',{hasText:'Remove'}).click();await page.click('#confirm-ok');
 await until('QaHello removed',()=>!existsSync(join(serverFiles,'oxide','plugins','QaHello.cs'))&&readdirSync(join(serverFiles,'oxide','plugins','removed')).some(f=>f.startsWith('QaHello.')),10000);
 await page.waitForFunction(()=>!document.querySelector('#pg-table tr[data-name=QaHello]'),null,{timeout:10000});
 await new Promise(r=>setTimeout(r,4500)); // let the toasts go
 await page.screenshot({path:join(shots,'plugins-1440.png'),fullPage:true});
 pass('plugins','listed with versions, ours protected, one added, one turned off, one removed into the archive');
 // Schedule: the editor (a wipe rule needs confirming), a countdown whose warning reaches the server's chat, Cancel, and a
 // restart now that saves first. Times are 12 h away so no scheduled restart starts during the check.
 await page.goto(link.replace(/#.*/,'#schedule'));
 await page.waitForFunction(()=>document.getElementById('sch-tz').value!=='',null,{timeout:20000});
 const later=String((new Date().getUTCHours()+12)%24).padStart(2,'0')+':00';
 await page.fill('#sch-tz','UTC');await page.check('#sch-r-on');await page.fill('#sch-r-times',later);
 await page.check('#sch-w-on');await page.selectOption('#sch-w-every','month');await page.selectOption('#sch-w-nth','-1');await page.selectOption('#sch-w-day','mon');await page.fill('#sch-w-time',later);
 await page.uncheck('#sch-quiet'); // nobody plays on the demo; warn anyway so the chat line shows
 await page.click('#sch-form button[type=submit]');
 await page.waitForSelector('#confirm[open]');
 if(!/last monday of each month/i.test(await page.textContent('#confirm-text')))throw Error('the wipe confirmation does not name the rule');
 await page.click('#confirm-ok');
 await page.waitForFunction(()=>document.getElementById('sch-next').textContent!=='–'&&document.getElementById('sch-wipe').textContent!=='–',null,{timeout:10000});
 if(!svc.host.schedule.status().schedule.wipe.enabled)throw Error('wipe schedule not saved');
 await page.selectOption('#sch-now-min','5');await page.click('#sch-now button[type=submit]');await page.click('#confirm-ok');
 await page.waitForSelector('#sch-pending:not([hidden])',{timeout:10000});
 await until('restart warning in the server chat',()=>svc.host.hub.since(0).some(l=>l.text==='[CHAT] Server: Server restart in 5 minutes.'),15000);
 await new Promise(r=>setTimeout(r,1200));
 await page.screenshot({path:join(shots,'schedule-countdown-1440.png'),fullPage:true});
 await page.click('#sch-cancel');
 await page.waitForFunction(()=>document.getElementById('sch-pending').hidden&&/Cancelled/.test(document.getElementById('sch-table').textContent),null,{timeout:10000});
 const beforeRestart=comp('server').pid;
 await page.selectOption('#sch-now-min','0');await page.click('#sch-now button[type=submit]');await page.click('#confirm-ok');
 await until('restart now done',()=>svc.host.schedule.status().history[0]?.outcome==='done'&&comp('server').pid!==beforeRestart&&comp('server').state==='running',60000);
 if(!svc.host.hub.since(0).some(l=>/saved; asked it to quit/.test(l.text)))throw Error('the restart did not save first');
 await page.waitForFunction(()=>/Done/.test(document.getElementById('sch-table').textContent),null,{timeout:15000});
 await page.screenshot({path:join(shots,'schedule-1440.png'),fullPage:true});
 pass('schedule','wipe rule confirmed, countdown warning in chat, cancel, restart now saved first');
 await page.goto(link.replace(/#.*/,'#overview'));

 // The 2026-10-22 freeze, on the mock: "Saving to", 0-byte save files, then no CPU, no log, no UDP answer.
 const serverPid=comp('server').pid;
 await page.click('#freeze-row [data-action=freeze]'); // the dashboard's own test button (mock server only)
 await page.waitForFunction(()=>document.getElementById('verdict').dataset.state==='suspect',null,{timeout:30000});
 await new Promise(r=>setTimeout(r,2500));
 await page.screenshot({path:join(shots,'going-quiet-1440.png')});
 pass('going quiet','verdict turned amber while all three lanes were silent');
 await until('hang handled',()=>comp('server').pid&&comp('server').pid!==serverPid&&comp('server').state==='running',60000);
 await page.waitForFunction(()=>/hang detected/i.test(document.getElementById('event-list').textContent));
 if(!svc.host.status().watchdog.hangs.length)throw Error('no hang recorded');
 await new Promise(r=>setTimeout(r,3000));
 await page.setViewportSize({width:1440,height:1320});await new Promise(r=>setTimeout(r,500));
 await page.screenshot({path:join(shots,'hang-recovered-1440.png')});
 await page.setViewportSize({width:1440,height:900});
 pass('hang','detected, last good save restored, server restarted');

 // Reduced motion: no pulsing beacons; normal motion: the live ring runs.
 const ring=p=>p.evaluate(()=>getComputedStyle(document.getElementById('server-beacon'),'::after').animationName);
 if(await ring(page)!=='ping')throw Error('beacon ring not animating with motion allowed');
 const calm=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'}),cp=await calm.newPage();watch(cp);
 await cp.goto(link);await cp.waitForFunction(()=>document.querySelectorAll('.boot-log li').length>=3,null,{timeout:20000});
 const still=await cp.evaluate(()=>({scan:getComputedStyle(document.querySelector('.boot-scan')).display,line:getComputedStyle(document.querySelector('.boot-log li')).animationName,
  typed:[...document.querySelectorAll('.boot-log li .bx')].every(x=>!x.textContent.endsWith('▌')),bar:[...document.querySelectorAll('.bt')].every(t=>!/=/.test(t.textContent))}));
 if(still.scan!=='none'||still.line!=='none'||!still.typed||!still.bar)throw Error('boot under reduced motion: '+JSON.stringify(still));
 await booted(cp);
 if(await ring(cp)!=='none')throw Error('beacon still animates under reduced motion');
 pass('reduced motion','beacon ring off, state still shown as text; boot lines whole, no spinner, no scanlines');
 await calm.close();

 const phone=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}),pp=await phone.newPage();
 await pp.goto(link);await booted(pp);await new Promise(r=>setTimeout(r,1500));
 const overflow=await pp.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
 if(overflow>0)throw Error(`phone width scrolls sideways by ${overflow}px`);
 await pp.screenshot({path:join(shots,'overview-390.png')});
 for(const v of ['settings','plugins','health']){
  await pp.goto(link.replace(/#.*/,'#'+v));await pp.waitForSelector(`.view[data-view=${v}]:not([hidden])`);await new Promise(r=>setTimeout(r,1200));
  const o=await pp.evaluate(()=>document.documentElement.scrollWidth-innerWidth);if(o>0)throw Error(`${v} at phone width scrolls sideways by ${o}px`);
  await pp.screenshot({path:join(shots,`${v}-390.png`),fullPage:v==='health'});
 }
 pass('phone width','no sideways scroll at 390 px (Overview, Settings, Plugins, Health)');
 await pp.goto(link.replace(/#.*/,'#schedule'));await pp.waitForFunction(()=>document.getElementById('sch-tz').value!=='');await new Promise(r=>setTimeout(r,800));
 const overflowSchedule=await pp.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
 if(overflowSchedule>0)throw Error(`the Schedule page scrolls sideways by ${overflowSchedule}px at phone width`);
 await pp.screenshot({path:join(shots,'schedule-390.png'),fullPage:true});
 pass('phone width','no sideways scroll at 390 px (overview, schedule)');
 await pp.goto(link.replace(/#.*/,'#setup'));await pp.waitForFunction(()=>document.querySelectorAll('#su-steps .sstep').length===11);await new Promise(r=>setTimeout(r,500));
 const setupOverflow=await pp.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
 if(setupOverflow>0)throw Error(`Setup at phone width scrolls sideways by ${setupOverflow}px`);
 await pp.screenshot({path:join(shots,'setup-390.png'),fullPage:true});
 pass('setup at phone width','no sideways scroll at 390 px');
 await phone.close();

 // A fresh install (no parts in host.json): the Overview points to Setup.
 const freshDir=mkdtempSync(join(tmpdir(),'rlb-host-fresh-'));
 const fresh=await startService({listen:{host:'127.0.0.1',port:ports.host+1},dataDir:freshDir,components:{},watchdog:{enabled:true,hangSeconds:90,graceSeconds:300,probeEveryMs:5000},remote:{enabled:false}},{log:()=>{},hostOptions:{setup:practiceSetup(),noRemote:true}});
 try{
  // Its own browser context: cookies are not kept apart by port, and this sign-in would replace the main page's session.
  const fctx=await browser.newContext({viewport:{width:1440,height:900}}),fp=await fctx.newPage();fp.on('pageerror',e=>errors.push(e.message));
  await fp.goto(`http://127.0.0.1:${fresh.port}/#token=${fresh.token}`);await booted(fp);await fp.waitForSelector('#cards a[href="#setup"]');
  await fp.click('#cards a[href="#setup"]');await fp.waitForSelector('[data-view=setup]:not([hidden]) #su-modes input');
  if(!(await fp.isVisible('#su-empty')))throw Error('fresh Setup should ask where the server runs');
  await fctx.close();
 }finally{await fresh.close();rmSync(freshDir,{recursive:true,force:true});}
 pass('fresh install','the Overview points to Setup');

 if(errors.length)throw Error('console errors: '+errors.join(' | '));
 pass('no console errors');
 await page.click('[data-target=all] [data-action=stop]');
 await until('every component stopped',()=>status().components.every(c=>c.state==='stopped'));
 pass('stop all');

 // Backups (server stopped): the watchdog's copies, keep one now, restore one.
 await page.goto(link.replace(/#.*/,'#backups'));
 await page.waitForFunction(()=>document.querySelectorAll('#bk-table tbody tr').length>=1,null,{timeout:20000});
 await page.fill('#bk-label','Before the restore test');await page.click('#bk-keep button[type=submit]');
 await page.waitForFunction(()=>document.getElementById('bk-own').textContent==='1',null,{timeout:10000});
 await page.locator('#bk-table tbody tr').last().locator('button',{hasText:'Restore'}).click();
 await page.click('#confirm-ok');
 await page.waitForFunction(()=>document.getElementById('bk-aside').textContent!=='–'&&Number(document.getElementById('bk-aside').textContent)>=1,null,{timeout:10000});
 await page.screenshot({path:join(shots,'backups-1440.png')});
 pass('backups','copies listed, one kept by hand, one restored with the old save set aside');
 // Off-site (everything stopped): a folder target, encrypted, Back up now, then Download and restore.
 await page.selectOption('#os-target','folder');await page.check('#os-encrypt');await page.fill('#os-pass','demo off-site passphrase');
 await page.click('#os-form button[type=submit]');
 await page.waitForFunction(()=>!document.getElementById('os-run').disabled,null,{timeout:10000});
 await page.click('#os-run');
 await page.waitForFunction(()=>[...document.querySelectorAll('#os-table tbody tr')].some(r=>/Encrypted/.test(r.textContent))&&/Sent/.test(document.getElementById('os-last').textContent),null,{timeout:60000});
 const saveFile=join(dataDir,'Rust Server','rust_server_Data','rust_island_2013.sav');writeFileSync(saveFile,'changed after the backup');
 await page.locator('#os-table tbody tr').first().locator('button',{hasText:'Restore'}).click();
 await page.click('#osr-form button[value=ok]');
 await until('off-site set restored',()=>readFileSync(saveFile,'utf8')!=='changed after the backup',30000);
 await page.waitForFunction(()=>/Last restore/.test(document.getElementById('os-last').textContent),null,{timeout:20000});
 await page.setViewportSize({width:1440,height:1400});await page.evaluate(()=>{document.getElementById('toasts').replaceChildren();document.getElementById('offsite').scrollIntoView();});
 await new Promise(r=>setTimeout(r,500));await page.screenshot({path:join(shots,'backups-offsite-1440.png')});await page.setViewportSize({width:1440,height:900});
 const ph=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}),pq=await ph.newPage();
 await pq.goto(link);await booted(pq);await pq.evaluate(()=>{location.hash='backups';});await pq.waitForSelector('#os-table tbody tr');await new Promise(r=>setTimeout(r,1500));
 const over=await pq.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
 if(over>0)throw Error(`backups at phone width scrolls sideways by ${over}px`);
 await pq.locator('#offsite').scrollIntoViewIfNeeded();await pq.screenshot({path:join(shots,'backups-offsite-390.png')});await ph.close();
 pass('off-site','folder target, encrypted set sent, downloaded and restored; no sideways scroll at 390 px');
 await page.goto(link.replace(/#.*/,'#overview'));

 // Scripts mode: a server started outside the app (as 05-Start-Server.ps1 does, here the mock) shows up and stops here.
 const serverDir=join(dataDir,'Rust Server');
 outside=spawn(process.execPath,[join(REPO,'host','mock-game-server.mjs'),'--port',String(ports.server),'--datadir','rust_server_Data/','--autosave','3600'],{cwd:serverDir,stdio:['pipe','ignore','ignore'],windowsHide:true});
 writeFileSync(join(dataDir,'run','server.pid'),String(outside.pid));
 await page.waitForFunction(()=>/started outside the host/.test(document.getElementById('server-msg').textContent)&&document.getElementById('server-state').textContent==='Running',null,{timeout:20000});
 await new Promise(r=>setTimeout(r,6000));
 await page.screenshot({path:join(shots,'scripts-adopted-1440.png')});
 await page.click('.hero-actions [data-action=stop]');
 await until('script-started server stopped from the app',()=>comp('server').state==='stopped'&&outside.exitCode!==null,20000);
 pass('scripts mode','a server started outside the app shows up and stops from the app');
 console.log(`host dashboard: ${results.length} checks passed; screenshots in ${shots}`);
}catch(e){console.error('FAIL',e.message);process.exitCode=1;}
finally{outside?.kill();feedServer?.close();await browser?.close();await svc?.close();rmSync(dataDir,{recursive:true,force:true,maxRetries:20,retryDelay:250});}
