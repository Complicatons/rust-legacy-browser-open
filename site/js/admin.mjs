// Server admin console (central/admin.mjs API; same origin, session cookie + CSRF header). Every action is recorded in
// the central audit log; the page only renders what the API allows for the caller's role.
const $=s=>document.querySelector(s);
const RANK={moderator:1,admin:2,owner:3,staff:4};
const ERRORS={'player-offline':'That player is not on the server right now.','screenshot-pending':'A screenshot of that player is already on its way.','screenshot-too-soon':'Wait 30 seconds between screenshots of one player.','unknown-hold':'That hold no longer applies.','invalid-domain':'Enter a domain like example.com.','staff-only':'Only site staff can do that.','already-resolved':'That was already handled.','server-offline':'The server gateway is not reporting right now.','message-required':'Write the message to send.','invalid-policy':'Enter 0–720 hours.','native-needs-server-scope':'Only server bans can be copied to the game server ban list.','insufficient-role':'Your role does not allow that.','target-outranks-you':'That account has an equal or higher role on this server.','cannot-target-self':'You cannot act on your own account.','reason-required':'Give a reason; it is recorded in the audit log.','unknown-player':'Unknown account id.','already-revoked':'That ban was already lifted.','csrf':'Your session expired. Reload the page.','unbannable-ip':'Private and local addresses can\'t be banned: every browser player comes through the gateway\'s.','range-too-wide':'A range can be at most /16 (IPv4) or /32 (IPv6).','invalid-ip':'Enter an IP address, or a range like 203.0.113.0/24.','no-ips':'No addresses seen for that player on this server in the last 30 days.','unknown-ban':'That ban no longer exists.','sign-in-required':'Please sign in on the main page.'};
let me=null,servers=[],current=null,target=null,refresh=null;

function notice(text,kind='info'){const n=$('#notice');n.textContent=text;n.dataset.kind=kind;n.hidden=!text;}
async function api(method,path,data){
 const headers={};if(data!==undefined)headers['content-type']='application/json';if(me?.csrf&&method!=='GET')headers['x-csrf-token']=me.csrf;
 const res=await fetch(path,{method,headers,body:data!==undefined?JSON.stringify(data):undefined,credentials:'same-origin'});
 const body=await res.json().catch(()=>({}));
 if(!res.ok)throw Object.assign(new Error(body.error??res.status),{code:body.error});
 return body;
}
const explain=e=>ERRORS[e.code]??`Request failed (${e.code??e.message}).`;
const el=(tag,props={},...children)=>{const n=document.createElement(tag);Object.assign(n,props);n.append(...children.filter(c=>c!=null));return n;};
const when=t=>t?new Date(t).toLocaleString():'—';
const button=(label,onclick,secondary=true)=>el('button',{type:'button',className:secondary?'secondary small':'small',textContent:label,onclick});
const can=min=>RANK[current?.role]>=RANK[min];
// Site staff (the Rust Legacy team, every server) reads differently from the roles an owner gives on one server.
const ROLE_NAME={staff:'Site staff',owner:'Server owner',admin:'Server admin',moderator:'Moderator'};
const base=()=>`/admin/servers/${current.id}`;

async function start(){
 try{me=await api('GET','/me');}catch{me=null;}
 let list={servers:[]};
 if(me)try{list=await api('GET','/admin/servers');}catch{}
 for(const id of ['#my-id','#my-id-2'])$(id).textContent=me?.player??'(not signed in)';
 servers=list.servers;
 if(!servers.length){$('#no-access').hidden=false;document.body.dataset.ready='1';return;}
 $('#console').hidden=false;
 $('#server').replaceChildren(...servers.map(s=>el('option',{value:s.id,textContent:`${s.name} (${ROLE_NAME[s.role]??s.role})`})));
 $('#server').onchange=()=>select($('#server').value);
 // /admin?server=<id> (from the owner page) opens that server when the caller has a role on it.
 const want=new URLSearchParams(location.search).get('server');
 await select(servers.some(s=>s.id===want)?want:servers[0].id);$('#server').value=current.id;
 document.body.dataset.ready='1';
}

