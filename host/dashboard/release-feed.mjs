// Updates page, Release feed: the signed feed's state, channel, "install automatically when the server is empty",
// Check for updates, and the releases with their notes. A release the host downloaded waits in "Ready to install",
// where the owner installs it the usual way. GET /api/feed.
const $=id=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v!=null&&v!==false)e.setAttribute(k,v);}e.append(...kids.flat().filter(x=>x!=null&&x!==false));return e;};
const size=b=>b<1048576?(b/1024).toFixed(0)+' KB':(b/1048576).toFixed(1)+' MB';
const PART={central:'Website',gateway:'Gateway',sidecar:'Sidecar',host:'Host app','server-adapter':'Server adapter'};

export function createFeedPanel({api,toast,span,serverNow,onStaged=()=>{}}){
 let dirty=false;
 $('feed-form').addEventListener('input',()=>{dirty=true;});
 const ago=t=>t?span(serverNow()-t)+' ago':'never';
 function render(d){
  $('feed-off').hidden=d.configured;$('feed-check').disabled=!d.configured||Boolean(d.busy);
  for(const id of ['feed-channel','feed-auto'])$(id).disabled=!d.configured;
  if(!dirty){$('feed-channel').value=d.channel;$('feed-auto').checked=d.autoInstall;}
  $('feed-facts').replaceChildren(...[['Installed',d.installed],...(d.configured?[['Feed',d.url],['Key',d.key],['Checked',ago(d.lastCheckAt)],['Result',d.lastError?d.lastError:d.lastOkAt?'signature verified':'not checked yet']]:[['Feed','off']])]
   .flatMap(([k,v])=>[el('dt',{text:k}),el('dd',{class:k==='Result'&&d.lastError?'bad':null,text:v})]));
  $('feed-published').textContent=d.publishedAt?'published '+new Date(d.publishedAt).toLocaleDateString():'';
  $('feed-releases').replaceChildren(...(d.releases.length?d.releases.map(r=>el('li',{},
   el('div',{class:'top'},el('b',{text:`${r.version}`}),el('span',{class:'mono muted',text:`${r.channel} · ${r.date??''} · ${size(r.size)}`})),
   r.notes?el('p',{class:'notes',text:r.notes}):null,
   el('div',{class:'kinds'},...r.parts.map(p=>el('span',{class:'tag',text:PART[p]??p}))),
   el('div',{class:'acts'},!r.newer?el('span',{class:'tag',text:'Installed or older'}):r.staged?el('span',{class:'tag browser',text:'Downloaded: ready to install'}):
    el('button',{class:'btn small',type:'button',text:'Download',onclick:async e=>{
     e.target.setAttribute('aria-busy','true');
     try{await api('/api/feed/download',{method:'POST',body:{version:r.version}});toast(`Downloaded ${r.version}; it is ready to install`);onStaged();load();}
     catch(x){toast(x.message,'error');}finally{e.target.removeAttribute('aria-busy');}}}))))
   :[el('li',{},el('span',{class:'empty muted',text:d.configured?'No releases on this channel yet.':'Releases appear here once a release feed is set up.'}))]));
 }
 async function load(){let d;try{d=await api('/api/feed');}catch(e){if(e.message!=='sign-in')toast('Could not load the release feed: '+e.message,'error');return;}render(d);}
 $('feed-check').addEventListener('click',async e=>{
  e.target.setAttribute('aria-busy','true');
  try{const d=await api('/api/feed/check',{method:'POST',body:{}});render(d);const n=d.releases.find(r=>r.newer);toast(n?`${n.version} is available${n.staged?' and ready to install':''}`:'You have the newest release');onStaged();}
  catch(x){toast(x.message,'error');load();}finally{e.target.removeAttribute('aria-busy');}
 });
 $('feed-form').addEventListener('submit',async e=>{
  e.preventDefault();
  try{render(await api('/api/feed/settings',{method:'POST',body:{channel:$('feed-channel').value,autoInstall:$('feed-auto').checked}}));dirty=false;toast('Release feed settings saved');load();}
  catch(x){toast(x.message,'error');}
 });
 return {load};
}
