import * as THREE from 'three';
// World use-icons: original ContextSprite (decompiled ContextSprite.cs, IContextRequestableStatus, BasicDoor /
// SleepingBag / ContextActivator ContextStatusPoll, CameraFX.OnPreCull -> UpdateSpriteFading, RPOS.hideSprites) with the
// "Context/Sprite" shader (analysis/shader-source/Context_Sprite...shader.txt) and data exported statically:
//  - every ContextHint/sprite renderer uses mesh "CenteredContextMesh" (a quad from -48..48 in x/y) and material
//    "ContextSpriteTest" (the ring texture); the renderer is on layer 11 "Sprite".
//  - the scene camera's CameraLayerDepths gives layer 11 a cull distance of 5 m, spherical: a sprite is "visible"
//    (OnBecameVisible) only within 5 m of the camera.
//  - Shader: the vertex program places the quad at the object's clip-space origin and offsets it by vertex.xy screen
//    pixels times 1/screen size (NDC), i.e. a 48 x 48 pixel square whatever the distance; ZTest Always, ZWrite Off,
//    Overlay queue. Pass 1 (Blend Zero OneMinusSrcColor) darkens by min(tex.a, _Fade); pass 2 (Blend One
//    OneMinusSrcAlpha, alpha 0) adds tex.rgb * min(tex.a, _Fade): together a premultiplied "over". Both passes use
//    linear fog 1..5 m to black, which fades the icon out between 1 and 5 m.
//  - Fading (g.Step): rate elapsed / 0.15 s, fade 0..1.2 (_Fade = clamp01), "dim" ghost level 0.15. A sprite fades out
//    when behind the camera or when a ray to it hits layers Default/Static/Terrain (mask 525313) on something that is
//    not the requestable itself (IsSeeThrough); otherwise fades in, or dims when the status has SpriteFlag0 only.
//    SpriteFlag0|1: always fade in; SpriteFlag1: always fade out. RPOS open (hideSprites): all fade out.
// Approximations: the ray hits the port's collision world (static triangles, terrain and solid bodies; bodies on
// character/hitbox/debris layers are ignored); "the requestable or its children" is the requestable's world bounds;
// fog depth is the view depth of the sprite's origin; 48 pixels are device pixels.
export const SPRITE_FLAG0=0x20000000,SPRITE_FLAG1=0x40000000,OBJECT_BUSY=1;
export const SPRITE=Object.freeze({cullDistance:5,fadeDuration:0.15,maxFade:1.2,ghostFade:0.15,fogStart:1,fogEnd:5,halfSize:48,rayLayers:[0,10,19],material:'ContextSpriteTest'});

// ContextSprite.CalculateFadeOut / CalculateFadeIn / CalculateFadeDim. Each returns [fade, changed].
export function fadeOut(fade,elapsed){if(elapsed<=0)return [fade,false];if(fade<0)return [0,true];if(fade===0)return [fade,false];const n=elapsed/SPRITE.fadeDuration;return [n>=fade?0:fade-n,true];}
export function fadeIn(fade,elapsed){if(elapsed<=0)return [fade,false];if(fade>SPRITE.maxFade)return [SPRITE.maxFade,true];if(fade===SPRITE.maxFade)return [fade,false];const n=elapsed/SPRITE.fadeDuration;return [SPRITE.maxFade-fade<=n?SPRITE.maxFade:fade+n,true];}
export function fadeDim(fade,elapsed){const g=SPRITE.ghostFade;if(fade<g){const [f,c]=fadeIn(fade,elapsed);if(c)return [f>g?g:f,true];}else if(fade>g){const [f,c]=fadeOut(fade,elapsed);if(c)return [f<g?g:f,true];}return [fade,false];}
// g.Step for one visible sprite. status: ContextStatusPoll() flags or null (no IContextRequestableStatus).
// behind: the sprite's depth along its screen ray <= 0; blocked: the ray hit a non-see-through collider first.
export function stepFade(fade,dt,{status=null,behind=false,blocked=false,hidden=false}={}){
 if(dt<=0)return fade;if(hidden)return fadeOut(fade,dt)[0];
 let dim=false;if(status!=null){const f=status&(SPRITE_FLAG0|SPRITE_FLAG1);if(f===(SPRITE_FLAG0|SPRITE_FLAG1))return fadeIn(fade,dt)[0];if(f===SPRITE_FLAG1)return fadeOut(fade,dt)[0];dim=f===SPRITE_FLAG0;}
 if(behind||blocked)return fadeOut(fade,dt)[0];return (dim?fadeDim:fadeIn)(fade,dt)[0];}