async function select(id){
 current=servers.find(s=>s.id===id);target=null;$('#action').hidden=true;$('#evidence').hidden=true;
 $('#role').textContent=ROLE_NAME[current.role]??current.role;
 for(const o of document.querySelectorAll('[data-min]'))o.disabled=!can(o.dataset.min);
 $('#roles-panel').hidden=$('#audit-panel').hidden=$('#ip-bans-panel').hidden=!can('admin');$('#ip-lookup').replaceChildren();
 clearInterval(refresh);refresh=setInterval(()=>Promise.all([loadPlayers(),loadCommands(),loadShots(),loadTransfers()]).catch(()=>{}),5000);
 $('#policy-form').querySelector('button').disabled=!can('admin');
 $('#domains-panel').hidden=current.role!=='staff';
 await Promise.all([loadPlayers(),loadBans(),loadReports(),loadCommands(),loadPolicy(),loadShots(),loadHolds(),loadTransfers(),current.role==='staff'?loadDomains():null,can('admin')?loadIpBans():null,can('admin')?loadRoles():null,can('admin')?loadAudit():null]);
}

async function loadPlayers(){
 const r=await api('GET',`${base()}/players`);
 $('#roster-state').textContent=r.online?`gateway reported ${Math.round((Date.now()-r.reportedAt)/1000)} s ago`:'gateway offline';
 $('#no-players').hidden=r.players.length>0;
 $('#players tbody').replaceChildren(...r.players.map(p=>{
  const flags=Object.entries(p.flags??{}).map(([k,n])=>`${k} ×${n}`).join(', ')||'—';
  const row=el('tr',{className:p.review?'review':''},
   el('td',{},el('strong',{textContent:p.name}),el('br'),el('code',{className:'meta',textContent:p.player})),
   el('td',{textContent:String(p.score)}),el('td',{textContent:flags}),el('td',{textContent:when(p.connectedAt)}),
   el('td',{textContent:p.banned?'banned':p.review?'review':'ok'}),
   el('td',{},el('div',{className:'actions row-actions'},button('Evidence',()=>showEvidence(p.player,p.name)),button('Screenshot',()=>screenshot(p)),button('Kick',()=>openAction(p,'kick')),button('Ban',()=>openAction(p,'ban')),button('Go to',()=>openAction(p,'teleport-to')))));
  row.dataset.player=p.player;return row;
 }));
 const desktop=r.desktop??[];
 $('#no-desktop').hidden=desktop.length>0;
 $('#desktop tbody').replaceChildren(...desktop.map(p=>{
  const t={name:p.name,handle:p.handle,player:p.player??undefined,desktop:true};
  const flags=Object.entries(p.flags??{}).map(([k,n])=>`${k} ×${n}`).join(', ')||'—';
  const row=el('tr',{className:p.review?'review':''},el('td',{},el('strong',{textContent:p.name})),el('td',{textContent:p.account??'not linked'}),
   el('td',{textContent:String(p.score??0)}),el('td',{textContent:flags}),el('td',{textContent:p.banned?'banned':p.review?'review':'ok'}),
   el('td',{},el('div',{className:'actions row-actions'},button('Evidence',()=>showEvidence(null,p.name,p.handle)),button('Message',()=>openAction(t,'message')),button('Go to',()=>openAction(t,'teleport-to')),button('Kick',()=>openAction(t,'kick')),can('admin')?button('Ban',()=>openAction(t,'ban')):null)));
  row.dataset.handle=p.handle;return row;
 }));
}

