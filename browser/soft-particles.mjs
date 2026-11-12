import * as THREE from 'three';
import {SOFT_PARTICLE_UNIFORMS,SOFT_PARTICLE_DRAWS} from './particles.mjs';
import {blitRenderTarget} from './post-chain.mjs';

// QualitySettings.softParticles (Beautiful, Fantastic) turns on the SOFTPARTICLES_ON variants of the shipped particle
// shaders (browser/particles.mjs). Those read _CameraDepthTexture: the original Scene Camera renders Deferred Lighting, so
// the depth texture always exists and holds the opaque (deferred) geometry drawn before the transparent queue.
//
// Port: while soft particles are on and one of them drew in the last frames, the world renders into the post chain's
// offscreen camera image (post-chain.mjs requestTarget, with its depth texture). An empty opaque hook object (renderOrder
// 0.5: after every deferred opaque object, before the sky/sea/WriteZ plane and the particles in the transparent queue)
// copies that depth into its own texture (blitFramebuffer, the same copy the sea's GrabPass makes), so particles sample a
// texture that is not the bound depth attachment. Everything is uniforms: switching quality never recompiles a program.
// Unity's deferred depth texture holds only objects drawn in the light pre-pass. Every opaque world shader shipped has a
// PrePassBase pass except the tree leaves (Hidden/Nature/Tree Creator Leaves Fast Optimized, forward only) and the tree
// billboards (Hidden/TerrainEngine/BillboardTree, Transparent-100, ZWrite Off): those draw at FORWARD_OPAQUE_ORDER, after
// the copy, so particles do not fade against them.
export const SOFT_HOOK_ORDER=0.5,FORWARD_OPAQUE_ORDER=1;
// Frames a soft particle draw keeps the camera image requested (covers frames where particles momentarily die out).
export const SOFT_KEEP_FRAMES=30;
// Measurement switch (dev pages import this module): true keeps every particle hard without changing the quality level.
export const SOFT_PARTICLE_DEBUG={disabled:false};
// Whether the scene depth is needed this frame (pure: tests).
export function wantsSceneDepth({enabled,frame,lastDraw,keep=SOFT_KEEP_FRAMES}){return Boolean(enabled)&&frame-lastDraw<=keep;}

// renderer: THREE.WebGLRenderer; scene: the world scene; post: the post chain (browser/post-chain.mjs).
export function createSoftParticles({renderer,scene,post}){
 const U=SOFT_PARTICLE_UNIFORMS,D=SOFT_PARTICLE_DRAWS;let enabled=false,copies=0,failed=0,lastCopy='none';
 const copy=new THREE.WebGLRenderTarget(2,2,{type:THREE.UnsignedByteType,depthBuffer:true,depthTexture:new THREE.DepthTexture(2,2,THREE.UnsignedIntType),generateMipmaps:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
 copy.texture.name='Soft particles _CameraDepthTexture';
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(9),3));geometry.setDrawRange(0,0);geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),0);
 const hook=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({transparent:false,depthTest:false,depthWrite:false,colorWrite:false,fog:false}));
 hook.name='Soft particles depth copy';hook.renderOrder=SOFT_HOOK_ORDER;hook.frustumCulled=false;hook.raycast=()=>{};hook.userData.shadowFlags={source:'set'};
 function blit(target){const gl=renderer.getContext(),props=renderer.properties,src=props.get(target).__webglFramebuffer;
  if(!src||Array.isArray(src)||!target.depthTexture||!gl.blitFramebuffer)return false;
  const w=target.width,h=target.height;if(copy.width!==w||copy.height!==h){copy.setSize(w,h);copy.depthTexture.image.width=w;copy.depthTexture.image.height=h;}
  if(!blitRenderTarget(renderer,target,copy,gl.DEPTH_BUFFER_BIT))return false;copies++;return true;}
 hook.onBeforeRender=(r,s,camera)=>{const target=r.getRenderTarget();U.softOn.value=0;
  if(!enabled||SOFT_PARTICLE_DEBUG.disabled){lastCopy='off';return;}
  if(!wantsSceneDepth({enabled,frame:D.frame,lastDraw:D.last})){lastCopy='no-soft-particles';return;}
  if(!target||target!==post?.target?.()){lastCopy='no-camera-image';return;}
  if(!blit(target)){failed++;lastCopy='blit-unavailable';return;}
  U.softDepth.value=copy.depthTexture;U.softNearFar.value.set(camera.near,camera.far);U.softInvScreen.value.set(1/target.width,1/target.height);U.softOn.value=1;lastCopy='copied';};
 scene.add(hook);
 post?.requestTarget?.('SoftParticles',()=>!SOFT_PARTICLE_DEBUG.disabled&&wantsSceneDepth({enabled,frame:D.frame,lastDraw:D.last}));
 return {hook,copy,
  // QualitySettings.softParticles of the current level.
  setEnabled(on){enabled=Boolean(on);if(!enabled){U.softOn.value=0;U.softDepth.value=null;}},
  get enabled(){return enabled;},
  // Around the world and view-model passes: soft fading is off unless the hook copied the world depth into this frame's
  // camera image. The view-model pass draws into the same image (its "View Model/Particles" Additive (Front) and Alpha
  // Blend programs fade against the world depth, the main camera drew them in the original).
  beginWorld(){D.frame++;U.softOn.value=0;},
  // The texture is cleared too: the menu scene's own renderer shares these programs' uniforms.
  endFrame(){U.softOn.value=0;U.softDepth.value=null;},
  state:()=>({enabled,copies,failed,lastCopy,wanted:wantsSceneDepth({enabled,frame:D.frame,lastDraw:D.last}),lastDrawAgo:D.frame-D.last,size:[copy.width,copy.height]}),
  dispose(){scene.remove(hook);post?.requestTarget?.('SoftParticles',null);copy.dispose();geometry.dispose();hook.material.dispose();}};
}
