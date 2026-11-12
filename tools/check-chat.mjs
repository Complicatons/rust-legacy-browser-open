// Original HUD chat and F1 console forwarding (browser/chat.mjs, browser/console-route.mjs) on the real page.
// Offline: Return/T open the chat, the island answers chat.say itself (1 s NetUser.CanChat), lines render with the
// exported pnlChat/ChatLine layout and disappear after TimedObjectDestructor.timeOut; F1 keeps "Unknown command".
// Online (central + sidecar + gateway from tests/helpers/stack.mjs, only the Legacy server mocked): the exact
// SV_RunConsoleCommand the server receives, server chat.add lines and SERVER CONSOLE notices, F1 forwarding and
// CL_ConsoleMessage replies. Screenshots in analysis/browser-qa/chat/.
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from './serve.mjs';
import {startStack,poll} from '../tests/helpers/stack.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
import {readArgs} from '../bridge/ulink/rust.mjs';
const out='analysis/browser-qa/chat/';await mkdir(out,{recursive:true});
const web=createServer();await listenServer(web);const origin=`http://127.0.0.1:${web.address().port}`;
let stack=null;const browser=await chromium.launch(launchOptions());const report={};
const lines=page=>page.evaluate(()=>[...document.querySelectorAll('#chat-ui .chat-line')].map(l=>{const r=l.getBoundingClientRect(),n=l.querySelector('.chat-name'),t=l.querySelector('.chat-text'),ns=getComputedStyle(n);
 return {name:n.textContent,text:t.textContent,x:r.x,y:r.y,width:r.width,height:r.height,nameColor:ns.color,nameFont:ns.fontFamily,nameRight:n.getBoundingClientRect().right,textX:t.getBoundingClientRect().x,textFont:getComputedStyle(t).fontFamily,spans:[...t.querySelectorAll('span')].map(s=>[s.textContent,getComputedStyle(s).color])};}));