function openAction(p,kind){
 target=p;const f=$('#action-form');f.reset();f.kind.value=kind;f.minutes.value=can('admin')?'':'60';
 $('#action-target').textContent=p.desktop?`${p.name} (desktop)`:`${p.name} (${p.player})`;$('#action').hidden=false;syncAction();f.reason.focus();
}
const IN_GAME=new Set(['teleport-to','bring','message']);
function syncAction(){
 const f=$('#action-form'),kind=f.kind.value;
 for(const n of document.querySelectorAll('.ban-only'))n.hidden=kind!=='ban';
 for(const n of document.querySelectorAll('.message-only'))n.hidden=kind!=='message';
 for(const n of document.querySelectorAll('.in-game-only'))n.hidden=!IN_GAME.has(kind);
 for(const n of document.querySelectorAll('.account-only'))if(target?.desktop)n.hidden=true;
 for(const n of document.querySelectorAll('.desktop-only'))n.hidden=!target?.desktop;
 $('.reason-field').hidden=IN_GAME.has(kind);f.reason.required=!IN_GAME.has(kind);f.message.required=kind==='message';
 f.native.disabled=f.scope.value!=='server';if(f.native.disabled)f.native.checked=false;
}
$('#action-form').scope.onchange=syncAction;
$('#action-form').kind.onchange=syncAction;
$('#action-cancel').onclick=()=>{$('#action').hidden=true;target=null;};
$('#action-form').onsubmit=async e=>{
 e.preventDefault();const f=e.target;if(!target)return;
 try{
  // Desktop players are addressed by handle; kick and ban become the game server's own kick and ban list.
  const who=target.desktop?{handle:target.handle}:{player:target.player};
  if(target.desktop&&!IN_GAME.has(f.kind.value)){await api('POST',`${base()}/command`,{...who,action:f.kind.value==='kick'?'kick-native':'ban-native',reason:f.reason.value});notice(`Sent to the game server for ${target.name}; see In-game actions for the result.`);}
  else if(IN_GAME.has(f.kind.value)){await api('POST',`${base()}/command`,{...who,action:f.kind.value,message:f.message.value||undefined});notice(`Sent to the game server for ${target.name}; see In-game actions for the result.`);}
  else if(f.kind.value==='kick'){await api('POST',`${base()}/kick`,{player:target.player,reason:f.reason.value});notice(`Kick queued for ${target.name}; it applies within a few seconds.`);}
  else{const minutes=f.minutes.value?Number(f.minutes.value):null,r=await api('POST',`${base()}/bans`,{player:target.player,reason:f.reason.value,minutes,scope:f.scope.value,native:f.native.checked,...(f.banIps.checked?{banIps:true}:{})});notice(`${target.name} banned${minutes?` for ${f.minutes.selectedOptions[0].textContent}`:' permanently'}${f.scope.value==='global'?' on every server':''}${r.ipBans?`, with ${r.ipBans.length} IP address${r.ipBans.length===1?'':'es'}`:''}.`);if(r.ipBans)loadIpBans().catch(()=>{});}
  $('#action').hidden=true;target=null;
  await Promise.all([loadPlayers(),loadBans(),loadCommands(),can('admin')?loadAudit():null]);
 }catch(err){notice(explain(err),'error');}
};

