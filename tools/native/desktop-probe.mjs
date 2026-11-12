// A stand-in for the desktop game behind the loader, against a real server (CROSS-PLAY-TEST-PLAN.md stage 4, before the
// owner plays): the loader's own core (launcher/core.mjs) signs up or signs in, gets a desktop pass from the website and
// is admitted at the gateway's /desktop/admit; then a UlinkClient logs in to the game server natively with the ID and
// RLBD envelope the steam_api proxy would hand the game, as tests/desktop-launcher.test.mjs does against the mock.
// Rows: sign-up, sign-in, connect (the server's mapped ID, the game address), wrong ID refused, join approved, replay
// refused (in game, and again once the character has left), a second ticket refused while in game, sign-out kicks the
// character. One JSON line per row.
//   node tools/native/desktop-probe.mjs --central http://127.0.0.1:8080/ --server <id> [--native 127.0.0.1:29015]
//        [--gateway-ca gateway-cert.cer] [--login name --password-file f | --signup] [--hold 20]
// --gateway-ca trusts the gateway's self-signed certificate for this process only (DER or PEM). No browser is used.
import {createSocket} from 'node:dgram';
import {readFileSync} from 'node:fs';
import {request} from 'node:https';
import {randomBytes} from 'node:crypto';
import {UlinkClient} from '../../bridge/ulink/session.mjs';
import {createLauncher} from '../../launcher/core.mjs';

const args=process.argv.slice(2),opt=(n,d)=>{const i=args.indexOf('--'+n);return i>=0?args[i+1]:d;};
const centralUrl=opt('central'),serverId=opt('server'),[nativeHost,nativePort]=opt('native','127.0.0.1:29015').split(':');
const hold=Number(opt('hold','20')),caFile=opt('gateway-ca');
if(!centralUrl||!serverId){console.error('usage: node tools/native/desktop-probe.mjs --central <url> --server <id> [--native host:port] [--gateway-ca f] [--login name --password-file f | --signup] [--hold s]');process.exit(2);}
const out=o=>console.log(JSON.stringify({t:new Date().toISOString(),...o}));
let failed=0;const row=(name,pass,detail={})=>{if(!pass)failed++;out({row:name,result:pass?'pass':'fail',...detail});return pass;};
const within=(p,ms,what)=>Promise.race([p,new Promise((_,j)=>setTimeout(()=>j(Error(what+' timed out')),ms))]);

