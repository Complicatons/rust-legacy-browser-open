// GPU texel check for loading changes: after an offline join (normal player entry), every texture of the original scene,
// terrain, trees, loot crate / resource / deployable templates and wildlife templates is drawn into a framebuffer from
// the copy the game uploaded: (a) the whole texture into 256² (uses the mip chain), (b) texelFetch of level 0 over a
// 256² window at the centre. The readPixels of each are hashed, per texture in order of first use. main.mjs is served
// with one extra line before its first frame that exposes the check (as tools/check-build-fingerprint.mjs does).
//   node tools/check-world-texels.mjs out.json          write the hashes of the current files
//   node tools/check-world-texels.mjs a.json b.json     compare two runs (every texture must match)
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const [first,second]=process.argv.slice(2);
if(second){const a=JSON.parse(await readFile(first,'utf8')),b=JSON.parse(await readFile(second,'utf8'));
 assert.equal(b.length,a.length,`${a.length} vs ${b.length} textures`);
 const differ=a.filter((x,i)=>JSON.stringify(x)!==JSON.stringify(b[i]));assert.deepEqual(differ.map(x=>x[0]),[],'textures that differ');
 console.log('PASS check-world-texels:',a.length,'textures identical on the GPU (whole texture and level 0)');process.exit(0);}
assert.ok(first,'usage: node tools/check-world-texels.mjs out.json [other.json]');
const {createServer}=await import('./serve.mjs'),{launchOptions,pointerLockStandIn}=await import('./qa-browser.mjs');
const server=createServer();await listenServer(server);const origin=`http://127.0.0.1:${server.address().port}`;
const dir=await mkdtemp(join(tmpdir(),'rlb-texels-'));const ctx=await chromium.launchPersistentContext(dir,{...launchOptions(),viewport:{width:1280,height:720}});await ctx.addInitScript(pointerLockStandIn);
const errors=[];
const HOOK=`window.__texels=async()=>{const roots=[originalScene.group,terrainLOD.group,trees.group,...crateTemplates.values(),...nodeVariants.values(),...deployTemplates.values(),...animalRenderer.templates()].flat();
 const seen=new Map();const add=(t,k)=>{if(t?.isTexture&&!seen.has(t))seen.set(t,k);};
 const visit=m=>{if(!m)return;for(const [k,v] of Object.entries(m)){if(v?.isTexture)add(v,m.name+':'+k);if(Array.isArray(v))v.forEach((t,i)=>add(t,m.name+':'+k+i));}for(const [k,u] of Object.entries({...m.uniforms,...m.terrainUniforms}))add(u?.value,m.name+':u:'+k);};
 const walk=o=>{if(o?.isObject3D){[o.material].flat().forEach(visit);o.children.forEach(walk);}};roots.forEach(walk);
 const rt=new THREE.WebGLRenderTarget(256,256),quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2)),sc=new THREE.Scene(),cam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);sc.add(quad);quad.frustumCulled=false;
 const mat=fetch=>new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms:{t:{value:null}},vertexShader:'out vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader:fetch?'uniform sampler2D t;in vec2 v;out vec4 o;void main(){ivec2 s=textureSize(t,0);ivec2 p=s/2-128+ivec2(gl_FragCoord.xy);o=texelFetch(t,clamp(p,ivec2(0),s-1),0);}':'uniform sampler2D t;in vec2 v;out vec4 o;void main(){o=texture(t,v);}'});
 const mats=[mat(false),mat(true)],buf=new Uint8Array(256*256*4),out=[];
 const hash=a=>{let h=2166136261;for(let i=0;i<a.length;i++){h^=a[i];h=Math.imul(h,16777619);}return (h>>>0).toString(16);};
 const prev=renderer.getRenderTarget();
 for(const [t,k] of seen){const r=[k,t.image?.width,t.image?.height,t.isCompressedTexture?'c':'u'];for(const m of mats){m.uniforms.t.value=t;quad.material=m;renderer.setRenderTarget(rt);renderer.render(sc,cam);renderer.readRenderTargetPixels(rt,0,0,256,256,buf);r.push(hash(buf));}out.push(r);}
 renderer.setRenderTarget(prev);return out;};\n`;
try{const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route(/\/main\.mjs(\?|$)/,async route=>{const r=await route.fetch();let b=await r.text();b=b.replace(/\r?\n requestAnimationFrame\(animate\);\r?\n/,m=>'\n'+HOOK+m.replace(/^\r?\n/,''));route.fulfill({response:r,body:b});});
 const fe=()=>page.evaluate(()=>window.rlbFrontEnd?.state()??null).catch(()=>null);
 const until=async(fn,t=600000)=>{const s=Date.now();while(Date.now()-s<t){const v=await fn().catch(()=>null);if(v)return v;await new Promise(r=>setTimeout(r,50));}throw Error('timeout');};
 await page.goto(origin+'/',{waitUntil:'commit'});await until(async()=>(await fe())?.menu);
 await page.locator('#front-end [data-df-name="btnPlay"]').click();await page.locator('#front-end [data-df-name="Community"]').click();
 await until(async()=>(await fe())?.rows?.some(r=>r.address==='offline'));
 await page.locator('#front-end [data-address="offline"] [data-df-name="btnHostname"]').dblclick();
 await until(async()=>(await fe())?.inGame&&await page.evaluate(()=>window.explorerState?.frames>20));
 const r=await page.evaluate(()=>window.__texels());await writeFile(first,JSON.stringify(r));console.log('wrote',first,r.length,'textures');
 assert.deepEqual(errors,[],'page errors');
}finally{await ctx.close();server.close();await rm(dir,{recursive:true,force:true}).catch(()=>{});}
