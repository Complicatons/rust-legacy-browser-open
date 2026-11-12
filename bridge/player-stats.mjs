// Leaderboard stats from the server's own messages (one PlayerStats per in-game browser session, fed the same events
// the browser gets and the commands the anti-cheat allowed). Nothing the browser says about itself is counted:
//   animal kills   BasicWildLifeAI.ClientDeath(deadPos, attackerID) on the animal's view, attacker = a view we own
//   pvp kills      DeathTransfer.Client_OnKilledBy / …ShotBy(attackerViewID, …) on another :player_soldier, attacker ours
//   deaths         any DeathTransfer.Client_OnKilled* on our own character (all four are sent with RPCMode.Others)
//   gathered       ConsoleNetworker.CL_ConsoleMessage "notice.inventory \"N x Item\"" (Rust.Notice.Inventory from
//                  ResourceTarget.DoGather and MeleeWeaponDataBlock corpse harvesting; the server sends it to the gatherer)
//   crafted        CraftingInventory: CRFU(start, duration, perSec, progress, blueprint, amount) then CRFC; complete when
//                  the progress reached the duration (CompleteCrafting); a cancel (CRFX sent, or the server's) is not
//   built          a structure-place / deployable-place command confirmed by an NGC Instantiate of a ;struct / ;deploy
//                  prefab near it within PLACE_MS
//   distance       horizontal steps of moves the anti-cheat allowed, each capped at the speed limit; server corrections
//                  and respawns restart the trail without counting the jump
// Playtime comes from central's roster (play_sessions). Desktop players are not counted yet (browser only).
const CHARACTER=':player_soldier',DEATHS=new Set(['Client_OnKilled','Client_OnKilledBy','Client_OnKilledShot','Client_OnKilledShotBy']);
const KILLED_BY={Client_OnKilledBy:0,Client_OnKilledShotBy:0};
export const PLACE_MS=3000,PLACE_RANGE=12,CRAFT_SLACK=1.5,MAX_STEP_SPEED=10,MAX_GATHER=1000;
const NOTICE=/^notice\.inventory\s+"?(\d{1,5}) x ([^"\\\r\n]{1,48}?)"?\s*$/i;
const key=s=>String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
// ':wolf' → 'wolf', ':mutant_bear_prefab' → 'mutant-bear'.
export const speciesOf=prefab=>key(String(prefab??'').replace(/^:/,'').replace(/_?prefab$/i,''))||'animal';

export class PlayerStats{
 // client: the uLink client (playerId); views: the bridge's view map ({prefab, owner}); now(): seconds; wallNow(): ms.
 constructor({subject,client,views,now=()=>performance.now()/1000,wallNow=Date.now}){
  Object.assign(this,{subject,client,views,now,wallNow});
  this.counts=new Map();this.dead=new Set();this.craft=null;this.places=[];this.prev=null;
 }
 add(kind,sub,n=1){if(!(n>0))return;const k=sub?`${kind}:${sub}`:kind;this.counts.set(k,(this.counts.get(k)??0)+n);}
 mine(viewId){return this.views.get(viewId)?.owner===this.client.playerId;}
 // A server → browser event (game-bridge 'event').
 observe(e){
  if(e.type==='create'&&e.mine&&e.prefab===CHARACTER){this.character=e.viewId;this.prev=null;return;}
  if(e.type==='ngc-create'){this.placed(e);return;}
  if(e.type!=='rpc')return;
  const v=e.args?.values??[];
  if(e.name==='ClientDeath'&&e.args?.class==='BasicWildLifeAI'||e.name==='ClientDeath'&&e.args?.class==='HostileWildlifeAI'){
   const animal=this.views.get(e.viewId);
   if(this.mine(v[1])&&!this.dead.has(e.viewId)){this.dead.add(e.viewId);this.add('animal',speciesOf(animal?.prefab));}
   return;
  }
  if(DEATHS.has(e.name)){
   if(this.dead.has(e.viewId))return;
   if(e.viewId===this.character){this.dead.add(e.viewId);this.add('death');this.prev=null;return;}
   const victim=this.views.get(e.viewId);
   if(e.name in KILLED_BY&&victim?.prefab===CHARACTER&&victim.owner!==this.client.playerId&&this.mine(v[KILLED_BY[e.name]])){this.dead.add(e.viewId);this.add('pvp');}
   return;
  }
  if(e.name==='CL_ConsoleMessage'&&e.viewId===997&&typeof v[0]==='string'){
   const m=NOTICE.exec(v[0]);if(m)this.add('gather',key(m[2]),Math.min(MAX_GATHER,Number(m[1])));return;
  }
  if(e.name==='CRFU'&&this.mine(e.viewId)){const [,duration,perSec,progress,blueprint,amount]=v.map(Number);
   this.craft=Number.isFinite(duration)&&duration>=0&&Number.isFinite(perSec)&&Number.isFinite(progress)?{duration,perSec,progress,at:this.now(),blueprint,amount:Math.max(1,Math.min(250,Math.trunc(amount)||1)),cancelled:false}:null;return;}
  if(e.name==='CRFC'&&this.mine(e.viewId)){const c=this.craft;this.craft=null;
   if(c&&!c.cancelled&&c.progress+c.perSec*(this.now()-c.at)+CRAFT_SLACK>=c.duration)this.add('craft',null,c.amount);return;}
  // Own-character ReadClientMove is a server correction: the next move starts a new trail.
  if(e.name==='ReadClientMove'&&e.viewId===this.character)this.prev=null;
 }
 // A browser command the anti-cheat allowed (the bridge sends it to the server).
 command(msg){
  if(msg?.type==='move'&&Array.isArray(msg.origin)&&msg.origin.length===3&&msg.origin.every(Number.isFinite)){
   const t=this.now(),p=msg.origin;
   if(this.prev){const dt=Math.max(0,t-this.prev.t),d=Math.hypot(p[0]-this.prev.pos[0],p[2]-this.prev.pos[2]);this.add('distance',null,Math.min(d,MAX_STEP_SPEED*dt+0.5));}
   this.prev={pos:p,t};return;
  }
  if(msg?.type==='rpc'&&msg.name==='CRFX'&&this.craft)this.craft.cancelled=true;
  if(msg?.type==='item'&&(msg.action==='structure-place'||msg.action==='deployable-place')){
   const at=msg.data?.position??msg.data?.origin;
   if(Array.isArray(at)&&at.length===3&&at.every(Number.isFinite)){this.places=this.places.filter(x=>this.wallNow()-x.at<PLACE_MS).slice(-4);this.places.push({at:this.wallNow(),pos:at,kind:msg.action==='structure-place'?'structure':'deployable'});}
  }
 }
 placed(e){
  const name=String(e.prefab??''),kind=/^;struct/i.test(name)?'structure':/^;deploy/i.test(name)?'deployable':null;
  if(!kind||!Array.isArray(e.position))return;
  const t=this.wallNow(),i=this.places.findIndex(x=>t-x.at<PLACE_MS&&x.kind===kind&&Math.hypot(...x.pos.map((c,j)=>c-e.position[j]))<=PLACE_RANGE);
  if(i<0)return;this.places.splice(i,1);this.add('build',kind);
 }
 // Counts since the last drain, as {kind or kind:sub: n}; null when there are none.
 drain(){if(!this.counts.size)return null;const out=Object.fromEntries([...this.counts].map(([k,n])=>[k,k==='distance'?Math.round(n*10)/10:n]));this.counts.clear();return out;}
}
