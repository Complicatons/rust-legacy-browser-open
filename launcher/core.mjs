// Desktop launcher core (DESKTOP-LAUNCHER-PLAN.md): website sign-in, connect to one server, launch the player's own
// game, keep the heartbeat lease while it runs, hand the steam_api proxy a fresh envelope at each native connect.
// UI-free and host-free so it runs the same in the WebView2 window (launcher/ui) and in node tests.
//
// host: {loadToken(), saveToken(token|null), saveLogin(login|null), hardwareId() → "v1:…", launchGame({server, native,
//   backendId, name}) → Promise, openUrl(url)}. saveLogin and hardwareId are optional.
//   The Windows host (launcher/host) keeps the token with DPAPI, the remembered login name in its settings (never the
//   password), computes the hardware ID (DESKTOP-LAUNCHER-PLAN.md "Hardware ID"), starts rust.exe through the proxy
//   profile, calls gameExited() when it exits and requestTicket() when the proxy asks for one over its pipe.
// fetchImpl: the host's HTTP (no browser CORS or cookies); resolveAdmitUrl lets tests point at a local gateway.

export const PHASES=['starting','signed-out','signing-in','signing-up','device','signed-in','connecting','connected','launching','in-game','signing-out'];
const HEARTBEAT_FALLBACK_S=15;
// Short, player-facing text for every refusal central or the gateway can send.
export const REASONS={
 'invalid-credentials':'That username or password is not right.','account-locked':'Too many tries. Wait 15 minutes, then sign in again.',
 'account-suspended':'This account is suspended.','rate-limited':'Too many attempts. Wait a minute.','sign-in-required':'Your sign-in ended. Sign in again.',
 'server-offline':'That server is offline right now.','unknown-server':'That server is no longer listed.','banned':'You are banned from this server.',
 'account-too-new':'This server needs an older account.','steam-required':'This server needs a Steam sign-in linked to your account.',
 'in-use-elsewhere':'Your account is already in this server from another launcher.','already-connected':'Your character is already in this server.',
 'no-identity':'This server has no character for you yet. Ask its owner, or link your desktop character with /browserlink.',
 'group-whitelist':'This server only admits its Steam group.','desktop-disabled':'This server does not support the launcher yet.',
 'conflict':'Your account and this character are linked to someone else.','expired-code':'The code expired. Start again.',
 'network':'Cannot reach the website. Check your connection.','gateway-unreachable':'Cannot reach that server. It may be offline.',
 'no-lease':'Connect to the server again.','game-not-found':'Choose your Rust Legacy folder first.',
 // Sign-up (central/accounts.mjs register, the website's rules) and the one-account-per-person checks.
 'invalid-email':'Enter an email address like name@example.com.','email-taken':'An account already uses that email. Sign in instead.',
 'disposable-email':'Throwaway email addresses cannot be used. Use your own email.',
 'invalid-username':'Use 3–20 letters, numbers, _ or -, starting with a letter or number.','reserved-username':'That username is reserved. Try another.',
 'username-taken':'That username is taken. Try another.','password-too-short':'Use at least 8 characters for your password.',
 'password-too-long':'Use 128 characters or fewer for your password.','password-matches-name':'Your password cannot be your username or email.',
 'identity-banned':'This account or PC is linked to a banned account.','held-for-review':'This account shares a PC with a banned account, so staff will check it first.',
 'invalid-hwid':'This PC could not be identified. Restart the launcher and try again.','phone-required':'This server asks for a verified phone. Add one on the website.',
};
export const reasonText=code=>REASONS[code]??'Something went wrong ('+String(code??'unknown')+').';

