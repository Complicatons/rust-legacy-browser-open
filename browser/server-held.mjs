// ItemRepresentation initialData: parent NetworkViewID (ushort), HeldItemDataBlock uniqueID (int32).
// A representation's lifetime comes from native Create/Destroy, independently of private inventory snapshots.
import {remoteWeaponAction,remoteMods,remoteMeleeHit} from './remote-weapon.mjs';
import {callTime} from './airdrops.mjs';
// ItemRepresentation.Action1/2/3 (and the B byte variants) and InterpDestroy are InterpTimedEvents: queued at the RPC's
// timestamp and run once Interpolation.time (server time - the interpolation delay) reaches it, the clock the remote
// characters are drawn on (player-view.mjs). callTime puts the server stamp on the page clock; `delay()` is that delay.
const TIMED=/^(?:Action[123]B?|InterpDestroy)$/;
const TORCH_LIGHT={BasicTorchItemDataBlock:{Action2:true,Action3:false},TorchItemDataBlock:{Action2:true,Action1:false}},TORCHES=new Set(Object.keys(TORCH_LIGHT));
// ItemRepresentation.InterpDestroy (client ~616-624): HeldItem.OnSetActive(false) on the server sends InterpDestroy and then
// NetCull.Destroy, so a fast item switch leaves the OLD representation on the character (DontDestroyWithNetwork) until
// its InterpDestroy time while the new one attaches at once (ItemRepresentation.FindSignalee ->
// InventoryHolder.SetItemRepresentation: the newest attached representation is the holder's, whose
// worldAnimationGroupName the character poses with; ClearItemRepresentation only clears it when it is still the
// holder's). Each live representation keeps running its own queued Action1/2/3 (RunAction -> datablock.DoActionN on
// that representation, with its own muzzle). attach(parent, h) binds one representation to a character view (true when
// bound), detach(parent, rep) removes it.
export class ServerHeldItems{
 constructor(session,manifest,{attach=()=>false,detach=()=>{},status=()=>{},action=()=>{},items={},now=()=>performance.now()/1000,delay=()=>0}={}){Object.assign(this,{session,manifest,attach,detach,status,action,catalogue:items,now,delay});this.items=new Map();this.active=new Map();this.bound=new Map();this.dying=new Set();this.pending=[];this.byUID=new Map(Object.entries(manifest.held??{}).map(([key,h])=>[h.uid,{...h,key}]));
  for(const v of session.client.views.values())this.create(v);
  session.client.addEventListener('create',e=>this.create(e.detail));
  session.client.addEventListener('rpc',e=>this.call(e.detail,callTime(e.detail,now(),session.clock)));
  // A native Destroy removes the representation unless its InterpDestroy is still queued (NetCull.DontDestroyWithNetwork):
  // then it stays until that event runs. A destroyed parent character takes its attached representations with it, except
  // while its death is pending (hold): DeathTransfer keeps the character until "RAG" (DontDestroyWithNetwork).
  session.client.addEventListener('destroy',()=>{for(const [id,h]of this.items){if(h.attached&&!session.client.views.has(h.parent)&&!this.dying.has(h.parent))this.items.delete(id);else if(!session.client.views.has(id)){if(h.interpDestroyAt==null)this.items.delete(id);else h.netDestroyed=true;}}this.frame();});
  session.addEventListener('closed',()=>{this.items.clear();this.pending.length=0;this.dying.clear();this.frame();});
 }
 create(v){const bytes=v.initialData;if(!bytes||bytes.length<6)return;const b=Uint8Array.from(bytes),d=new DataView(b.buffer),parent=d.getUint16(0,true),h=this.byUID.get(d.getInt32(2,true));
  if(!h||h.netName!==v.prefab||parent===v.viewId)return;this.items.set(v.viewId,{...h,rep:v.viewId,parent,attached:false,lit:false,modFlags:0,mods:[]});
  // Retained Action2/Action3 (online.mjs) are replayed only for torches, where they are the buffered light state; a
  // weapon's old swing or reload is not shown again.
  const torch=TORCHES.has(this.manifest.weapons?.[h.key]?.class);
  for(const r of this.session.actorCalls?.get(v.viewId)?.values()??[])if(torch||!/^Action[123]B?$/.test(r.name))this.call(r,callTime(r,r.receivedAt??this.now(),this.session.clock));
 }
 // `at`: the call's server time on the page clock.
 call(r,at=this.now()){const h=this.items.get(r.viewId);if(!h)return;const args=r.args?.values??[],kind=this.manifest.weapons?.[h.key]?.class;
  if(r.name==='Mods'){const mods=remoteMods(args[0],this.catalogue);if(mods){h.mods=mods.mods;h.modFlags=mods.flags;}}
  // TorchItemRep / BasicTorchItemRep.OnStatus is a plain RPC (runs on arrival). RepIgnite's StrikeSound.Play(transform.position,
  // 1, 2, 8) is silent in the shipped game: the flare.irp prefab's TorchItemRep.StrikeSound field is empty (asset read
  // statically; SoundPool.Play returns for a null clip), and the torch's BasicTorchItemRep has no strike sound.
  else if(r.name==='OnStatus'&&['BasicTorchItemDataBlock','TorchItemDataBlock'].includes(kind)){h.lit=Boolean(args[0]);if(h.attached)this.status(h,h.lit);}
  else if(TIMED.test(r.name)){if(r.name==='InterpDestroy')h.interpDestroyAt=at;this.pending.push({rep:r.viewId,r,at,kind});this.flush();}
 }
 // Runs the queued events whose time the interpolation clock has reached, in timestamp order.
 flush(time=this.now()){if(!this.pending.length)return;const playhead=time-this.delay();this.pending.sort((a,b)=>a.at-b.at);
  while(this.pending.length&&this.pending[0].at<=playhead)this.run(this.pending.shift());}
 run({rep,r,kind}){const h=this.items.get(rep);if(!h)return;const args=r.args?.values??[];
  // ItemRepresentation.OnInterpTimedEvent "InterpDestroy": Object.Destroy(gameObject).
  if(r.name==='InterpDestroy'){this.items.delete(rep);this.frame();return;}
  // The light of a remote torch or flare. The original server never sends OnStatus (its RepIgnite/RepExtinguish run only
  // inside the OnStatus handler); it relays the owner's Action2 (OthersExceptOwnerBuffered): BasicTorchItemDataBlock and
  // TorchItemDataBlock DoAction2 -> Ignite -> RepIgnite. BasicTorchItemDataBlock.DoAction3 and the flare's DoAction1 (the
  // throw, AllExceptOwner) -> RepExtinguish; the flare's DoAction3 does nothing. Kept on unbound representations too
  // (attach copies `lit`), as the light is a child of the representation's muzzle.
  const lit=TORCH_LIGHT[kind]?.[r.name.replace(/B$/,'')];
  if(lit!==undefined){h.lit=lit;if(h.attached)this.status(h,lit);if(kind==='BasicTorchItemDataBlock')return;}
  if(!h.attached)return;
  // Remote melee: Action3 starts the swing; Action1 carries the hit (a malformed stream throws in DoAction1 before
  // EndSwingWorldAnimations, so it is ignored entirely).
  if(kind==='MeleeWeaponDataBlock'&&/^Action3B?$/.test(r.name))this.action(h,'swing');
  else if(kind==='MeleeWeaponDataBlock'&&/^Action1B?$/.test(r.name)){const event=remoteMeleeHit(args[0]);if(event)this.action(h,'hit',event);}
  else if(/^Action1B?$/.test(r.name)){const event=remoteWeaponAction(kind,args[0],this.catalogue[h.key]?.data);if(event)this.action(h,event.type,event);}
 }
 // A remote character's death is pending (DeathTransfer.Client_OnKilledShared queued "RAG"): the server's
 // DropInventoryContents -> InterpDestroy and DestroyCharacter of the same tick must not take its representations
 // (or the item pose) before the ragdoll.
 hold(parent){this.dying.add(parent);}
 // "RAG" / "ClientLocalDeath": Object.Destroy(character) destroys the attached representations with it, and
 // ItemRepresentation.OnDestroy runs their pending events at once (InterpTimedEvent.Remove(this, invokePending: true)).
 // Call it before the character view leaves the renderer, so those events still find their muzzles.
 release(parent){const reps=new Set([...this.items.values()].filter(h=>h.parent===parent).map(h=>h.rep));
  const due=this.pending.filter(e=>reps.has(e.rep)).sort((a,b)=>a.at-b.at);this.pending=this.pending.filter(e=>!reps.has(e.rep));
  for(const e of due)this.run(e);for(const rep of reps)this.items.delete(rep);this.dying.delete(parent);this.frame();}
 frame(time){if(time!==undefined)this.flush(time);const c=this.session.client,present=parent=>parent!==c.characterView&&(this.session.remote.has(parent)||this.dying.has(parent));
  for(const [parent,reps]of this.bound){for(const rep of reps){const h=this.items.get(rep);if(h&&h.parent===parent&&present(parent))continue;
    reps.delete(rep);if(h)h.attached=false;this.detach(parent,rep);if(this.active.get(parent)===rep)this.active.delete(parent);}
   if(!reps.size)this.bound.delete(parent);}
  // In creation order: each newly attached representation becomes the holder's.
  for(const h of this.items.values())if(!h.attached&&present(h.parent)&&this.attach(h.parent,h)){h.attached=true;if(!this.bound.has(h.parent))this.bound.set(h.parent,new Set());this.bound.get(h.parent).add(h.rep);this.active.set(h.parent,h.rep);}
 }
 debug(){return [...this.bound].map(([parent,reps])=>({parent,rep:this.active.get(parent)??null,item:this.items.get(this.active.get(parent))?.item,reps:[...reps],pending:this.pending.filter(e=>reps.has(e.rep)).length,dying:this.dying.has(parent)}));}
}