const ACTION_NAMES={'teleport-to':'teleport to','bring':'bring','message':'message','kick-native':'kick (game server)','ban-native':'add to server ban list','unban-native':'remove from server ban list'};
// A desktop player's server-list ban is lifted by handle (they are offline, so not in the roster any more).
async function liftNative(c){
 try{await api('POST',`${base()}/command`,{handle:c.handle,action:'unban-native',reason:'lifted on the admin page'});notice(`Asked the game server to lift the ban on ${c.name}.`);await Promise.all([loadCommands(),loadAudit()]);}
 catch(err){notice(explain(err),'error');}
}
async function loadCommands(){
 const {commands}=await api('GET',`${base()}/commands`);
 $('#no-commands').hidden=commands.length>0;
 $('#commands tbody').replaceChildren(...commands.map(c=>el('tr',{},el('td',{textContent:when(c.createdAt)}),el('td',{textContent:c.actorName}),
  el('td',{textContent:ACTION_NAMES[c.action]??c.action}),el('td',{textContent:c.desktop?`${c.name} (desktop)`:c.name}),
  el('td',{},c.reason?`${c.status} (${c.reason})`:c.status,c.desktop&&c.action==='ban-native'&&c.status==='done'&&can('admin')?button('Lift',()=>liftNative(c)):null))));
}
// Item transfers the server adapter saw (slice 8): server-wide, or one account's/desktop handle's in Evidence.
const VIA_NAMES={container:'box',drop:'dropped item',corpse:'death sack',sleeper:'sleeper',direct:'direct'};
const party=p=>p.name??(p.handle?`desktop ${p.handle.slice(0,6)}`:'unknown');
const transferText=r=>`${r.amount!=null&&r.amount>1?r.amount+' × ':''}${r.item??'item'}`;
async function loadTransfers(){
 const {transfers}=await api('GET',`${base()}/transfers`);
 $('#no-transfers').hidden=transfers.length>0;
 $('#transfers tbody').replaceChildren(...transfers.slice(0,50).map(r=>el('tr',{},el('td',{textContent:when(r.at)}),el('td',{textContent:party(r.from)}),el('td',{textContent:party(r.to)}),
  el('td',{textContent:transferText(r)}),el('td',{textContent:VIA_NAMES[r.via]??r.via??''}))));
}
async function loadEvidenceTransfers(player,handle){
 const {transfers}=await api('GET',`${base()}/transfers?${player?'player='+encodeURIComponent(player):'handle='+encodeURIComponent(handle)}`);
 const me=r=>(player&&r.player===player)||(handle&&r.handle===handle);
 $('#evidence-transfers').replaceChildren(...(transfers.length?transfers.slice(0,50).map(r=>el('li',{className:'server'},
  me(r.from)?`gave ${transferText(r)} to ${party(r.to)}`:`took ${transferText(r)} from ${party(r.from)}`,el('span',{className:'meta',textContent:` · ${VIA_NAMES[r.via]??r.via??''} · ${when(r.at)}`})))
  :[el('li',{className:'meta',textContent:'No item transfers seen for this player.'})]));
}
const STEAM_FIELDS=['steamMinAgeDays','steamMinLevel','steamMaxVacBans','steamMaxGameBans','steamMinDaysSinceBan'];
const syncPolicy=()=>{const f=$('#policy-form');f.querySelector('.steam-only').disabled=!can('admin')||!f.steam.checked;};
async function loadPolicy(){
 const p=await api('GET',`${base()}/policy`),f=$('#policy-form');
 f.hours.value=String(Math.round(p.minAccountAgeMinutes/60));f.steam.checked=p.requireSteam;f.phone.checked=p.requirePhone;f.shotSeverity.value=String(p.screenshotAutoSeverity);
 for(const k of STEAM_FIELDS)f[k].value=p[k]<0?'':String(p[k]);
 for(const n of f.querySelectorAll('input'))n.disabled=!can('admin');syncPolicy();
}
$('#policy-form').steam.onchange=syncPolicy;
$('#policy-form').onsubmit=async e=>{
 e.preventDefault();const f=e.target;
 // Blank ban limits mean "any number" (-1); other blanks mean 0 (no check).
 const steam=Object.fromEntries(STEAM_FIELDS.map(k=>[k,f[k].value===''?(k.startsWith('steamMax')?-1:0):Number(f[k].value)]));
 try{await api('POST',`${base()}/policy`,{minAccountAgeMinutes:Number(f.hours.value)*60,requireSteam:f.steam.checked,requirePhone:f.phone.checked,screenshotAutoSeverity:Number(f.shotSeverity.value||0),...steam});notice('Join policy saved.');await loadAudit();}
 catch(err){notice(explain(err),'error');}
};

