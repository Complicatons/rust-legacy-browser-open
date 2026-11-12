// Fingerprints what an offline join builds, to show that a loading change builds the same objects in the same order:
// the original scene (every container, mesh and instanced batch), the terrain LOD meshes, the terrain trees, loot crate
// templates, resource node variants, deployable templates and wildlife templates (animalRenderer.templates()). Per
// object: type, name, three id, geometry id, sizes and bounds (of frustum-culled objects; the others get theirs lazily),
// local matrix, Unity layer, shadow flags, frustum culling, draw order, the instances of scene batches (by their source
// bounds: the layer culler reorders and hides instances at run time; visibility and instance counts follow the camera,
// so they are left out) and children; per material: id, name, type, flags and its textures (own properties, texture
// arrays and uniforms; numbered by first use, with size, kind, flipY, colour space, wrap, anisotropy). three sorts
// opaque draws by material id and ties by object id, so ids must keep their order.
// main.mjs is served with one extra line before its first frame that exposes the fingerprint (nothing else changes).
//   node tools/check-build-fingerprint.mjs out.json            write the fingerprint of the current files
//   node tools/check-build-fingerprint.mjs a.json b.json       compare two fingerprints (ids by order, see below)
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const [first,second]=process.argv.slice(2);
// Ids are compared by rank (their order across the whole fingerprint): other loading work running at the same time can
// create a few objects or geometries earlier or later between runs, shifting every later id by the same amount, even
// with unchanged code. Everything else must be equal.
if(second){const a=JSON.parse(await readFile(first,'utf8')),b=JSON.parse(await readFile(second,'utf8'));
 const ranked=f=>{const ids={object:new Set(),geometry:new Set(),material:new Set()};
  for(const list of Object.values(f))for(const e of list)if(e[0]!=='key'){ids.object.add(e[2]);if(e[3])ids.geometry.add(e[3][0]);for(const m of e[4])ids.material.add(m[0]);}
  const rank=Object.fromEntries(Object.entries(ids).map(([k,s])=>[k,new Map([...s].sort((x,y)=>x-y).map((id,i)=>[id,i]))]));
  return Object.fromEntries(Object.entries(f).map(([k,list])=>[k,list.map(e=>e[0]==='key'?e:[e[0],e[1],rank.object.get(e[2]),e[3]&&[rank.geometry.get(e[3][0]),...e[3].slice(1)],e[4].map(m=>[rank.material.get(m[0]),...m.slice(1)]),e[5],e[6]])]));};
 const x=ranked(a),y=ranked(b);
 for(const k of Object.keys(x)){assert.equal(y[k]?.length,x[k].length,`${k}: ${x[k].length} vs ${y[k]?.length} entries`);
  for(let i=0;i<x[k].length;i++)assert.deepEqual(y[k][i],x[k][i],`${k} entry ${i} differs`);console.log('same',k,x[k].length);}
 console.log('PASS check-build-fingerprint: same objects, materials and textures in the same order;',JSON.stringify(a)===JSON.stringify(b)?'raw ids identical too':'ids shifted by concurrent work');process.exit(0);}
assert.ok(first,'usage: node tools/check-build-fingerprint.mjs out.json [other.json]');
const {createServer}=await import('./serve.mjs'),{launchOptions,pointerLockStandIn}=await import('./qa-browser.mjs');

