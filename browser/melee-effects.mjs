// Client-side melee presentation sounds, ported from the decompiled sources:
//  MeleeWeaponDataBlock.SwingSound: swingSound.PlayLocal(camera, zero, volume 1, pitch Random.Range(0.85, 1), min 3, max 20).
//  MeleeWeaponDataBlock.DoMeleeEffects: a "Tree Collider" hit plays impactSoundWood.Play(pos, 1, 2, 10) (with impactEffectWood);
//   anything else goes through SurfaceInfo.DoImpact(hitObj, ImpactType.Melee, ...), which instantiates a random
//   SurfaceInfoObject.meleeEffects prefab whose EffectSoundPlayer.Start plays a random clip of its AudioClipArray
//   with clip.Play(position, volume 1, min 1, max 10). SoundPool's default rolloff is Linear.
// The datablock's impactSoundGeneric / impactSoundFlesh fields are never read by the shipped client code, so they are not used here.
const pick=(list,random)=>list?.length?list[Math.min(list.length-1,Math.floor(random()*list.length))]:null;

export function meleeSwingSound(sounds,random=Math.random){
 const file=sounds?.swingSound;return file?{file,volume:1,pitch:0.85+random()*0.15,min:3,max:20}:null;}

// DoMeleeEffects' effect prefab lifetimes: Destroy(impactEffectWood instance, 1.5) and SurfaceInfo.DoImpact's Destroy(obj, 1).
export const MELEE_TREE_EFFECT_LIFE=1.5,MELEE_SURFACE_EFFECT_LIFE=1;
// hit: {tree:boolean, ...surface resolver input}; surfaceFor: createSurfaceResolver(manifest, terrainIndices);
// prefabs: the weapon's exported prefab pointers (impactEffectWood). `effect` is the prefab to instantiate at the hit
// with Quaternion.LookRotation(normal); its own EffectSoundPlayer clip is separate from `sound` (the tree's impactSoundWood).
// For a surface hit `sound` is the clip the effect's EffectSoundPlayer would pick (callers that spawn the effect let it play).
export function meleeImpact(hit,{sounds,prefabs=null,surfaceFor,manifest,random=Math.random}){
 if(!hit)return null;
 if(hit.tree){const file=sounds?.impactSoundWood,effect=prefabs?.impactEffectWood??null;
  return {kind:'tree',surface:'wood',effect:effect&&manifest?.prefabs?.[effect]?effect:null,life:MELEE_TREE_EFFECT_LIFE,sound:file?{file,volume:1,min:2,max:10}:null};}
 const surface=surfaceFor?.(hit),effect=pick(surface?.meleeEffects,random),prefab=effect?manifest?.prefabs?.[effect]:null;
 const player=(prefab?.components?.EffectSoundPlayer??[]).find(e=>e.enabled!==false&&e.sounds?.length);
 const file=player?pick(player.sounds,random):null;
 return {kind:'surface',surface:surface?.name??null,effect:prefab?effect:null,life:MELEE_SURFACE_EFFECT_LIFE,sound:file?{file,volume:1,min:1,max:10}:null};
}
