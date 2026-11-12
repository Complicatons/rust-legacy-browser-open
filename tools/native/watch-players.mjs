// Lite players that stay on a server and log what the server tells them (CROSS-PLAY-TEST-PLAN.md stage 3: message of
// the day, restart and wipe warnings, kicks, coming back after a restart). Each bot signs in with dev sign-in
// (testDevSignIn test deployments only), joins through the gateway like tools/soak-bots.mjs lite bots, and prints one
// JSON line per chat/console line, notice, kick or disconnect it receives. A bot that loses its session rejoins every
// --retry seconds, so a scheduled restart shows as: warnings, disconnect, rejoined.
//   node tools/native/watch-players.mjs --origin http://203.0.113.207:8080 --server <id> [--bots 2] [--prefix watch]
//        [--duration 3600] [--retry 20] [--insecure]
// BROWSER_PATH picks the browser (Playwright's own Chromium when unset). Nothing here talks to the game server directly.
import {chromium} from 'playwright-core';
import {openLitePage} from './driver.mjs';

const args=process.argv.slice(2),opt=(n,d)=>{const i=args.indexOf('--'+n);return i>=0?args[i+1]:d;};
const origin=opt('origin'),serverId=opt('server'),count=Number(opt('bots','2')),prefix=opt('prefix','watch');
const duration=Number(opt('duration','3600')),retry=Number(opt('retry','20')),insecure=args.includes('--insecure');
if(!origin||!serverId){console.error('usage: node tools/native/watch-players.mjs --origin <website> --server <id> [--bots n] [--prefix name] [--duration s] [--retry s] [--insecure]');process.exit(2);}
const out=o=>console.log(JSON.stringify({t:new Date().toISOString(),...o}));

// Before liteLib runs: every gateway message that carries text for the player goes to window.__said.
function tap(){
 window.__said=[];const Native=window.WebSocket;
 window.WebSocket=class extends Native{constructor(...a){super(...a);this.addEventListener('message',m=>{let e;try{e=JSON.parse(String(m.data));}catch{return;}
  if(e.type==='kicked'||e.type==='disconnected'||e.type==='denied'||e.type==='error'){window.__said.push({kind:e.type,text:e.reason??e.error??''});return;}
  if(e.type!=='rpc')return;const strings=(e.args?.values??[]).filter(v=>typeof v==='string');
  if(/Console|Chat|notice|popup/i.test(e.name??'')&&strings.length)window.__said.push({kind:e.name,text:strings.join(' | ')});});}};
}

const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||undefined,headless:true,args:['--mute-audio']});
const lite=await openLitePage(browser,{origin,ignoreHttpsErrors:insecure});
await lite.context.addInitScript(tap);await lite.page.reload({waitUntil:'load'});await lite.page.waitForFunction(()=>Boolean(window.__lite&&window.__said));
const names=Array.from({length:count},(_,i)=>`${prefix}-${i+1}`);
async function join(name,i){
 try{const r=await lite.page.evaluate(([n,s,id])=>window.__lite.join(n,{subject:s,name:s,serverId:id}),[i,name,serverId]);out({bot:name,event:'in-game',spawnMs:Math.round(r.spawnMs),position:r.position});return true;}
 catch(e){out({bot:name,event:'join-failed',error:String(e.message).slice(0,200)});return false;}
}
for(const [i,n] of names.entries())await join(n,i);
const end=Date.now()+duration*1000;let nextRetry=Date.now()+retry*1000;
while(Date.now()<end){
 await new Promise(r=>setTimeout(r,1000));
 const said=await lite.page.evaluate(()=>window.__said.splice(0)).catch(()=>[]);
 for(const s of said)out({event:'said',kind:s.kind,text:s.text});
 if(Date.now()>=nextRetry){nextRetry=Date.now()+retry*1000;
  const st=await lite.page.evaluate(()=>window.__lite.stats()).catch(()=>[]);
  for(const [i,n] of names.entries()){const b=st.find(x=>x.n===i);if(!b||!b.open||b.state==='closed')await join(n,i);}
 }
}
out({event:'done',stats:await lite.page.evaluate(()=>window.__lite.stats()).catch(()=>null)});
await browser.close();