// Admin screenshots (central/screenshots.mjs): request, list with the cross-checks, delete (admins).
async function screenshot(p){
 try{await api('POST',`${base()}/screenshot`,{player:p.player});notice(`Screenshot requested from ${p.name}. It appears under Screenshots within a few seconds.`);
  for(const ms of [4000,10000,25000])setTimeout(()=>loadShots().catch(()=>{}),ms);}
 catch(err){notice(explain(err),'error');}
}
const SHOT_FAILURES={'tab-hidden':'the game tab was in the background','no-frame':'the game drew no frame','no-response':'the game did not answer','not-connected':'the player had left','disconnected':'the player left','expired':'the player was not online to ask','no-result':'the gateway never answered','late':'the answer came too late','invalid-image':'the image was not valid','too-large':'the image was too large','capture-error':'the game could not take it','busy':'another screenshot was in progress'};
const tag=(text,kind='')=>el('span',{className:'tag '+kind,textContent:text});
function shotTags(c){
 if(!c)return [];const out=[];
 if(c.positionDelta!=null)out.push(tag(`position ±${c.positionDelta} m`,c.positionDelta<=3?'ok':c.positionDelta<=15?'warn':'bad'));else out.push(tag('position unchecked','warn'));
 if(c.yawDelta!=null)out.push(tag(`aim ±${c.yawDelta}°`,c.yawDelta<=20?'ok':'warn'));
 if(c.latencyMs!=null)out.push(tag(`${(c.latencyMs/1000).toFixed(1)} s`,c.latencyMs<=5000?'':'warn'));
 if(c.blank)out.push(tag('blank frame','bad'));
 if(c.hidden)out.push(tag('tab hidden','warn'));
 if(c.duplicateOf)out.push(tag('same image as before','bad'));
 return out;
}
function shotCard(s){
 const who=s.trigger==='auto'?`anti-cheat (${s.flagKind??'flag'})`:`by ${s.requestedBy}`;
 const status=s.status==='done'?null:el('p',{className:'meta',textContent:s.status==='failed'?`No image: ${SHOT_FAILURES[s.reason]??s.reason}`:s.status==='sent'?'Waiting for the player’s game…':'Queued for the gateway…'});
 return el('li',{className:'shot'},
  s.image?el('a',{href:s.image,target:'_blank',rel:'noopener'},el('img',{src:s.image,alt:`Screenshot of ${s.name} at ${when(s.doneAt)}`,loading:'lazy'})):null,
  el('div',{},el('strong',{textContent:s.name}),el('br'),el('span',{className:'meta',textContent:`${when(s.createdAt)} · ${who}`})),
  status,el('div',{className:'tags'},...shotTags(s.checks)),
  s.status==='done'&&can('admin')?el('div',{className:'actions'},button('Delete',async()=>{if(!confirm('Delete this screenshot? The deletion is recorded in the audit log.'))return;try{await api('POST',`/admin/screenshots/${s.id}/delete`);await Promise.all([loadShots(),loadAudit()]);}catch(err){notice(explain(err),'error');}})):null);
}
async function loadShots(){
 const r=await api('GET',`${base()}/screenshots`);$('#shot-retention').textContent=String(r.retentionDays);
 $('#no-shots').hidden=r.screenshots.length>0;$('#shots').replaceChildren(...r.screenshots.slice(0,24).map(shotCard));
}
const REASONS={'shared-device':'same browser device','shared-signals-ip':'same browser + IP','shared-email':'same email','shared-steam':'same Steam','shared-phone':'same phone','shared-hwid':'same PC (launcher)','item-transfer':'items traded while new'};
async function loadAlts(player){
 const r=await api('GET',`${base()}/alts?player=${encodeURIComponent(player)}`);
 $('#alt-networks').hidden=!r.networks.length;$('#alt-networks').textContent=`Seen from hosting or VPN networks: ${r.networks.join(', ')}`;
 $('#alts').replaceChildren(...(r.alts.length?r.alts.map(a=>el('li',{className:'server'},el('strong',{textContent:a.name??a.player}),' ',el('code',{textContent:a.player}),el('br'),
  el('span',{className:'tags'},...a.reasons.map(x=>tag(REASONS[x]??x,x==='shared-device'||x==='shared-signals-ip'?'warn':'bad')),a.neverOnlineTogether?tag('never online together','bad'):a.onlineTogether?tag(`online together ×${a.onlineTogether}`):null,a.banned?tag('banned','bad'):null))):[el('li',{className:'server meta',textContent:'No linked accounts found.'})]));
}
async function loadHolds(){
 const {holds}=await api('GET',`${base()}/holds`);$('#no-holds').hidden=holds.length>0;
 $('#holds').replaceChildren(...holds.map(h=>el('li',{className:'server'},el('strong',{textContent:h.name}),` ${h.hard?'refused':'held'}: same ${h.kind} as ${h.bannedName} (banned: ${h.banReason})${h.scope==='global'?' · network ban':''} · ${when(h.createdAt)} `,
  can(h.scope==='global'?'staff':'admin')?button('Clear',async()=>{if(!confirm(`Let ${h.name} join despite the link to ${h.bannedName}?`))return;try{await api('POST',`${base()}/clear-hold`,{hold:h.id});notice(`${h.name} can join again.`);await Promise.all([loadHolds(),loadAudit()]);}catch(err){notice(explain(err),'error');}}):null)));
}
async function loadDomains(){
 const {domains}=await api('GET','/staff/email-domains');
 $('#domains').replaceChildren(...domains.map(d=>el('li',{className:'server'},el('code',{textContent:d.domain}),' ',button('Unblock',async()=>{try{await api('POST','/staff/email-domains',{domain:d.domain,blocked:false});await loadDomains();}catch(err){notice(explain(err),'error');}}))));
}
$('#domain-form').onsubmit=async e=>{e.preventDefault();const f=e.target;try{await api('POST','/staff/email-domains',{domain:f.domain.value.trim(),blocked:true});f.reset();notice('Domain blocked for new sign-ups.');await loadDomains();}catch(err){notice(explain(err),'error');}};

