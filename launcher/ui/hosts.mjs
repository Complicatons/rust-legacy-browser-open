// Hosts for the launcher UI. In the Windows app (launcher/host) the page talks to C# over WebView2 messages: HTTP goes
// through the host (no browser CORS, no cookies), the token is kept with DPAPI, the game is started and watched there,
// and the steam_api proxy's ticket requests arrive as events. In a plain browser (?demo) everything is simulated.

// WebView2: {id, method, params} → {id, result} | {id, error}; host events: {event, ...}.
export function webviewHost(){
 const view=window.chrome.webview,waiting=new Map(),handlers={};let next=1;
 view.addEventListener('message',e=>{
  const m=e.data;
  if(m?.event){handlers[m.event]?.(m);return;}
  const w=waiting.get(m?.id);if(!w)return;waiting.delete(m.id);
  if(m.error)w.reject(Object.assign(Error(m.error),{code:m.error}));else w.resolve(m.result);
 });
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=next++;waiting.set(id,{resolve,reject});view.postMessage({id,method,params});});
 return {
  demo:false,
  centralUrl:null, // from the host's settings (host.settings())
  settings:()=>call('settings'),
  fetch:async(url,{method='GET',headers={},body}={})=>{const r=await call('fetch',{url,method,headers,body:body??null});return {status:r.status,json:async()=>JSON.parse(r.body||'{}')};},
  loadToken:()=>call('loadToken'),
  saveToken:token=>call('saveToken',{token}),
  // "Remember my email or username": kept in the host's settings.json (null forgets it). Never a password.
  saveLogin:login=>call('saveLogin',{login}),
  // DESKTOP-LAUNCHER-PLAN.md "Hardware ID": "v1:" + 43 characters, computed by the host (raw IDs stay on the PC).
  hardwareId:()=>call('hardwareId'),
  launchGame:a=>call('launchGame',a),
  chooseGameFolder:()=>call('chooseGameFolder'),
  openUrl:url=>call('openUrl',{url}),
  // UI state for the tray icon's tooltip and menu.
  report:state=>view.postMessage({method:'state',params:state}),
  answerTicket:(requestId,ticket)=>view.postMessage({method:'ticket',params:{requestId,ticket}}),
  on:(event,f)=>{handlers[event]=f;},
 };
}

// Browser demo: a simulated website and gateway, so the window can be tried and reviewed without either.
export function demoHost(){
 const servers=[
  {id:'5d1e0f5a-8b2c-4c1e-9f00-1a2b3c4d5e01',name:'Pilot',region:'eu',online:true,players:12,capacity:50,wipe:'2026-10-16'},
  {id:'5d1e0f5a-8b2c-4c1e-9f00-1a2b3c4d5e02',name:'Hapis Nights',region:'us-east',online:true,players:31,capacity:60,wipe:'2026-10-20'},
  {id:'5d1e0f5a-8b2c-4c1e-9f00-1a2b3c4d5e03',name:'Classic 2014',region:'eu',online:false,players:null,capacity:40,wipe:null},
 ];
 // The remembered login survives a reload of the demo page (best effort: storage can be blocked).
 const store={get(){try{return localStorage.getItem('rlb-demo-login');}catch{return null;}},set(v){try{v?localStorage.setItem('rlb-demo-login',v):localStorage.removeItem('rlb-demo-login');}catch{}}};
 let token=null;const handlers={},pause=ms=>new Promise(r=>setTimeout(r,ms));
 // Sign-up as central answers it (central/accounts.mjs register, central/passwords.mjs rules), with two names taken.
 const taken=['rook','survivor'],reserved=['admin','administrator','moderator','mod','staff','support','system','root','facepunch','rustlegacy','null','undefined'];
 function signUp({email='',username='',password=''}){
  const e=email.trim(),u=username.trim(),p=password;
  const bad=!(e.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))?'invalid-email':!/^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$/.test(u)?'invalid-username':reserved.includes(u.toLowerCase())?'reserved-username':
   p.length<8?'password-too-short':p.length>128?'password-too-long':[u.toLowerCase(),e.toLowerCase()].includes(p.toLowerCase())?'password-matches-name':null;
  if(bad)return reply(400,{error:bad});
  if(taken.includes(u.toLowerCase()))return reply(409,{error:'username-taken'});
  if(/@(.+\.)?mailinator\.com$/i.test(e))return reply(400,{error:'disposable-email'});
  taken.push(u.toLowerCase());
  return reply(200,{token:'demo',player:'p2',name:u,heartbeatSeconds:15});
 }
 const reply=(status,data)=>({status,json:async()=>data});
 async function fetchImpl(url,{method='GET',body}={}){
  const path=new URL(url).pathname,b=body?JSON.parse(body):{};
  await pause(path.endsWith('heartbeat')?120:650+Math.random()*350);
  if(path==='/desktop/login')return b.password==='demo'||b.password?.length>=8?reply(200,{token:'demo',player:'p1',name:String(b.login).split('@')[0]||'Survivor',heartbeatSeconds:15}):reply(401,{error:'invalid-credentials'});
  if(path==='/desktop/register')return signUp(b);
  if(path==='/desktop/device')return reply(200,{deviceCode:'d',userCode:'K7QM-3XPA',verificationPath:'/desktop/approve',intervalSeconds:3,expiresInSeconds:600});
  if(path==='/desktop/device/token')return reply(200,{status:'pending',intervalSeconds:3});
  if(path==='/desktop/me')return reply(200,{player:'p1',name:'Survivor'});
  if(path==='/desktop/servers')return reply(200,{servers});
  if(path.endsWith('/pass')){const s=servers.find(x=>path.includes(x.id));return s.online?reply(200,{pass:'demo',admitUrl:'https://gateway.demo/desktop/admit',server:{id:s.id,name:s.name},heartbeatSeconds:15}):reply(409,{error:'server-offline'});}
  if(path==='/desktop/admit')return reply(200,{backendId:'90000000004821733',envelope:'UkxCRAE=',native:{host:'pilot.rustlegacy.example',port:28015},expiresInSeconds:30});
  if(path==='/desktop/heartbeat'||path==='/desktop/signout')return reply(200,{ok:true});
  return reply(404,{error:'not-found'});
 }
 return {
  demo:true,centralUrl:'https://play.demo/',
  settings:async()=>({centralUrl:'https://play.demo/',gameFolder:'D:\\Games\\Rust Legacy',login:store.get()}),
  fetch:fetchImpl,
  loadToken:async()=>token,saveToken:async t=>{token=t;},
  saveLogin:async l=>store.set(l),
  hardwareId:async()=>'v1:'+'demo'.repeat(11).slice(0,43),
  launchGame:async()=>{await pause(900);},
  chooseGameFolder:async()=>'D:\\Games\\Rust Legacy',
  openUrl:async url=>{window.open(url,'_blank','noopener');},
  report:()=>{},answerTicket:()=>{},
  on:(event,f)=>{handlers[event]=f;},
  // Demo controls (console): end the game as if rust.exe exited.
  exitGame:()=>handlers.gameExited?.({}),
 };
}
