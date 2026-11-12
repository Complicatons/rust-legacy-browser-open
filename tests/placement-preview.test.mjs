import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3,Quaternion} from 'three';
import {structureEmission,scrollST,repeat,GizmoWave,deployableBlock,outlineAlpha,gizmoMatrixU,visibleParts,createOutlineHoverMaterial,applyBlock,GREEN,RED} from '../browser/placement-preview.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const manifest=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/placement/manifest.json',import.meta.url)))):null;
const quality=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/quality/manifest.json',import.meta.url)))):null;
const byName=name=>Object.values(manifest.items).find(i=>i.item===name);
const material=key=>manifest.materials[key];
const close=(a,b,eps=1e-6)=>Math.abs(a-b)<eps;

test('every structure and deployable item previews with its original overrideMat (Custom/OutlineHover)',needsAssets,()=>{
 const items=Object.values(manifest.items);
 assert.equal(items.filter(i=>i.kind==='structure').length,16);assert.equal(items.filter(i=>i.kind==='deployable').length,19);
 for(const i of items)assert.equal(material(i.overrideMat).shader,'Custom/OutlineHover',i.item);
 // Structures: DeployableGhostHard and no aim gizmo; small deployables DeployableGhost + BounceArrow; doors/boxes the Hard pair.
 assert.equal(material(byName('Wood Wall').overrideMat).name,'DeployableGhostHard');assert.equal(byName('Wood Wall').aimGizmo,null);
 assert.equal(material(byName('Camp Fire').overrideMat).name,'DeployableGhost');assert.equal(manifest.gizmos[byName('Camp Fire').aimGizmo].name,'BounceArrow');
 assert.equal(material(byName('Wooden Door').overrideMat).name,'DeployableGhostHard');assert.equal(manifest.gizmos[byName('Wooden Door').aimGizmo].name,'BounceArrowHard');
 const c4=manifest.gizmos[byName('Explosive Charge').aimGizmo];assert.equal(c4.class,'GameGizmoWaveAnimationCarrier');assert.equal(c4.hideArrowWhenCarrierExists,1);
 assert.deepEqual(c4.carrierMaterials.map(k=>material(k).shader),['Custom/OutlineHoverCarrier','Custom/Tint Carrier']);
});

test('preview parts follow PrefabRenderer.Refresh: no LOD_LOWEST or ContextSprite renderers, submeshes counted per renderer',needsAssets,()=>{
 for(const p of Object.values(manifest.prefabs))for(const part of p.parts){assert.doesNotMatch(part.renderer,/(-lod|_LOD_LOWEST)$/i);assert.notEqual(part.renderer,'ContextHint');assert.notEqual(part.renderer,'sprite');}
 const wall=manifest.prefabs[byName('Wood Wall').prefab];assert.deepEqual(wall.parts.map(p=>[p.renderer,p.submesh]),[['WoodWall',0]]);
 // The workbench root has no renderer: its child rock's four submeshes are drawn (at the root matrix).
 const bench=manifest.prefabs[byName('Workbench').prefab];assert.deepEqual(bench.parts.map(p=>p.submesh),[0,1,2,3]);
 // The grass-displacement sprite (layer 14) is listed but the main camera's cullingMask excludes layer 14.
 const fire=manifest.prefabs[byName('Camp Fire').prefab];assert.ok(fire.parts.some(p=>p.layer===14));
 assert.deepEqual(visibleParts(fire.parts,quality.camera.cullingMask).map(p=>p.renderer),['w_ash','w_campfire']);
});

test('structure preview colour: green/red with alpha 0.5 + |sin(8t)| * 0.25; texture scrolls by Repeat(t, 30)',()=>{
 assert.deepEqual(structureEmission(true,0),{...GREEN,a:0.5});assert.deepEqual(structureEmission(false,0),{...RED,a:0.5});
 assert.ok(close(structureEmission(true,Math.PI/16).a,0.75));
 assert.deepEqual(scrollST(31),[1,1,0,1]);assert.equal(repeat(-1,30),29);
});

test('GameGizmoWaveAnimation: phase advances by frequency * elapsed ms, positive half then negative amplitude',needsAssets,()=>{
 const g=manifest.gizmos[byName('Camp Fire').aimGizmo],w=new GizmoWave(g);
 assert.ok(close(w.render(1000),0));assert.equal(w.phase,0); // first render only starts the clock
 w.render(1100);assert.ok(close(w.phase,0.125));assert.ok(close(w.value,Math.sin(0.25*Math.PI)*g.amplitudePositive));
 w.render(1500);assert.ok(close(w.phase,0.625));assert.ok(close(w.value,Math.sin((0.625*2-2)*Math.PI)*g.amplitudeNegative));
 w.render(1500);assert.ok(close(w.phase,0.625)); // same millisecond: no advance
 w.render(1900);assert.ok(close(w.phase,0.125)); // wraps past 1
 const o=w.offset();assert.ok(close(o.y,Math.fround(g.axis.y*w.value)));assert.ok(close(o.x,0));
});