// Browser players by account id; desktop players by handle (their flags come from the adapter's position checks).
async function showEvidence(player,name,handle){
 try{
  const {flags}=await api('GET',handle?`${base()}/desktop-flags?handle=${encodeURIComponent(handle)}`:`${base()}/flags?player=${encodeURIComponent(player)}`);
  $('#evidence-who').textContent=`${name??player}: ${flags.length} most recent flag(s)`;
  // Browser accounts also get alt links and their screenshots (desktop handles have neither).
  for(const n of document.querySelectorAll('#evidence .sub,#evidence .sub+.hint,#alts,#evidence-shots'))n.hidden=!player;
  if(player){loadAlts(player).catch(err=>notice(explain(err),'error'));
   api('GET',`${base()}/screenshots?player=${encodeURIComponent(player)}`).then(r=>$('#evidence-shots').replaceChildren(...(r.screenshots.length?r.screenshots.map(shotCard):[el('li',{className:'meta',textContent:'No screenshots of this player.'})]))).catch(()=>{});}
  else $('#alt-networks').hidden=true;
  loadEvidenceTransfers(player,handle).catch(()=>$('#evidence-transfers').replaceChildren());
  $('#evidence-ip-block').hidden=!can('admin');if(can('admin'))loadEvidenceIps(player,handle).catch(()=>$('#evidence-ips').replaceChildren());
  $('#flags').replaceChildren(...flags.map(f=>{
   const li=el('li',{},el('strong',{textContent:f.kind}),` severity ${f.severity}, score ${f.score} · ${when(f.at)}`,el('pre',{textContent:JSON.stringify(f.detail?.detail??{},null,1)}));
   if(f.detail?.replay?.length)li.append(replayPlot(f.detail.replay));
   return li;
  }));
  $('#evidence').hidden=false;$('#evidence').scrollIntoView({block:'nearest'});
 }catch(err){notice(explain(err),'error');}
}
// Top-down path of the replay buffer (Unity x/z), shots as dots; enough to see a teleport or a straight-up climb.
function replayPlot(samples){
 const moves=samples.filter(s=>s.kind==='move'&&Array.isArray(s.pos));
 const box=el('div',{className:'replay'},el('span',{className:'meta',textContent:`replay: ${samples.length} samples over ${samples.at(-1).t} s, ${samples.filter(s=>s.kind==='fire').length} shots`}));
 if(moves.length<2)return box;
 const xs=moves.map(s=>s.pos[0]),zs=moves.map(s=>s.pos[2]),minX=Math.min(...xs),minZ=Math.min(...zs),w=Math.max(...xs)-minX,h=Math.max(...zs)-minZ,span=Math.max(1,w,h);
 const ox=(200-w/span*200)/2,oz=(200-h/span*200)/2; // centre the path in its shorter dimension
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','-5 -5 210 210');svg.setAttribute('class','plot');
 const line=document.createElementNS(ns,'polyline');line.setAttribute('points',moves.map(s=>`${(ox+(s.pos[0]-minX)/span*200).toFixed(1)},${(200-oz-(s.pos[2]-minZ)/span*200).toFixed(1)}`).join(' '));
 svg.append(line);box.append(svg,el('span',{className:'meta',textContent:`${span.toFixed(1)} m across · height ${Math.min(...moves.map(s=>s.pos[1])).toFixed(1)}–${Math.max(...moves.map(s=>s.pos[1])).toFixed(1)} m`}));
 return box;
}
$('#evidence-close').onclick=()=>{$('#evidence').hidden=true;};

