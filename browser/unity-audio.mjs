// Unity 4 AudioSource / SoundPool rules used by the world sound helpers in main.mjs (decompiled SoundPool.cs).
//  - Unity 4 has no HRTF: SoundPool sets panLevel 1 and spread 0 (DEF), a plain stereo pan. Web Audio's 'equalpower'
//    panner is that pan; three's default 'HRTF' is not (world-audio.mjs, voice.mjs and menu-audio.mjs already use it).
//  - AudioSource.rolloffMode: 0 Logarithmic (Web Audio 'inverse': ref/d, held at its max-distance value beyond max, as
//    Unity holds the volume), 1 Linear (silent at max), 2 Custom (no curve exported here; treated as inverse as before).
//  - SoundPool.Play culls a world or attached sound (not a camera-attached one) at start by its distance to the camera:
//    Linear/Custom beyond settings.max, Logarithmic only beyond settings.max * 2. A prefab's own AudioSource is never culled.
export const PANNING_MODEL='equalpower';

export function sourceDistanceModel(rolloffMode){return rolloffMode===1?'linear':'inverse';}

// model: 'linear' | 'inverse' (Logarithmic); distance to the camera when SoundPool.Play is called.
export function soundPoolAudible(model,distance,max){return distance<=(model==='inverse'?max*2:max);}

// A prefab AudioSource sounds on instantiation only when it is enabled and has a clip, and either plays on awake or a
// script on the prefab calls audio.Play() (ExplosionEffect.Start). Unity does not play a disabled source
// (WoodPile_Death's source is serialized disabled, so ResourceObject's clientMeshChangeEffect is silent for wood piles).
// Older exports carry no m_PlayOnAwake: they keep playing as before.
export function sourcePlaysOnInstantiate(src,{scripted=false}={}){
 if(!src?.clip||src.enabled===false)return false;
 return scripted||src.data?.m_PlayOnAwake!==false;
}

// A looping AudioSource plays until its GameObject is destroyed; a one-shot one plays its clip once.
export function sourceLifetime(src,objectLifetime){return src?.data?.Loop?objectLifetime:null;}

export function applyPanning(audio){if(audio?.panner)audio.panner.panningModel=PANNING_MODEL;return audio;}

// A held representation's own AudioSource. ItemRepresentation prefabs are network-instantiated on every client, the
// holder's included: on the owner, CheckParent sets worldModels = actor.forceThirdPerson, which only disables the
// renderer and the `visuals` objects, so the rep stays attached to PlayerAnimation.itemAttachment and its AudioSource
// keeps playing (no client code touches it). It plays from the rep's creation (PlayOnAwake) until the rep is destroyed
// (InterpDestroy / the network destroy). The first-person view model is a separate prefab (the Uber Hatchet uses the
// shared VM-Hatchet, which has no AudioSource). Shipped: only uhatchet.irp has one (Loop, PlayOnAwake, Logarithmic
// 1..100 m, volume 0.577, pitch 1, DopplerLevel 0.1, clip "Session 05 - Drums 01").
export function heldRepSource(prefab){const src=prefab?.components?.AudioSource?.find(s=>sourcePlaysOnInstantiate(s));if(!src)return null;const d=src.data??{};
 return {clip:src.clip,node:src.node??0,loop:Boolean(d.Loop),volume:d.m_Volume??1,pitch:d.m_Pitch??1,model:sourceDistanceModel(d.rolloffMode),min:d.MinDistance??1,max:d.MaxDistance??500};}

// The held representations that sound this frame, keyed by rep: every remote rep attached to its character and the
// holder's own rep (local: true; drawn nowhere, still sounding from its hidden third-person hand). A prefab's own
// AudioSource is never SoundPool-culled. remote: [{rep, prefab, ...}], own: {rep, prefab, ...} | null.
export function heldRepSounds(prefabs,{remote=[],own=null}={}){const out=new Map();
 for(const h of [...remote.map(r=>({...r,local:false})),...(own?[{...own,local:true}]:[])]){if(h.rep==null||out.has(h.rep))continue;const source=heldRepSource(prefabs?.[h.prefab]);if(source)out.set(h.rep,{...h,source});}
 return out;}