// The loader's host does its HTTP in C# with the Windows trust store; here a pinned CA for the gateway stands in.
let ca=null;
if(caFile){const b=readFileSync(caFile);ca=b.includes('-----BEGIN')?b.toString():`-----BEGIN CERTIFICATE-----\n${b.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;}
function fetchImpl(url,o={}){
 if(!ca||!String(url).startsWith('https:'))return fetch(url,o);
 return new Promise((resolve,reject)=>{
  const req=request(url,{method:o.method??'GET',headers:o.headers??{},ca},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode,ok:res.statusCode<300,text:async()=>text,json:async()=>JSON.parse(text)});});});
  req.on('error',reject);if(o.body)req.write(o.body);req.end();
 });
}
const host={token:null,login:null,launches:[],loadToken:async()=>host.token,saveToken:async t=>{host.token=t;},saveLogin:async l=>{host.login=l;},launchGame:async a=>{host.launches.push(a);},openUrl:()=>{}};
const core=createLauncher({centralUrl,host,fetchImpl,setTimer:()=>0,clearTimer:()=>{}});

// The game: one native login with what the proxy got. Resolves on approval or denial; keeps ticking until closed.
async function game({userId,ticket,name}){
 const socket=createSocket('udp4');await new Promise(r=>socket.bind(0,r));
 const client=new UlinkClient({now:()=>performance.now()/1000,login:{userId:BigInt(userId),name,ticket:new Uint8Array(ticket)},send:b=>socket.send(b,Number(nativePort),nativeHost)});
 socket.on('message',m=>client.receive(new Uint8Array(m)));
 const timer=setInterval(()=>client.tick(),5);
 const ended=new Promise(r=>client.on('closed',e=>r(String(e?.reason??e??'closed'))));
 const result=new Promise(r=>{client.on('approved',()=>r('approved'));client.on('denied',e=>r('denied:'+e));});
 client.start();
 let outcome;try{outcome=await within(result,15000,'login');}catch(e){outcome='no-answer';}
 return {outcome,ended,close(){clearInterval(timer);try{client.close();}catch{}socket.close();}};
}

const games=[];
try{
 if(args.includes('--signup')||!opt('login')){
  const name='Desk'+randomBytes(3).toString('hex'),password=randomBytes(18).toString('base64url');
  const ok=await core.register({email:`${name.toLowerCase()}@example.com`,username:name,password,remember:true,rememberLogin:true});
  if(!row('sign-up',ok,{name,error:core.state.error}))throw Error('stop');
  await core.signOut();
  row('sign-in',await core.signIn({login:name,password,remember:true}),{error:core.state.error});
 }else{
  const password=readFileSync(opt('password-file'),'utf8').trim();
  if(!row('sign-in',await core.signIn({login:opt('login'),password,remember:true}),{error:core.state.error}))throw Error('stop');
 }
 const listed=core.state.servers?.some(x=>x.id===serverId);
 if(!row('connect',await core.connect(serverId),{listed,error:core.state.error}))throw Error('stop');
 const {backendId,native}=core.state.connection;
 out({backendId,native,name:core.state.account?.name});
 if(!row('launch',await core.launch(),{error:core.state.error}))throw Error('stop');

 // A fresh envelope with someone else's ID: the adapter must refuse it.
 const other=await core.requestTicket();
 const wrong=await game({userId:'76561198000000001',ticket:Buffer.from(other?.envelope??'','base64'),name:'Wrong'});games.push(wrong);
 row('wrong-id-refused',wrong.outcome.startsWith('denied'),{outcome:wrong.outcome});
 const ticket=await core.requestTicket();
 if(!row('ticket',Boolean(ticket)&&ticket.backendId===backendId,{error:core.state.error,sameId:ticket?.backendId===backendId}))throw Error('stop');
 const envelope=Buffer.from(ticket.envelope,'base64');
 const g=await game({userId:backendId,ticket:envelope,name:core.state.account?.name??'Desktop'});games.push(g);
 if(!row('join',g.outcome==='approved',{outcome:g.outcome}))throw Error('stop');
 const replay=await game({userId:backendId,ticket:envelope,name:'Replay'});games.push(replay);
 row('replay-refused',replay.outcome.startsWith('denied'),{outcome:replay.outcome});
 const again=await core.requestTicket();
 row('no-second-ticket-in-game',again===null,{error:core.state.error});
 await new Promise(r=>setTimeout(r,hold*1000));
 row('still-in-game',await Promise.race([g.ended.then(e=>'ended: '+e),new Promise(r=>setTimeout(()=>r('connected'),10))])==='connected');
 // Sign-out while in game: central -> gateway -> adapter kicks the character (leaseKick), within about a minute.
 const t0=Date.now();await core.signOut();
 const end=await Promise.race([g.ended,new Promise(r=>setTimeout(()=>r(null),90000))]);
 row('sign-out-ends-session',end!==null,{reason:end,seconds:Math.round((Date.now()-t0)/1000)});
 // The replay above met the server's own duplicate-ID check (the character was still in game). With the character
 // gone, the same envelope must be refused by the adapter: its session was used once.
 const late=await game({userId:backendId,ticket:envelope,name:'Replay'});games.push(late);
 row('replay-after-leave-refused',late.outcome.startsWith('denied'),{outcome:late.outcome});
}catch(e){if(e.message!=='stop')row('error',false,{error:e.message});}
finally{for(const x of games)x.close();}
out({done:true,failed});
process.exit(failed?1:0);
