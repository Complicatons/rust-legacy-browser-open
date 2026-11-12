// Discord alerts (host/alerts.mjs) against a fake webhook server: only Discord webhook URLs are kept, the URL is never
// shown or logged in full, bursts are batched (at most 10 embeds a message) and rate limited, 429 and 5xx are retried,
// switched-off kinds stay quiet, and the host's own events (crash, freeze, part stopped, back online) and the website's
// flags and reports become alerts. No real Discord.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAlerts,checkWebhookUrl,maskWebhook,ALERT_KINDS} from '../host/alerts.mjs';
import {listenServer} from '../bridge/listen.mjs';

const URL1='https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcdefghijklmnop';
const until=async(pred,ms=8000,what='condition')=>{const t=Date.now();while(Date.now()-t<ms){if(await pred())return;await new Promise(r=>setTimeout(r,20));}throw Error(what+' not met');};

// A fake Discord: records each POST; `script` decides each reply in order (status, body), then 204.
async function fakeDiscord(){
 const got=[],script=[];
 const srv=createServer((req,res)=>{let b='';req.on('data',d=>b+=d);req.on('end',()=>{
  got.push({path:req.url,body:JSON.parse(b),at:Date.now()});
  const next=script.shift()??{status:204};
  res.writeHead(next.status,{'content-type':'application/json',...(next.headers??{})});res.end(next.body?JSON.stringify(next.body):'');
 });});
 await listenServer(srv);const base=`http://127.0.0.1:${srv.address().port}`;
 // The alerts module only ever builds Discord URLs; the test sends them to the fake by path.
 const fetchImpl=(url,opts)=>{const u=new URL(url);assert.ok(['discord.com','discordapp.com'].includes(u.hostname));return fetch(base+u.pathname+u.search,opts);};
 return {got,script,fetchImpl,close:()=>new Promise(r=>srv.close(r))};
}

test('webhook URL: Discord hosts and the webhook path only; masked for display',()=>{
 assert.equal(checkWebhookUrl(URL1),URL1);
 assert.equal(checkWebhookUrl(URL1.replace('discord.com','discordapp.com')),URL1.replace('discord.com','discordapp.com'));
 for(const bad of [URL1.replace('https','http'),URL1.replace('discord.com','discord.com.evil.test'),URL1.replace('discord.com','evil.test'),URL1.replace('https://','https://user:pw@'),
  URL1.replace('discord.com','discord.com:8443'),'https://discord.com/api/users/@me','https://discord.com/api/webhooks/1/x',URL1+'?wait=true',URL1+'#x','javascript:alert(1)','',42])
  assert.throws(()=>checkWebhookUrl(bad),e=>e.status===400,String(bad));
 const m=maskWebhook(URL1);assert.match(m,/^discord\.com\/api\/webhooks\/123456789012345678\/•+$/);assert.ok(!m.includes('AbCd'));
 assert.ok(Object.keys(ALERT_KINDS).includes('crash')&&Object.keys(ALERT_KINDS).includes('flags'));
});

test('alerts: settings file, masked view, batching under the rate limit, 429 and 5xx retries, switches, test alert',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'rlb-alerts-')),d=await fakeDiscord(),logs=[];
 const a=createAlerts({dataDir:dir,fetchImpl:d.fetchImpl,log:(t,l)=>logs.push(t),coalesceMs:60,perMinute:2,windowMs:600,retryBaseMs:30});
 try{
  assert.equal(a.view().configured,false);
  assert.throws(()=>a.save({url:'https://example.com/hook'}),/Discord webhook/);
  a.save({url:URL1,events:{reports:false},flagSeverity:40});
  const v=a.view();assert.equal(v.configured,true);assert.ok(!JSON.stringify(v).includes('AbCd'));assert.equal(v.events.reports,false);assert.equal(v.events.crash,true);assert.equal(v.flagSeverity,40);
  if(process.platform!=='win32')assert.equal(statSync(join(dir,'alerts.json')).mode&0o077,0);
  assert.equal(JSON.parse(readFileSync(join(dir,'alerts.json'),'utf8')).url,URL1);
  // A burst of 25 becomes messages of at most 10 embeds; with 2 messages a window, the third waits and nothing is lost.
  for(let i=0;i<25;i++)a.notify('crash',{title:`Crash ${i}`,text:'Game server exited unexpectedly (code 1)'});
  a.notify('reports',{title:'switched off',text:'x'});
  await until(()=>d.got.reduce((n,g)=>n+g.body.embeds.length,0)===25,8000,'25 embeds delivered');
  assert.ok(d.got.length===3&&d.got.every(g=>g.body.embeds.length<=10));
  assert.ok(d.got.every(g=>g.path==='/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcdefghijklmnop'));
  assert.deepEqual(d.got[0].body.allowed_mentions,{parse:[]});assert.equal(d.got[0].body.username,'Rust Legacy Host');
  assert.equal(d.got[0].body.embeds[0].color,0xc62f24);
  assert.ok(!d.got.flatMap(g=>g.body.embeds).some(e=>e.title==='switched off'));
  // Rate limit: the third message waited for the window to open again.
  assert.ok(d.got[2].at-d.got[0].at>=550,'third message waited for the window');
  // 429 with retry_after, then a 500: both retried, one delivery.
  d.got.length=0;d.script.push({status:429,body:{retry_after:0.05}},{status:500});
  a.notify('freeze',{title:'Freeze **@everyone** [x](https://evil.test)',text:'name_with_markdown'});
  await until(()=>d.got.length===3,8000,'retried twice');
  const e=d.got[2].body.embeds[0];assert.equal(e.title,'Freeze \\*\\*@everyone\\*\\* \\[x\\]\\(https://evil.test\\)');assert.equal(e.description,'name\\_with\\_markdown');
  assert.equal(a.view().recent[0].ok,true);
  // A deleted webhook (404) is not retried; the owner sees why, and the logs never carry the token.
  d.got.length=0;d.script.push({status:404,body:{message:'Unknown Webhook'}});
  a.notify('crash',{title:'gone',text:'x'});
  await until(()=>a.view().lastError,4000,'error recorded');
  await new Promise(r=>setTimeout(r,200));assert.equal(d.got.length,1);
  assert.match(a.view().lastError,/404/);
  // Test alert: straight away, whatever the switches.
  const t=await a.test();assert.equal(t.ok,true);assert.match(d.got.at(-1).body.embeds[0].title,/Test alert/);
  assert.ok(logs.length&&!logs.some(l=>l.includes('AbCd')),'token never logged');
  a.save({url:''});assert.equal(a.view().configured,false);
  assert.equal((await a.test()).ok,false);
 }finally{a.stop();await d.close();rmSync(dir,{recursive:true,force:true});}
});