// Layer cull distance (CameraLayerDepths layer11 5, spherical).
export const spriteInRange=distance=>distance<SPRITE.cullDistance;
// Fixed-function linear fog of both passes: 1 at <=1 m, 0 at >=5 m (fog colour black).
export const spriteFog=depth=>Math.min(1,Math.max(0,(SPRITE.fogEnd-depth)/(SPRITE.fogEnd-SPRITE.fogStart)));
// Resulting coverage of a texel: min(tex.a, _Fade) * fog.
export const spriteCoverage=(texAlpha,fade,depth)=>Math.min(texAlpha,Math.min(1,Math.max(0,fade)))*spriteFog(depth);
// Door status (BasicDoor.ContextStatusPoll): moving -> ObjectBusy|SpriteFlag0; opened/closed -> 0.
export const doorStatus=busy=>busy?OBJECT_BUSY|SPRITE_FLAG0:0;
// SleepingBag.ContextStatusPoll: the local player's own bag shows its sprite; anyone else's never does.
export const sleepingBagStatus=(localUserId,creatorId)=>localUserId!=null&&String(localUserId)===String(creatorId)?0:SPRITE_FLAG1;

const VERTEX=`uniform vec2 uScreen;varying vec2 vUv;varying float vFog;
void main(){vec4 o=modelViewMatrix*vec4(0.0,0.0,0.0,1.0);vec4 c=projectionMatrix*o;vFog=clamp((${SPRITE.fogEnd.toFixed(1)}+o.z)/${(SPRITE.fogEnd-SPRITE.fogStart).toFixed(1)},0.0,1.0);
 gl_Position=vec4(c.xy+position.xy*uScreen*c.w,c.z,c.w);vUv=uv;}`;
const FRAGMENT=`uniform sampler2D map;uniform float uFade;varying vec2 vUv;varying float vFog;
void main(){vec4 t=texture2D(map,vUv);float m=min(t.a,clamp(uFade,0.0,1.0))*vFog;
 gl_FragColor=vec4(sRGBTransferEOTF(vec4(t.rgb,1.0)).rgb,1.0);
 #include <colorspace_fragment>
 gl_FragColor=vec4(gl_FragColor.rgb*m,m);}`;