const FINGERPRINT=`(roots)=>{const textures=new Map(),textureIndex=t=>{if(!textures.has(t))textures.set(t,textures.size);return textures.get(t);};
 const texture=t=>[textureIndex(t),t.image?.width??null,t.image?.height??null,t.isCompressedTexture?'compressed':t.image?.constructor?.name??null,t.flipY,t.colorSpace,t.wrapS,t.wrapT,t.anisotropy];
 const material=m=>m?[m.id,m.name,m.type,m.transparent,m.depthWrite,m.side,JSON.stringify(m.defines??{}),...Object.entries(m).filter(([,v])=>v?.isTexture).map(([k,v])=>[k,...texture(v)]),
  ...Object.entries(m).filter(([,v])=>Array.isArray(v)&&v.some(t=>t?.isTexture)).map(([k,v])=>[k,...v.map(texture)]),
  ...Object.entries({...m.uniforms,...m.terrainUniforms}).filter(([,u])=>u?.value?.isTexture).map(([k,u])=>['u:'+k,...texture(u.value)])]:null;
 const sphere=g=>g.boundingSphere?[...g.boundingSphere.center.toArray(),g.boundingSphere.radius].map(x=>+x.toFixed(4)).join():null;
 const instances=o=>{const b=o.userData.instanceBounds;if(!b)return '';let h=0;for(const v of b.flat(2))h=(h*31+Math.round(v*1e4))|0;return '|I'+b.length+':'+h;};
 const out=[],walk=o=>{out.push([o.type,o.name,o.id,o.geometry?[o.geometry.id,o.geometry.index?.count??-1,o.geometry.attributes.position?.count??-1,Object.keys(o.geometry.attributes).join(),o.frustumCulled?sphere(o.geometry):null]:null,
  [o.material].flat().filter(Boolean).map(material),o.matrix.elements.map(x=>+x.toFixed(6)).join()+'|L'+o.userData.layer+'|S'+(+o.castShadow)+(+o.receiveShadow)+'|C'+(+o.frustumCulled)+o.renderOrder+instances(o),o.children.length]);for(const c of o.children)walk(c);};
 const result={};for(const [name,list] of Object.entries(roots)){out.length=0;for(const [key,value] of list){out.push(['key',key]);for(const o of [value].flat())walk(o);}result[name]=[...out];}
 return result;}`;
const HOOK=` window.__buildFingerprint=()=>(${FINGERPRINT})({scene:[['scene',originalScene.group]],terrain:[['terrain',terrainLOD.group]],trees:[['trees',trees.group]],crates:[...crateTemplates],resources:[...nodeVariants],deployables:[...deployTemplates],animals:animalRenderer.templates().map((t,i)=>[i,t])});\n`;

const server=createServer();await listenServer(server);const origin=`http://127.0.0.1:${server.address().port}`;
const profileDir=await mkdtemp(join(tmpdir(),'rlb-fingerprint-'));
const context=await chromium.launchPersistentContext(profileDir,{...launchOptions(),viewport:{width:1280,height:720}});await context.addInitScript(pointerLockStandIn);
const errors=[];
try{
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route(/\/main\.mjs(\?|$)/,async route=>{const r=await route.fetch(),body=await r.text(),anchor=/\r?\n requestAnimationFrame\(animate\);\r?\n/g;
  assert.equal(body.match(anchor)?.length,1,'one first-frame anchor in main.mjs');route.fulfill({response:r,body:body.replace(anchor,m=>'\n'+HOOK+m.replace(/^\r?\n/,''))});});
 const fe=()=>page.evaluate(()=>window.rlbFrontEnd?.state()??null).catch(()=>null);
 const until=async(fn,timeout=600000)=>{const t=Date.now();while(Date.now()-t<timeout){const v=await fn().catch(()=>null);if(v)return v;await new Promise(r=>setTimeout(r,50));}throw Error('timed out: '+fn);};
 await page.goto(origin+'/',{waitUntil:'commit'});await until(async()=>(await fe())?.menu);
 await page.locator('#front-end [data-df-name="btnPlay"]').click();await page.locator('#front-end [data-df-name="Community"]').click();
 await until(async()=>(await fe())?.rows?.some(r=>r.address==='offline'));
 await page.locator('#front-end [data-address="offline"] [data-df-name="btnHostname"]').dblclick();
 await until(async()=>(await fe())?.inGame&&await page.evaluate(()=>typeof window.__buildFingerprint==='function'));
 const result=await page.evaluate(()=>window.__buildFingerprint());
 await writeFile(first,JSON.stringify(result));
 console.log('wrote',first,Object.entries(result).map(([k,v])=>`${k} ${v.length}`).join(', '));
 assert.deepEqual(errors,[],'page errors');
}finally{await context.close();server.close();await rm(profileDir,{recursive:true,force:true}).catch(()=>{});}
