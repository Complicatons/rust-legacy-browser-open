import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {Scene,Bone,MeshBasicMaterial,Vector3} from 'three';import {createItemModAssets,installMeshMods,modFlags,orderedMods} from '../browser/item-mods.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const base=new URL('../browser/assets/recovered/item-mods/',import.meta.url),manifest=hasRecovered?(JSON.parse(readFileSync(new URL('manifest.json',base)))):null,vm=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/viewmodels/manifest.json',import.meta.url)))):null;
const uid=name=>Object.values(manifest.mods).find(m=>m.name===name).uid;
const assets=hasRecovered?({binary:async(d,Type)=>{const b=readFileSync(new URL(d.file,base));return new Type(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));},material:async()=>new MeshBasicMaterial()}):null;
test('four original mods retain skins, socket overrides, world-effect-only prefabs and verified files',needsAssets,()=>{
 assert.equal(Object.keys(manifest.mods).length,4);for(const [file,hash]of Object.entries(manifest.outputSHA256))assert.equal(createHash('sha256').update(readFileSync(new URL(file,base))).digest('hex'),hash,file);
 assert.equal(modFlags(Object.values(manifest.mods).map(m=>m.uid),manifest),15);
 for(const name of ['Holo sight','Silencer']){const m=manifest.mods[uid(name)],p=manifest.prefabs[m.vm];assert.equal(m.rep,null);assert.ok(p.skins.length);assert.ok(p.socketOverride);for(const s of p.skins)assert.ok(s.bones.every(i=>i>=0&&i<p.skeleton.length));}
 assert.deepEqual(orderedMods([uid('Laser Sight'),uid('Holo sight')],manifest).map(m=>m.name),['Holo sight','Laser Sight']);
});
test('native mesh mods attach at animated sockets, override sight/muzzle and restore original settings on removal',needsAssets,async()=>{
 const mods=await createItemModAssets(manifest,assets),def=Object.values(vm.viewmodels).find(v=>v.name==='VM-M4'),bones=def.skeleton.map(()=>new Bone());const scene=new Scene(),view={def,bones};
 installMeshMods(view,[uid('Holo sight'),uid('Silencer')],mods,scene);assert.equal(view.mods.length,2);assert.equal(scene.children.length,3);
 assert.equal(view.settings.zoomOffset.z,Math.fround(0.2));assert.equal(view.settings.punchScalar,Math.fround(0.6));assert.equal(view.sockets.muzzle.offset[2],Math.fround(0.15));
 assert.equal(view.mods[0].root.parent,bones[def.sockets.optics.bone]);assert.equal(view.mods[1].root.parent,bones[def.sockets.muzzle.bone]);
 const first=view.mods[0];installMeshMods(view,[uid('Holo sight'),uid('Silencer')],mods,scene);assert.equal(view.mods[0],first,'unchanged snapshots do not recreate attachment skins');
 installMeshMods(view,[],mods,scene);assert.equal(scene.children.length,0);assert.equal(first.root.parent,null);assert.deepEqual(view.settings,def.settings);assert.equal(view.sockets.sight.parent,bones[def.sockets.sight.bone]);
});
test('original attachment skins deform through their exported bones with finite local bounds',needsAssets,async()=>{
 const mods=await createItemModAssets(manifest,assets),scene=new Scene();
 for(const m of Object.values(manifest.mods).filter(m=>m.isMesh)){const rig=mods.build(m.vm,scene);scene.add(rig.root);rig.root.updateMatrixWorld(true);for(const mesh of rig.meshes){mesh.skeleton.update();const p=new Vector3();for(let i=0;i<mesh.geometry.attributes.position.count;i++){mesh.getVertexPosition(i,p);assert.ok(p.toArray().every(Number.isFinite));assert.ok(p.length()<2,m.name+' skin escaped attachment root');}}
  rig.dispose();}
});