async function loadBans(){
 const {bans}=await api('GET',`${base()}/bans`);
 $('#bans tbody').replaceChildren(...bans.map(b=>el('tr',{},
  el('td',{textContent:b.name}),el('td',{textContent:b.scope}),el('td',{textContent:b.reason}),el('td',{textContent:when(b.createdAt)}),
  el('td',{textContent:b.expiresAt?when(b.expiresAt):'never'}),el('td',{textContent:b.active?'active':b.revokedAt?'lifted':'expired'}),
  el('td',{},b.active&&can(b.scope==='global'?'staff':'admin')?button('Unban',async()=>{try{await api('POST',`${base()}/unban`,{ban:b.id});notice(`Ban on ${b.name} lifted.`);await Promise.all([loadBans(),loadAudit()]);}catch(err){notice(explain(err),'error');}}):null))));
}

// IP addresses (central/ip-bans.mjs): owners, admins and site staff only. A row's Ban fills the IP ban form.
const SOURCE_NAMES={game:'game',launcher:'desktop launcher',website:'website'};
async function loadEvidenceIps(player,handle){
 const {ips}=await api('GET',`${base()}/ips?${player?'player='+encodeURIComponent(player):'handle='+encodeURIComponent(handle)}`);
 $('#evidence-ips').replaceChildren(...(ips.length?ips.map(r=>el('li',{className:'server'},el('code',{textContent:r.ip}),
  el('span',{className:'meta',textContent:` · ${handle?'desktop game':SOURCE_NAMES[r.source]??r.source}${r.server&&r.server!==current.id?' (another server)':''} · ${when(r.firstSeen)} – ${when(r.lastSeen)} · ${r.seen}×`}),' ',
  button('Who else?',()=>lookupIp(r.ip)),button('Ban',()=>{const f=$('#ip-ban-form');f.ip.value=r.ip;$('#ip-bans-panel').scrollIntoView({block:'nearest'});f.reason.focus();})))
  :[el('li',{className:'meta',textContent:'No addresses seen for this player.'})]));
}
async function lookupIp(ip){
 try{
  const r=await api('GET',`${base()}/ip-lookup?ip=${encodeURIComponent(ip)}`),items=[...r.accounts.map(a=>el('li',{className:'server'},el('strong',{textContent:a.name}),el('span',{className:'meta',textContent:` · ${SOURCE_NAMES[a.source]??a.source} · last ${when(a.lastSeen)}`}),' ',button('Evidence',()=>showEvidence(a.player,a.name)))),
   ...r.desktop.map(d=>el('li',{className:'server'},el('strong',{textContent:d.name}),el('span',{className:'meta',textContent:` · desktop · last ${when(d.lastSeen)}`}),' ',d.server===current.id?button('Evidence',()=>showEvidence(null,d.name,d.handle)):null))];
  $('#ip-lookup').replaceChildren(el('li',{className:'meta',textContent:`${r.ip}: ${items.length} player${items.length===1?'':'s'}`}),...items);
  $('#ip-bans-panel').scrollIntoView({block:'nearest'});
 }catch(err){notice(explain(err),'error');}
}
async function loadIpBans(){
 const {bans}=await api('GET',`${base()}/ip-bans`);
 $('#ip-bans tbody').replaceChildren(...bans.map(b=>el('tr',{},
  el('td',{},el('code',{textContent:b.cidr})),el('td',{textContent:b.scope}),el('td',{textContent:b.reason}),el('td',{textContent:when(b.createdAt)}),
  el('td',{textContent:b.expiresAt?when(b.expiresAt):'never'}),el('td',{textContent:b.active?'active':b.revokedAt?'lifted':'expired'}),
  el('td',{},b.active&&can(b.scope==='global'?'staff':'admin')?button('Lift',async()=>{try{await api('POST',`${base()}/ip-unban`,{ban:b.id});notice(`IP ban on ${b.cidr} lifted.`);await Promise.all([loadIpBans(),loadAudit()]);}catch(err){notice(explain(err),'error');}}):null))));
}
$('#ip-ban-form').onsubmit=async e=>{
 e.preventDefault();const f=e.target,minutes=f.minutes.value?Number(f.minutes.value):null;
 try{await api('POST',`${base()}/ip-bans`,{ip:f.ip.value.trim(),reason:f.reason.value,minutes,scope:f.scope.value});notice(`${f.ip.value.trim()} banned${minutes?` for ${f.minutes.selectedOptions[0].textContent}`:' permanently'}${f.scope.value==='global'?' on every server':''}.`);f.reset();await Promise.all([loadIpBans(),loadAudit()]);}
 catch(err){notice(explain(err),'error');}
};
$('#ip-lookup-form').onsubmit=e=>{e.preventDefault();lookupIp(e.target.ip.value.trim());};