const consoleLog=page=>page.evaluate(()=>[...document.querySelectorAll('#game-console .console-log p')].map(p=>p.textContent));
async function f1(page,command){await page.keyboard.press('F1');await page.waitForSelector('#game-console:not([hidden])');await page.locator('#console-input').fill(command);await page.locator('#console-input').press('Enter');await page.waitForTimeout(150);const log=await consoleLog(page);await page.keyboard.press('F1');return log;}
async function say(page,text,key='Enter'){await page.keyboard.press(key);await page.waitForFunction(()=>window.explorerDev.chat().open);await page.waitForTimeout(100);await page.keyboard.type(text);await page.keyboard.press('Enter');}
try{
 // ---- offline -------------------------------------------------------------------------------------------------
 {const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(origin+'/?dev',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.explorerState?.frames>5,{},{timeout:120000});
  await page.locator('#world').click({position:{x:850,y:350}});await page.waitForFunction(()=>Boolean(document.pointerLockElement));
  await page.keyboard.press('Enter');await page.waitForFunction(()=>window.explorerDev.chat().open&&!document.pointerLockElement&&document.activeElement?.id==='chat-input');
  const box=await page.locator('#chat-ui .chat-textbox').boundingBox();assert.deepEqual([box.x,box.y,box.width,box.height],[96,608,720,28],'Textbox: pnlChat left 48 + 48, bottom 84 - 28');
  await page.waitForTimeout(100); // ChatUI.Open invokes ClearText after .05 s: anything typed sooner is cleared, as in the original
  await page.keyboard.type('hello "world" [color #ff0000]red[/color] wasd');
  assert.equal(await page.evaluate(()=>window.explorerDev.chat().text),'hello "world" [color #ff0000]red[/color] wasd','typing goes to the box, not the game');
  await page.screenshot({path:out+'offline-typing.png'});
  await page.keyboard.press('Enter');const sentAt=Date.now();await page.waitForFunction(()=>!window.explorerDev.chat().open);
  let l=await lines(page);assert.equal(l.length,1);assert.equal(l[0].name,'Player:');assert.equal(l[0].text,'hello "world" red wasd');
  assert.deepEqual(l[0].spans.find(s=>s[0]==='red')?.[1],'rgb(255, 0, 0)','[color #ff0000] markup');assert.equal(l[0].nameColor,'rgb(182, 205, 43)');
  assert.match(l[0].nameFont,/RobotoCondensed-Bold/);assert.match(l[0].textFont,/RobotoCondensed-Regular/);
  assert.deepEqual([l[0].x,l[0].y,l[0].width,l[0].height],[48,484,768,20],'ReLayout: newest line bottom at container bottom (720 - 84 - 132)');
  assert.ok(Math.abs(l[0].nameRight-(48+152))<1&&Math.abs(l[0].textX-(48+163))<1,'lblChatName right edge / lblChatText left edge');
  report.relock=await page.evaluate(()=>Boolean(document.pointerLockElement));
  // T opens too and its keypress is not typed (ClearText); a second line inside a second is dropped by chat.say.
  await page.keyboard.press('KeyT');await page.waitForFunction(()=>window.explorerDev.chat().open);await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>window.explorerDev.chat().text),'');
  await page.keyboard.type('too fast');await page.keyboard.press('Enter');assert.ok(Date.now()-sentAt<1000,'second line was sent within NetUser.CanChat');await page.waitForFunction(()=>!window.explorerDev.chat().open);
  await page.waitForTimeout(1100);await say(page,'third','KeyT');await page.waitForFunction(()=>!window.explorerDev.chat().open);
  l=await lines(page);assert.deepEqual(l.map(x=>x.text),['hello "world" red wasd','third']);assert.deepEqual(l.map(x=>x.y),[464,484]);
  // Escape cancels without sending.
  await page.keyboard.press('Enter');await page.waitForFunction(()=>window.explorerDev.chat().open);await page.keyboard.type('never sent');await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.explorerDev.chat().open);assert.equal((await lines(page)).length,2);
  await page.keyboard.press('Enter');await page.waitForFunction(()=>window.explorerDev.chat().open);await page.screenshot({path:out+'offline-lines.png'});await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.explorerDev.chat().open);
  // F1: client chat.enabled; anything else stays local offline.
  let log=await f1(page,'status');assert.equal(log.at(-1),'Unknown command: status');
  log=await f1(page,'chat.enabled');assert.equal(log.at(-1),'chat.enabled: "True" (Boolean)');
  // TimedObjectDestructor.timeOut 16 s.
  await page.waitForFunction(()=>window.explorerDev.chat().lines.length===1,{},{timeout:17000,polling:200});const gone=Date.now()-sentAt;assert.ok(gone>15500&&gone<17500,'first line removed after 16 s: '+gone);
  assert.equal((await lines(page))[0].y,484,'remaining line drops to the bottom');assert.deepEqual(errors,[]);report.offline={lines:l.map(({name,text,x,y})=>({name,text,x,y})),firstLineMs:gone,graphics:await readGraphics(page)};await page.close();}
 // ---- online --------------------------------------------------------------------------------------------------
 stack=await startStack({gatewayOrigins:[origin]});
 {const player=await stack.login('browser-player');const {ticket}=(await stack.call('POST',`/servers/${stack.serverId}/join-ticket`,{cookie:player.cookie,csrf:player.csrf})).data;
  const join={ticket,endpoint:`ws://127.0.0.1:${stack.gateway.port}/play`,server:stack.serverId,name:'Pilot'};
  const page=await (await browser.newContext()).newPage({viewport:{width:1280,height:720}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.addInitScript(j=>{if(!sessionStorage.getItem('rlb-join-used')){sessionStorage.setItem('rlb-join-used','1');sessionStorage.setItem('rlb-join',JSON.stringify({...j,at:Date.now()}));}},join);
  await page.goto(origin+'/?dev',{waitUntil:'load',timeout:300000});
  const peer=await poll(()=>[...stack.native.peers.values()].find(p=>p.playerId),120000);const seen=[],commands=[];
  peer.onUlink=(h,b)=>{seen.push(h.rpc);if(h.rpc==='SV_RunConsoleCommand')commands.push({viewId:h.viewId,args:readArgs(['string'],b)});};
  peer.create({viewId:1,prefab:'ServerManagement'});await poll(()=>seen.includes('ClientFirstReady'),60000);
  peer.create({viewId:20,owner:peer.playerId,prefab:':player_soldier',position:[5244.1,368,-4839.6]});
  await page.waitForFunction(()=>window.explorerState?.online?.state==='in-game'&&window.explorerState.walk&&window.explorerDev.chat,{},{timeout:600000,polling:1000});
  await say(page,'hi "there" \\');await page.waitForFunction(()=>!window.explorerDev.chat().open);await poll(()=>commands.length>0,5000);
  assert.deepEqual(commands,[{viewId:997,args:['chat.say "hi \\"there\\" "']}],'ChatUI.SendChat: chat.say + QuoteSafe (trailing backslash trimmed)');
  await page.waitForTimeout(300);assert.equal((await lines(page)).length,0,'online lines come from the server only');
  peer.rpc(997,'CL_ConsoleCommand',['string'],['chat.add "browser-player" "hi \\"there\\""']);await page.waitForFunction(()=>window.explorerDev.chat().lines.length===1);
  peer.rpc(997,'CL_ConsoleCommand',['string'],['chat.add "SERVER CONSOLE" "Server restarting in [color #ffff00]5[/color] minutes"']);
  peer.rpc(997,'CL_ConsoleCommand',['string'],['chat.say "not a line"']);peer.rpc(997,'CL_ConsoleCommand',['string'],['chat.add "" "empty name"']);
  await page.waitForFunction(()=>window.explorerDev.chat().lines.length===2);await page.waitForTimeout(300);
  let l=await lines(page);assert.deepEqual(l.map(x=>[x.name,x.text,x.y]),[['browser-player:','hi "there"',464],['SERVER CONSOLE:','Server restarting in 5 minutes',484]]);
  assert.equal(l[1].spans.find(s=>s[0]==='5')?.[1],'rgb(255, 255, 0)');
  await page.keyboard.press('Enter');await page.waitForFunction(()=>window.explorerDev.chat().open);await page.waitForTimeout(100);await page.keyboard.type('typing online');assert.equal(await page.evaluate(()=>window.explorerDev.chat().text),'typing online');await page.screenshot({path:out+'online.png'});await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.explorerDev.chat().open);
  assert.equal(commands.length,1,'Escape sends nothing');
  // F1: unknown/server commands go to the server as typed; client commands stay local; CL_ConsoleMessage is printed.
  await page.keyboard.press('F1');await page.waitForSelector('#game-console:not([hidden])');
  for(const c of ['status','render.fov 90','quit','env.time 12'])await page.locator('#console-input').fill(c),await page.locator('#console-input').press('Enter');
  await poll(()=>commands.length===3,5000);assert.deepEqual(commands.slice(1).map(c=>c.args[0]),['status','env.time 12'],'only server commands are forwarded');
  peer.rpc(997,'CL_ConsoleMessage',['string'],['hostname: Mock Legacy\nplayers : 1 (50 max)']);await page.waitForFunction(()=>[...document.querySelectorAll('#game-console .console-log p')].some(p=>p.textContent==='players : 1 (50 max)'));
  const log=await consoleLog(page);assert.ok(log.includes('Unknown command: quit'),'client quit is never forwarded: '+log.join(' | '));assert.ok(log.includes('render.fov: 90'));assert.ok(log.includes('hostname: Mock Legacy'));
  // The original ConsoleWindow (console-window.mjs): 688x592 window_background panel 80 px from the right, 48 from the top;
  // echo green, client output yellow, CL_ConsoleMessage cyan with the extra empty line (ConsoleWindow.AddText).
  const cw=await page.evaluate(()=>window.explorerDev.controls().consoleWindow),vw=page.viewportSize();
  assert.deepEqual(cw.rect,{x:vw.width-80-688,y:48,width:688,height:592});
  assert.ok(cw.lines.includes('[color #00ff00]> status[/color]')&&cw.lines.includes('[color #ffff00]render.fov: 90[/color]'),cw.lines.join(' | '));
  const at=cw.lines.indexOf('[color #00ffff]hostname: Mock Legacy');assert.ok(at>=0&&cw.lines[at+1]==='players : 1 (50 max)[/color]'&&cw.lines[at+2]==='',cw.lines.join(' | '));
  assert.equal(await page.locator('#game-console [data-df-name="Label"]').first().getAttribute('data-df-name'),'Label');
  await page.screenshot({path:out+'online-console.png'});await page.keyboard.press('F1');
  // Script-created submits are not the player typing: never forwarded.
  await page.evaluate(()=>{document.querySelector('#console-input').value='kick "someone"';document.querySelector('#game-console form').dispatchEvent(new Event('submit',{cancelable:true}));});await page.waitForTimeout(300);assert.equal(commands.length,3);
  assert.deepEqual(errors,[]);report.online={commands,lines:l.map(({name,text,y})=>({name,text,y})),console:log.slice(-12),graphics:await readGraphics(page)};}
 await writeFile(out+'chat.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();await stack?.close();web.close();}