test('alerts from the host: crash, failed, a part stopping, freeze and recovery, back online, flags over the severity, new reports, notify()',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'rlb-alerts-')),d=await fakeDiscord();
 const ev=new EventEmitter(),host=Object.assign(ev,{status:()=>({components:[]})});
 let flags=[{source:'browser',id:1,at:1,kind:'speed',severity:10,name:'Old'}],reports=[{id:'r1',name:'Old',reason:'other',reporterName:'A',createdAt:1}];
 const central=async route=>route==='recent-flags'?{flags}:{reports};
 const a=createAlerts({dataDir:dir,fetchImpl:d.fetchImpl,coalesceMs:30,pollMs:50,central});
 const titles=()=>d.got.flatMap(g=>g.body.embeds.map(e=>e.title));
 try{
  a.save({url:URL1,flagSeverity:20});
  a.attach(host);
  ev.emit('state',{name:'server',label:'Game server',state:'backoff',message:'exited unexpectedly (code 3); restarting in 2 s'});
  ev.emit('state',{name:'server',label:'Game server',state:'starting'});
  ev.emit('state',{name:'server',label:'Game server',state:'running'});
  ev.emit('state',{name:'gateway',label:'Gateway',state:'failed',message:'5 failures in 10 min'});
  ev.emit('watchdog',{state:'hung',ages:{log:31,udp:31,cpu:31},hangSeconds:30});ev.emit('watchdog',{state:'hung'});
  ev.emit('state',{name:'server',label:'Game server',state:'stopping'});ev.emit('state',{name:'server',label:'Game server',state:'stopped',lastExit:{wanted:true,reason:'hang'}});
  ev.emit('state',{name:'server',label:'Game server',state:'starting'});ev.emit('state',{name:'server',label:'Game server',state:'running'});
  // An owner stop and start is not news.
  ev.emit('state',{name:'server',label:'Game server',state:'stopping'});ev.emit('state',{name:'server',label:'Game server',state:'stopped',lastExit:{wanted:true}});ev.emit('state',{name:'server',label:'Game server',state:'running'});
  await until(()=>titles().length>=5,4000,'host alerts');
  assert.deepEqual(titles(),['Game server crashed','Game server back online','Gateway failed','Game server froze','Game server recovered from the freeze']);
  // The first poll only learns what is already there; later flags at or over the severity, and new reports, alert.
  await new Promise(r=>setTimeout(r,150));
  flags=[{source:'browser',id:2,at:2,kind:'teleport',severity:40,name:'Zoë'},{source:'browser',id:3,at:3,kind:'speed',severity:10,name:'Low'},...flags];
  reports=[{id:'r2',name:'Zoë',reason:'cheating',reporterName:'Bob',detail:'flying',createdAt:2},...reports];
  await until(()=>titles().some(t=>/flag/i.test(t))&&titles().some(t=>/report/i.test(t)),4000,'flag and report alerts');
  const all=d.got.flatMap(g=>g.body.embeds);
  const f=all.find(e=>/flag/i.test(e.title));assert.match(f.description,/Zoë.*Teleport.*40/);assert.ok(!/Low/.test(f.description));
  assert.match(all.find(e=>/report/i.test(e.title)).description,/Bob.*Zoë.*cheating/);
  a.notify('schedule',{title:'Scheduled restart done',text:'Back up after 42 s'});
  await until(()=>titles().includes('Scheduled restart done'),4000,'notify');
 }finally{a.stop();await d.close();rmSync(dir,{recursive:true,force:true});}
});