export function createLauncher({centralUrl,host,fetchImpl=fetch,resolveAdmitUrl=u=>u,setTimer=setTimeout,clearTimer=clearTimeout,device='Desktop launcher'}){
 const listeners=new Set();
 let token=null,heartbeat=null,devicePoll=null,hwid=null;
 // Asked of the host once; a host without one (browser demo) or a failure just leaves the field out.
 const hardware=async()=>{hwid??=Promise.resolve().then(()=>host.hardwareId?.()).catch(()=>null);const v=await hwid;return v?{hwid:v}:{};};
 const state={phase:'starting',account:null,servers:[],connection:null,error:null,device:null,lastBeat:null};
 const emit=()=>{for(const f of listeners)f(state);};
 const set=patch=>{Object.assign(state,patch);emit();};
 class LauncherError extends Error{constructor(code){super(code);this.code=code;}}
 async function call(method,path,data,{auth=true}={}){
  let res;
  try{res=await fetchImpl(new URL(path,centralUrl).href,{method,headers:{...(data!==undefined?{'content-type':'application/json'}:{}),...(auth&&token?{authorization:'Bearer '+token}:{})},body:data!==undefined?JSON.stringify(data):undefined});}
  catch{throw new LauncherError('network');}
  const body=await res.json().catch(()=>({}));
  if(res.status===401&&auth){await dropSession();throw new LauncherError('sign-in-required');}
  if(res.status>=400)throw new LauncherError(body.error??body.reason??'http-'+res.status);
  return body;
 }
 // undefined leaves the remembered name alone (the device-code path has none to offer).
 async function keepLogin(remember,login){if(remember!==undefined)await host.saveLogin?.(remember?login:null);}
 async function dropSession(){stopHeartbeat();token=null;await host.saveToken?.(null);set({phase:'signed-out',account:null,servers:[],connection:null});}
 const fail=(e,phase)=>{set({error:e instanceof LauncherError?e.code:'internal',...(phase?{phase}:{})});return false;};
 async function signedIn(data,remember){
  token=data.token;if(remember)await host.saveToken?.(token);
  set({phase:'signed-in',account:{player:data.player,name:data.name},error:null,device:null});
  await launcher.refreshServers();
  return true;
 }
 // Gateway admission: a one-use pass from central, redeemed by that server's gateway for a pending native admission.
 async function admit(serverId){
  const p=await call('POST',`/desktop/servers/${serverId}/pass`,await hardware());
  let res;
  try{res=await fetchImpl(resolveAdmitUrl(p.admitUrl),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pass:p.pass})});}
  catch{throw new LauncherError('gateway-unreachable');}
  const g=await res.json().catch(()=>({}));
  if(res.status!==200)throw new LauncherError(g.error??'gateway-'+res.status);
  if(!/^\d{1,20}$/.test(String(g.backendId))||typeof g.envelope!=='string')throw new LauncherError('gateway-malformed');
  return {server:p.server,heartbeatSeconds:p.heartbeatSeconds??HEARTBEAT_FALLBACK_S,backendId:String(g.backendId),envelope:g.envelope,native:g.native,name:g.name??state.account?.name};
 }
 function stopHeartbeat(){if(heartbeat){clearTimer(heartbeat);heartbeat=null;}}
 function scheduleHeartbeat(seconds){
  stopHeartbeat();
  heartbeat=setTimer(async()=>{heartbeat=null;await launcher.beat();if(state.connection)scheduleHeartbeat(seconds);},seconds*1000);
 }
 const launcher={
  state,
  on(f){listeners.add(f);return ()=>listeners.delete(f);},
  // Starts with a remembered token (DPAPI on Windows) when there is one.
  async restore(){
   token=await host.loadToken?.()??null;
   if(!token){set({phase:'signed-out'});return false;}
   try{const me=await call('GET','/desktop/me');return signedIn({token,player:me.player,name:me.name},false);}
   catch(e){if(e.code!=='sign-in-required')token=null;return fail(e,'signed-out');}
  },
  // remember: "Keep me signed in" (the token, DPAPI). rememberLogin: "Remember my email or username" (the name as typed
  // goes to the host's settings to prefill next time; unticked forgets it). Neither ever keeps the password.
  async signIn({login,password,remember=false,rememberLogin}){
   if(!String(login??'').trim()||!password)return fail(new LauncherError('invalid-credentials'));
   set({phase:'signing-in',error:null});
   try{const data=await call('POST','/desktop/login',{login,password,device,...await hardware()},{auth:false});await keepLogin(rememberLogin,String(login).trim());return await signedIn(data,remember);}
   catch(e){return fail(e,'signed-out');}
  },
  // New players: a website account made from the launcher (POST /desktop/register, the website's own rules), then
  // signed in as above. The username is what "Remember my email or username" keeps.
  async register({email,username,password,remember=false,rememberLogin}){
   email=String(email??'').trim();username=String(username??'').trim();
   const gap=!email?'invalid-email':!username?'invalid-username':String(password??'').length<8?'password-too-short':null;
   if(gap)return fail(new LauncherError(gap));
   set({phase:'signing-up',error:null});
   try{const data=await call('POST','/desktop/register',{email,username,password,device,...await hardware()},{auth:false});await keepLogin(rememberLogin,username);return await signedIn(data,remember);}
   catch(e){return fail(e,'signed-out');}
  },
  // Steam/Discord accounts: show a code, the player approves it on the website, the launcher polls until it is used.
  async startDevice({remember=false}={}){
   set({phase:'device',error:null});
   try{
    const d=await call('POST','/desktop/device',{device},{auth:false});
    set({device:{userCode:d.userCode,url:new URL(d.verificationPath,centralUrl).href,expiresAt:Date.now()+d.expiresInSeconds*1000}});
    const poll=async()=>{
     devicePoll=null;if(state.phase!=='device')return;
     try{const r=await call('POST','/desktop/device/token',{deviceCode:d.deviceCode,...await hardware()},{auth:false});
      if(r.status==='approved')return signedIn(r,remember);
      devicePoll=setTimer(poll,(r.intervalSeconds??3)*1000);}
     catch(e){fail(e,'signed-out');set({device:null});}
    };
    devicePoll=setTimer(poll,d.intervalSeconds*1000);return true;
   }catch(e){return fail(e,'signed-out');}
  },
  cancelDevice(){if(devicePoll){clearTimer(devicePoll);devicePoll=null;}set({phase:'signed-out',device:null});},
  async refreshServers(){try{set({servers:(await call('GET','/desktop/servers')).servers});return true;}catch(e){return fail(e);}},
  // Connect: proves the account can join (pass + gateway admission) and learns this server's character ID. The envelope
  // from this check is dropped; the game asks for a fresh one when it connects (requestTicket).
  async connect(serverId){
   set({phase:'connecting',error:null});
   try{
    const a=await admit(serverId);
    set({phase:'connected',connection:{server:a.server,backendId:a.backendId,native:a.native,name:a.name,heartbeatSeconds:a.heartbeatSeconds}});
    scheduleHeartbeat(a.heartbeatSeconds);return true;
   }catch(e){return fail(e,'signed-in');}
  },
  async disconnect(){stopHeartbeat();const was=state.connection;set({phase:'signed-in',connection:null});if(was)await call('POST','/desktop/heartbeat',{state:'idle'}).catch(()=>{});},
  async launch(){
   const c=state.connection;if(!c||state.phase!=='connected')return false;
   set({phase:'launching',error:null});
   try{await host.launchGame({server:c.server,native:c.native,backendId:c.backendId,name:c.name});}
   catch(e){return fail(new LauncherError(e?.code??'launch-failed'),'connected');}
   set({phase:'in-game'});await launcher.beat();return true;
  },
  // The proxy asks inside the game's DoConnect (the server waits up to 10 s): a fresh pass and envelope every time.
  async requestTicket(){
   const c=state.connection;if(!c)return null;
   try{const a=await admit(c.server.id);set({connection:{...c,backendId:a.backendId,native:a.native}});return {backendId:a.backendId,envelope:a.envelope,name:a.name};}
   catch(e){fail(e);return null;}
  },
  async gameExited(){if(state.phase!=='in-game'&&state.phase!=='launching')return;set({phase:'connected'});await launcher.beat();},
  // One heartbeat now. A refused lease (ban, other launcher, server gone) drops the connection with the reason.
  async beat(){
   const c=state.connection;if(!c)return;
   try{await call('POST','/desktop/heartbeat',{serverId:c.server.id,state:state.phase==='in-game'?'in-game':'connected'});set({lastBeat:Date.now()});}
   catch(e){if(e.code==='network'){set({error:'network'});return;} // keep trying: the lease survives 60 s
    stopHeartbeat();if(state.phase!=='signed-out')set({connection:null,phase:'signed-in'});fail(e);}
  },
  async signOut(){
   stopHeartbeat();set({phase:'signing-out'});
   await call('POST','/desktop/signout',{}).catch(()=>{});
   await dropSession();return true;
  },
 };
 return launcher;
}
