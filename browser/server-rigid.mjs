import {Vector3,Quaternion} from 'three';
import {callTime} from './airdrops.mjs';
const pos=v=>new Vector3(v[0],v[1],-v[2]),rot=q=>new Quaternion(-q[0],-q[1],q[2],q[3]);

// Native RigidObj presentation only. No local fuse, collision simulation, item consumption or damage.
// RigidObj.RecieveNetwork -> RigidbodyInterpolator.SetGoals(frame, info.timestamp), RODone -> InterpTimedEvent "_done" and
// TimedGrenade/SignalGrenade.ClientBounce -> "bounce", all at the RPC's server stamp (callTime with the session's
// ServerClock), sampled and run at Interpolation.time: page time - `delay` (seconds, or a function: the characters' delay).
export class ServerRigid{
 constructor(session,manifest,{now=()=>performance.now()/1000,delay=0.1,create,pose,remove,bounce,done,items={}}){
  Object.assign(this,{session,now,delay,createView:create,poseView:pose,removeView:remove,bounce,done});this.actors=new Map();this.byName=new Map();
  for(const w of Object.values(manifest.weapons)){const key=w.prefabs?.throwObjectPrefab,p=manifest.prefabs[key];if(p&&(p.components.TimedGrenade||p.components.SignalGrenade||p.components.FlareObj))this.byName.set(p.name,{key,p});}
  if(manifest.pickup){const p=manifest.prefabs[manifest.pickup];if(p?.components.ItemPickup)this.byName.set(p.name,{key:manifest.pickup,p});}
  this.items=new Map(Object.values(items).map(i=>[i.data._uniqueID,i.data]));
  for(const v of session.client.views.values())this.create(v);
  session.client.addEventListener('create',e=>this.create(e.detail));session.client.addEventListener('rpc',e=>this.call(e.detail,callTime(e.detail,now(),session.clock)));
  session.client.addEventListener('destroy',()=>{for(const [id,a]of this.actors)if(!session.client.views.has(id)&&a.doneAt==null)this.remove(id);});
  session.addEventListener('closed',()=>{for(const id of [...this.actors.keys()])this.remove(id);});
 }
 create(v){const def=this.byName.get(v.prefab);if(!def||this.actors.has(v.viewId))return;const retained=[...(this.session.actorCalls.get(v.viewId)?.values()??[])];
  // RigidObj.uLink_OnNetworkInstantiate: spawnTime = info.timestamp, the Instantiate's own server stamp (widened the
  // same way as an RPC's, bridge/game-bridge.mjs); __hiding while it is still ahead of Interpolation.time, OnHide
  // disabling the renderer (and FlareObj's light) until the "_init" InterpTimedEvent fires OnShow. Without a
  // forwarded stamp (older captures) fall back to our own arrival-time estimate and never hide, as before.
  const stamped=Number.isFinite(v.timestampMs)&&Number.isFinite(v.serverMs),
   time=stamped?callTime(v,this.now(),this.session.clock):Math.min(this.now(),...retained.map(r=>r.receivedAt)),
   spawnAt=stamped?time:-Infinity,hidden=spawnAt>this.now()-this.lag();
  const a={id:v.viewId,...def,frames:[{t:time,p:new Vector3(...v.position),q:new Quaternion(...v.rotation),create:true}],events:[],doneAt:null,spawnAt,hidden};
  a.view=this.createView(a);if(a.view)a.view.visible=!hidden;this.actors.set(a.id,a);
  for(const r of retained)this.call(r,callTime(r,r.receivedAt,this.session.clock));
 }
 call(r,time){const a=this.actors.get(r.viewId);if(!a)return;const v=r.args?.values??[];
  if(r.name==='RecieveNetwork'){if(v.length!==2||!Array.isArray(v[0])||v[0].length!==3||!v[0].every(Number.isFinite)||!Array.isArray(v[1])||v[1].length!==4||!v[1].every(Number.isFinite)||Math.hypot(...v[1])<1e-8)return;
   // The Create's frame has no server stamp (its arrival time): a stamped snapshot at or before it replaces it.
   a.frames=a.frames.filter(f=>f.t!==time&&!(f.create&&f.t>=time));a.frames.push({t:time,p:pos(v[0]),q:rot(v[1]).normalize()});a.frames.sort((x,y)=>x.t-y.t);if(a.frames.length>(a.p.components.RigidbodyInterpolator?.[0]?._bufferCapacity??32))a.frames.shift();}
  else if(a.p.components.ItemPickup&&['PKIS','PKIF'].includes(r.name)){
   const count=r.name==='PKIS'?1:v[1],d=this.items.get(v[0]);if(!d||!Number.isInteger(v[0])||v.length!==(r.name==='PKIS'?1:2)||!Number.isInteger(count)||count<0||count>255)return;
   a.pickup={uid:v[0],amount:count,name:d.m_Name,text:`Take '${d.m_Name}${count>1&&d._splittable?' x'+count:''}'`};
  }
  else if(r.name==='RODone'&&a.doneAt==null)a.doneAt=time;
  else if(r.name==='ClientBounce')a.events.push({t:time});
 }
 remove(id){const a=this.actors.get(id);if(!a)return;this.removeView(a);this.actors.delete(id);}
 lag(){return typeof this.delay==='function'?this.delay():this.delay;}
 frame(time,dt){const lag=this.lag();for(const [id,a]of this.actors){const t=time-lag,s=a.frames;let x=s[0],y=s[0];for(const f of s){if(f.t<=t)x=f;if(f.t>=t){y=f;break;}y=f;}const k=y.t>x.t?Math.max(0,Math.min(1,(t-x.t)/(y.t-x.t))):0;
   a.position=x.p.clone().lerp(y.p,k);a.rotation=x.q.clone().slerp(y.q,k);
   const due=t>=a.spawnAt;if(due===a.hidden){a.hidden=!due;if(a.view)a.view.visible=due;}
   if(!a.hidden)this.poseView(a,dt);
   const dueEvents=a.events.filter(e=>e.t<=t);a.events=a.events.filter(e=>e.t>t);for(const e of dueEvents)if(t-e.t<2)this.bounce?.(a);
   if(a.doneAt!=null&&t>=a.doneAt){this.done?.(a);this.remove(id);}
  }}
 debug(){return [...this.actors.values()].map(a=>({id:a.id,name:a.p.name,position:a.position?.toArray()??null,hidden:a.hidden,done:a.doneAt!=null,pickup:a.pickup??null,particles:(a.effects??[]).reduce((n,e)=>n+e.particles.length,0),light:a.light?.intensity??0}));}
}
