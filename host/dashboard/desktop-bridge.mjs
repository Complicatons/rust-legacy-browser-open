// The desktop app's bridge (host/desktop, HOST-AND-LOADER-BUILD.md A1): the dashboard page and the C# window talk over
// WebView2 messages only. Nothing here goes through the service's HTTP API, which has no shell or command route.
//   page → app  {id, method, params}   (calls: the app answers {id, result} | {id, error})
//   page → app  {method, params}       (notices: no answer)
//   app → page  {event, ...}
// The app accepts messages only from the dashboard's own origin (http://127.0.0.1:<port>) and only these methods.
// tests/host-desktop.test.mjs pins both sides: every method below is a `case` in host/desktop/MainForm.cs, and every
// event the app posts is one the page listens for.
export const BRIDGE={
 calls:['app.info','app.token','terminal.open','terminal.close'],
 notices:['terminal.input','terminal.resize','tray.state'],
 events:['terminal.data','terminal.exit','tray.action'],
 shells:['powershell','cmd'],
 // Tray icon states (MainForm.TrayState): the page derives them from /api/status and the SSE stream.
 trayStates:['running','starting','stopped','crashed','failed','frozen','offline'],
};

// WebView2 (window.chrome.webview). app.info → {version, port, dataDir, root, user, machine};
// app.token → {token} or an error code (token-unreadable, listener-unverified) with the reason in `message`.
export function desktopBridge(view=window.chrome.webview){
 const waiting=new Map(),handlers={};let next=1;
 view.addEventListener('message',e=>{
  const m=e.data;
  if(m?.event){for(const f of handlers[m.event]??[])f(m);return;}
  const w=waiting.get(m?.id);if(!w)return;waiting.delete(m.id);
  if(m.error)w.reject(Object.assign(Error(m.message||m.error),{code:m.error}));else w.resolve(m.result);
 });
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=next++;waiting.set(id,{resolve,reject});view.postMessage({id,method,params});});
 const notice=(method,params)=>view.postMessage({method,params});
 return {
  kind:'desktop',
  info:()=>call('app.info'),
  token:()=>call('app.token'),
  open:({shell,cols,rows})=>call('terminal.open',{shell,cols,rows}),
  close:tid=>call('terminal.close',{tid}),
  input:(tid,data)=>notice('terminal.input',{tid,data}),
  resize:(tid,cols,rows)=>notice('terminal.resize',{tid,cols,rows}),
  trayState:(state,text)=>notice('tray.state',{state,text}),
  on:(event,f)=>{(handlers[event]??=[]).push(f);},
 };
}

// Browser preview of the desktop app (tools/check-host-dashboard.mjs injects it with window.RLB_DEMO_BRIDGE): a fake
// shell that answers a few commands, so the PowerShell and CMD tabs can be seen and checked without Windows. It says
// what it is in its first line. It never runs anything.
export function demoBridge(){
 const handlers={},shells=new Map();let next=1;
 const emit=(event,data)=>{for(const f of handlers[event]??[])setTimeout(()=>f({event,...data}),0);};
 const out=(tid,data)=>emit('terminal.data',{tid,data});
 const ROOT='C:\\RLB-host';
 const listing=['config','data','logs','run','secrets','server'].map(n=>`d-----        24/10/2026     09:12                ${n}`).join('\r\n');
 const ps={
  banner:'\x1b[33mDemo shell (browser preview).\x1b[0m The desktop app opens a real PowerShell here, as your Windows account.\r\n\r\n',
  prompt:()=>`PS ${ROOT}> `,
  run(line){
   const [cmd,...rest]=line.trim().split(/\s+/),c=(cmd??'').toLowerCase();
   if(!c)return '';
   if(['dir','ls','get-childitem','gci'].includes(c))return `\r\n    Directory: ${ROOT}\r\n\r\nMode                 LastWriteTime         Length Name\r\n----                 -------------         ------ ----\r\n${listing}\r\n\r\n`;
   if(c==='get-service')return '\r\nStatus   Name               DisplayName\r\n------   ----               -----------\r\n\x1b[32mRunning\x1b[0m  RustLegacyHost     Rust Legacy Host\r\n\r\n';
   if(c==='whoami')return 'demo-pc\\owner\r\n';
   if(c==='echo'||c==='write-host'||c==='write-output')return rest.join(' ')+'\r\n';
   if(c==='cls'||c==='clear'||c==='clear-host')return '\x1b[2J\x1b[H';
   return `\x1b[31m${cmd}: The term '${cmd}' is not recognized in the demo shell. Try dir, Get-Service, whoami or exit.\x1b[0m\r\n`;
  },
 };
 const cmd={
  banner:'Demo shell (browser preview). The desktop app opens a real Command Prompt here, as your Windows account.\r\n\r\n',
  prompt:()=>`${ROOT}>`,
  run(line){
   const [c0,...rest]=line.trim().split(/\s+/),c=(c0??'').toLowerCase();
   if(!c)return '';
   if(c==='dir')return ` Directory of ${ROOT}\r\n\r\n`+['config','data','logs','run','secrets','server'].map(n=>`24/10/2026  09:12    <DIR>          ${n}`).join('\r\n')+'\r\n\r\n';
   if(c==='whoami')return 'demo-pc\\owner\r\n';
   if(c==='echo')return rest.join(' ')+'\r\n';
   if(c==='cls')return '\x1b[2J\x1b[H';
   return `'${c0}' is not recognized in the demo shell. Try dir, whoami or exit.\r\n`;
  },
 };
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 return {
  kind:'demo',
  info:async()=>({version:'demo',port:Number(location.port)||80,dataDir:'C:\\ProgramData\\Rust Legacy Host',root:ROOT,user:'owner',machine:'DEMO-PC'}),
  token:async()=>{throw Object.assign(Error('The browser preview has no owner token.'),{code:'token-unreadable'});},
  async open({shell}){
   if(!BRIDGE.shells.includes(shell))throw Object.assign(Error('unknown shell'),{code:'bad-request'});
   await pause(120);
   const tid=next++,s={kind:shell==='cmd'?cmd:ps,line:''};shells.set(tid,s);
   out(tid,s.kind.banner+s.kind.prompt());
   return {tid};
  },
  input(tid,data){
   const s=shells.get(tid);if(!s)return;
   for(const ch of data){
    if(ch==='\r'){
     const line=s.line;s.line='';
     if(/^\s*exit\s*$/i.test(line)){out(tid,'\r\n');shells.delete(tid);emit('terminal.exit',{tid,code:0});return;}
     out(tid,'\r\n'+s.kind.run(line)+s.kind.prompt());
    }else if(ch==='\x7f'){if(s.line){s.line=s.line.slice(0,-1);out(tid,'\b \b');}}
    else if(ch==='\x03'){s.line='';out(tid,'^C\r\n'+s.kind.prompt());}
    else if(ch>=' '){s.line+=ch;out(tid,ch);}
   }
  },
  resize(){},
  async close(tid){shells.delete(tid);return null;},
  trayState(){},
  on:(event,f)=>{(handlers[event]??=[]).push(f);},
 };
}

// The bridge for this page: the desktop app's, the injected demo, or none (a plain browser: no shell tabs at all).
export function pickBridge(w=globalThis){
 if(w.chrome?.webview)return desktopBridge(w.chrome.webview);
 if(w.RLB_DEMO_BRIDGE===true)return demoBridge();
 return null;
}