test('deployable property block: gizmo colours; the wave pushes out when valid, in and out reversed when not',needsAssets,()=>{
 const g=manifest.gizmos[byName('Camp Fire').aimGizmo],w=new GizmoWave(g);w.value=0.006;
 assert.deepEqual(deployableBlock(g,w,true,1),{emission:g.good,st:[1,1,0,1],pushOut:0.006});
 assert.deepEqual(deployableBlock(g,w,false,1),{emission:g.bad,st:[1,1,0,1],pushIn:0.006,pushOut:-0.006});
});

test('Custom/OutlineHover alpha: DeployableGhostHard is faint face-on and brighter at silhouettes',needsAssets,()=>{
 const f=material(byName('Wood Wall').overrideMat).floats,p={pushOut:f._PushOut,pushIn:f._PushIn,minAlpha:f._MinAlpha,alphaScale:f._AlphaScale},d=p.pushOut-p.pushIn;
 // |V . (pOut - pIn)| = |d| |V . n|: face-on 0.14, edge-on 0.
 assert.ok(close(outlineAlpha(Math.abs(d),p),f._MinAlpha));
 assert.ok(close(outlineAlpha(0,p),(1-Math.min(1,-d))*(1-f._MinAlpha)*f._AlphaScale+f._MinAlpha));
 assert.ok(outlineAlpha(0,p)>outlineAlpha(Math.abs(d),p));
});

test('gizmo matrix: position/rotation, then the wave offset along the axis, then alternateArrowDirection',needsAssets,()=>{
 const g=manifest.gizmos[byName('Explosive Charge').aimGizmo],w=new GizmoWave(g);w.value=0.008;
 const m=gizmoMatrixU(new Vector3(1,2,3),new Quaternion(),g,w),e=m.elements;
 assert.ok(close(e[12],1)&&close(e[13],2)&&close(e[14],3+Math.fround(g.axis.z*0.008)));
 // Euler(90, 0, 0): local up turns to +Z.
 const up=new Vector3(0,1,0).transformDirection(m);assert.ok(close(up.z,1,1e-6));
});

test('OutlineHover material: uniforms from the material, property block values replace them per draw',needsAssets,()=>{
 const m=material(byName('Camp Fire').overrideMat),mat=createOutlineHoverMaterial(m,null);
 assert.ok(close(mat.uniforms.pushOut.value,m.floats._PushOut));assert.ok(close(mat.uniforms.alphaScale.value,m.floats._AlphaScale));
 assert.equal(mat.depthWrite,false);assert.equal(mat.transparent,true);
 applyBlock(mat,{emission:{r:0,g:1,b:0,a:0.6},st:[1,1,0,2],pushOut:0.004});
 assert.deepEqual(mat.uniforms.mainST.value.toArray(),[1,1,0,2]);assert.equal(mat.uniforms.pushOut.value,0.004);assert.ok(close(mat.uniforms.pushIn.value,m.floats._PushIn));
 applyBlock(mat,{emission:{r:1,g:0,b:0,a:1},st:[1,1,0,0]});assert.ok(close(mat.uniforms.pushOut.value,m.floats._PushOut)); // Clear(): back to the material's
});

test('carrier highlight materials: the outline keeps its *Carrier values, the tint takes the property block',needsAssets,async()=>{
 const {createCarrierMaterial,applyCarrierBlock}=await import('../browser/placement-preview.mjs'),{Vector2,Vector3:V3}=await import('three');
 const keys=manifest.gizmos[byName('Explosive Charge').aimGizmo].carrierMaterials,[outline,tint]=keys.map(k=>createCarrierMaterial(material(k),{}));
 const fo=material(keys[0]).floats,ft=material(keys[1]).floats;
 assert.ok(close(outline.uniforms.pushOut.value,fo._PushOutCarrier)&&close(outline.uniforms.alphaScale.value,fo._AlphaScaleCarrier));
 assert.equal(outline.side,1);assert.equal(tint.side,0);assert.equal(tint.polygonOffset,true); // Cull Front; Offset -1,-1
 const block={emission:{r:0,g:1,b:0,a:0.6},st:[1,1,0,3],pushOut:0.002};
 for(const m of [outline,tint])applyCarrierBlock(m,block,{gizmoView:new V3(1,2,3),resolution:new Vector2(800,600),t:10});
 assert.ok(close(outline.uniforms.pushOut.value,fo._PushOutCarrier));assert.equal(tint.uniforms.pushOut.value,0.002);assert.ok(close(tint.uniforms.pushIn.value,ft._PushIn));
 assert.deepEqual(outline.uniforms.unityTime.value.toArray(),[0.5,10,20,30]);assert.deepEqual(tint.uniforms.gizmoPos.value.toArray(),[1,2,3]);assert.deepEqual(outline.uniforms.mainST.value.toArray(),[1,1,0,3]);
});