async function loadReports(){
 const {reports}=await api('GET',`${base()}/reports?status=open`);
 $('#no-reports').hidden=reports.length>0;
 $('#reports').replaceChildren(...reports.map(r=>el('li',{className:'server'},
  el('div',{},el('strong',{textContent:r.name}),` reported ${r.reason==='in-game'?'in-game':'for '+r.reason} by ${r.reporterName} · ${when(r.createdAt)}`),
  r.detail?el('p',{className:'meta',textContent:r.detail}):null,
  el('div',{className:'actions'},
   r.player?button('Evidence',()=>showEvidence(r.player,r.name)):null,
   button('Resolved',()=>resolve(r,'resolved')),button('Dismiss',()=>resolve(r,'dismissed'))))));
}
async function resolve(r,status){try{await api('POST',`${base()}/resolve-report`,{report:r.id,status});await Promise.all([loadReports(),can('admin')?loadAudit():null]);}catch(err){notice(explain(err),'error');}}

async function loadRoles(){
 const {owner,roles}=await api('GET',`${base()}/roles`);
 $('#roles').replaceChildren(el('li',{className:'server',textContent:`${owner.name} · Server owner`}),...roles.map(r=>el('li',{className:'server'},`${r.name} · ${ROLE_NAME[r.role]??r.role} `,
  can(r.role==='admin'?'owner':'admin')?button('Remove',async()=>{try{await api('POST',`${base()}/roles`,{player:r.player,role:null});await Promise.all([loadRoles(),loadAudit()]);}catch(err){notice(explain(err),'error');}}):null)));
}
$('#role-form').onsubmit=async e=>{
 e.preventDefault();const f=e.target;
 try{await api('POST',`${base()}/roles`,{player:f.player.value.trim(),role:f.grant.value});f.reset();notice('Role granted.');await Promise.all([loadRoles(),loadAudit()]);}
 catch(err){notice(explain(err),'error');}
};

async function loadAudit(){
 const {events}=await api('GET',`${base()}/audit`);
 $('#audit tbody').replaceChildren(...events.map(e=>{
  const d={...e.detail};delete d.player;
  return el('tr',{},el('td',{textContent:when(e.at)}),el('td',{textContent:e.actorName??e.actor}),el('td',{textContent:e.action}),
   el('td',{textContent:[e.playerName?`player ${e.playerName}`:null,...Object.entries(d).filter(([,v])=>v!=null).map(([k,v])=>`${k}: ${typeof v==='object'?JSON.stringify(v):v}`)].filter(Boolean).join(' · ')}));
 }));
}

await start();
