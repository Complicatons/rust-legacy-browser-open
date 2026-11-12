// Small presentation rules whose data comes from tools/export_presentation_extras.py (presentation/manifest.json).

// HeldItem.CreateViewModel: an item with a view model plays its datablock's deploySound (AudioClip.Play(1): 2D, volume 1)
// together with PlayDeployAnimation, every time the item is activated.
export const deploySoundFor=(manifest,itemKey)=>manifest?.held?.[itemKey]?.deploySound??null;

// ExplosionEffect (Explosion1): Start sets audio.pitch = Random.Range(0.9, 1), plays it and destroys the effect after
// 3 s; Update drives myLight.intensity = Clamp(initialLightIntensity * (1 - t / 0.25), 0, initialLightIntensity) and
// destroys the light once it reaches 0. Intensities here are Unity's; the port's point lights take them * 6.
export const EXPLOSION_LIFETIME=3,EXPLOSION_LIGHT_FADE=0.25;
export const explosionEffectFor=(manifest,prefabKey)=>{const e=manifest?.effects?.[prefabKey];return e?.script==='ExplosionEffect'?e:null;};
export function explosionLightIntensity(effect,t){const i=effect.initialLightIntensity;return Math.min(Math.max(i*(1-t/EXPLOSION_LIGHT_FADE),0),i);}
export const explosionPitch=(rng=Math.random)=>0.9+rng()*0.1;

// QuickLight (MetalImpact): Update does light.range -= Time.deltaTime / duration every frame and, once the range reaches
// 0, sets range and intensity to 0. The intensity stays at the Light's own value until then, and the script's `range`
// field is never read, so with the Light's range 1 and duration 0.1 the spark light is gone 0.1 s after the impact.
export const quickLightFor=(manifest,prefabKey)=>{const e=manifest?.effects?.[prefabKey];return e?.script==='QuickLight'?e:null;};
export function quickLightStep(light,dt){light.range-=dt/light.duration;if(light.range<=0){light.range=0;light.intensity=0;}return light;}