// raycast(ray, range) -> {distance, position, body} | null over the port's collision world.
export async function createContextSprites({scene,raycast,base='/assets/recovered/deployables/',manifest=null,renderer=null}){
 const m=manifest??await (await fetch(base+'manifest.json')).json(),mat=Object.values(m.materials).find(x=>x.name===SPRITE.material),meshDef=Object.values(m.meshes).find(x=>x.name==='CenteredContextMesh');
 if(!mat||!meshDef)throw Error('ContextSprite export missing');
 const load=async d=>new Float32Array(await (await fetch(base+d.file)).arrayBuffer());
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(await load(meshDef.position),3));geometry.setAttribute('uv',new THREE.BufferAttribute(await load(meshDef.uv),2));
 geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(await (await fetch(base+meshDef.parts[0].file)).arrayBuffer()),1));
 const texture=await new THREE.TextureLoader().loadAsync(base+mat.texture);texture.colorSpace=THREE.NoColorSpace;texture.flipY=true;
 const screen=new THREE.Vector2(1,1),sizeVec=new THREE.Vector2();
 const material=new THREE.ShaderMaterial({uniforms:{map:{value:texture},uFade:{value:0},uScreen:{value:screen}},vertexShader:VERTEX,fragmentShader:FRAGMENT,
  transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide,blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendSrcAlpha:THREE.ZeroFactor,blendDstAlpha:THREE.OneFactor});
 const sprites=new Set(),group=new THREE.Group();group.name='ContextSprites';scene.add(group);let time=0;
 const ray=new THREE.Ray(),point=new THREE.Vector3(),camPos=new THREE.Vector3(),view=new THREE.Vector3(),box=new THREE.Box3(),local=new THREE.Matrix4();
 function makeMesh(sprite){const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.renderOrder=1e6;mesh.matrixAutoUpdate=false;mesh.name='ContextSprite';
  // One material for every sprite: _Fade per draw (MaterialPropertyBlock).
  mesh.onBeforeRender=()=>{material.uniforms.uFade.value=Math.min(1,Math.max(0,sprite.fade));material.uniformsNeedUpdate=true;};return mesh;}
 function add(sprite){Object.assign(sprite,{fade:0,visible:false,removedAt:-Infinity,position:new THREE.Vector3()});sprite.mesh=makeMesh(sprite);group.add(sprite.mesh);sprites.add(sprite);return {remove:()=>remove(sprite),sprite};}
 function remove(sprite){if(!sprites.delete(sprite))return;group.remove(sprite.mesh);}
 const inScene=o=>{for(let p=o;p;p=p.parent)if(p===scene)return true;return false;};
 const api={group,material,sprites,
  // Anchor for a ContextSprite node in a prefab template (cloned with it): `matrix` is the node's local matrix.
  anchor(matrixArray){const a=new THREE.Object3D();a.name='ContextHint';a.userData.contextSprite=true;a.matrixAutoUpdate=false;a.matrix.fromArray(matrixArray);return a;},
  // Shows the sprites of an instance (its cloned anchors). status: () => ContextStatusPoll flags, or null.
  attach(root,{status=null}={}){const handles=[];root.traverse(o=>{if(o.userData.contextSprite)handles.push(add({id:root.name,anchor:o,root,status}));});return handles;},
  // A sprite placed by a world matrix provider (scene doors). own(body): the hit body belongs to the requestable.
  addPoint({id=null,matrix,status=null,own=null}){return add({id,matrixFn:matrix,status,own});},
  remove,
  update(camera,dt,{hidden=false}={}){time+=dt;if(renderer){renderer.getDrawingBufferSize(sizeVec);screen.set(1/Math.max(1,sizeVec.x),1/Math.max(1,sizeVec.y));}
   camera.getWorldPosition(camPos);
   for(const s of [...sprites]){
    if(s.anchor){if(!inScene(s.root)){remove(s);continue;}s.root.updateWorldMatrix(true,false);local.multiplyMatrices(s.root.matrixWorld,s.anchor.matrix);}else local.copy(s.matrixFn());
    s.position.setFromMatrixPosition(local);s.mesh.matrix.makeTranslation(s.position.x,s.position.y,s.position.z);s.mesh.matrixWorldNeedsUpdate=true;
    const distance=s.position.distanceTo(camPos),visible=spriteInRange(distance);
    // OnBecameVisible: g.Add continues the fade-out that ran while it was not drawn; OnBecameInvisible stamps the time.
    if(visible&&!s.visible){s.visible=true;s.fade=fadeOut(s.fade,time-s.removedAt)[0];}else if(!visible&&s.visible){s.visible=false;s.removedAt=time;}
    if(!s.visible){s.mesh.visible=false;continue;}
    // Depth along the camera ray through the sprite's screen point (= view-direction distance for a pinhole camera).
    view.copy(s.position).applyMatrix4(camera.matrixWorldInverse);const depth=-view.z,behind=depth<=0;let blocked=false;
    const status=typeof s.status==='function'?s.status():null;
    if(!hidden&&!behind&&(status==null||(status&(SPRITE_FLAG0|SPRITE_FLAG1))===0||(status&(SPRITE_FLAG0|SPRITE_FLAG1))===SPRITE_FLAG0)){
     ray.origin.copy(camPos);ray.direction.copy(s.position).sub(camPos).normalize();const hit=raycast(ray,distance);
     if(hit&&hit.distance<distance){if(s.own)blocked=!s.own(hit.body);else{box.setFromObject(s.root).expandByScalar(0.05);blocked=!box.containsPoint(hit.position??ray.at(hit.distance,point));}}}
    s.fade=stepFade(s.fade,dt,{status,behind,blocked,hidden});s.depth=depth;s.mesh.visible=s.fade>0&&depth>0;}},
  snapshot:()=>[...sprites].map(s=>({id:s.id??null,position:s.position.toArray(),visible:s.visible,fade:s.fade,drawn:s.mesh.visible,depth:s.depth??null,coverage:s.visible&&s.depth>0?Math.min(1,Math.max(0,s.fade))*spriteFog(s.depth):0}))};
 return api;
}
