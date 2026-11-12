import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {levelCentre,probabilityStart,detailTable,probabilityValue,decodeDetail,storeByte,patchBounds,distanceFade,patchTemplate,
 softVegetationFor,grassDrawn,displacementCentre,grassShadows,GRASS_CASTER_STATE} from '../browser/grass.mjs';
import {CONVARS,ConVars} from '../browser/convars.mjs';
import {present} from './helpers/assets.mjs';

const MANIFEST='browser/assets/recovered/grass/manifest.json';
const manifest=present(MANIFEST)?JSON.parse(readFileSync(MANIFEST,'utf8')):null;

test('grass draws only with grass.on and a SoftVegetation quality level (Good and above)',()=>{
 for(let i=0;i<6;i++)assert.equal(softVegetationFor(i),i>=3);
 assert.equal(grassDrawn({on:true,softVegetation:true}),true);
 assert.equal(grassDrawn({on:false,softVegetation:true}),false);
 assert.equal(grassDrawn({on:true,softVegetation:false}),false);
 assert.equal(grassDrawn({on:true,softVegetation:true,supported:false}),false);
 if(manifest)assert.deepEqual(manifest.quality.map(q=>q.softVegetation),[false,false,false,true,true,true]);
});

test('grass convars: original defaults except grass.on, which the port starts OFF (owner decision)',()=>{
 assert.equal(CONVARS['grass.on'].value,false);assert.equal(new ConVars(null).get('grass.on'),false);assert.equal(CONVARS['grass.displacement'].value,true);assert.equal(CONVARS['grass.forceredraw'].value,false);
 assert.equal(CONVARS['grass.disp_trail_seconds'].value,10);assert.equal(CONVARS['grass.shadowcast'].value,false);assert.equal(CONVARS['grass.shadowreceive'].value,true);
 const c=new ConVars(null);let seen=null;c.addEventListener('change',e=>seen=[e.name,e.value]);
 assert.equal(c.command('grass.on true').ok,true);assert.deepEqual(seen,['grass.on',true]);
});

test('saved grass.on is restored only from saves made since the Grass option existed',()=>{
 const store=values=>({values,getItem:k=>values.get(k)??null,setItem(k,v){values.set(k,v);}});
 // A save from before the option (all convars, old default grass.on true): the player still starts with grass off.
 const old=store(new Map([['rlb-convars',JSON.stringify({'grass.on':true,'input.flipy':true})]]));const legacy=new ConVars(old);
 assert.equal(legacy.get('grass.on'),false);assert.equal(legacy.get('input.flipy'),true);
 // Turning it on (Options Apply / F1 console) persists across reloads; turning it off persists too.
 legacy.set('grass.on','True');legacy.save();assert.equal(new ConVars(old).get('grass.on'),true);
 const again=new ConVars(old);again.command('grass.on false');assert.equal(new ConVars(old).get('grass.on'),false);
});

test('level centre snaps down to the level spacing (FPGrassLevel.UpdateLevel)',()=>{
 const s=0.36764705181121826;
 const [x,z]=levelCentre(10.5,-3.2,s);
 assert.equal(x,Math.fround(Math.floor(Math.fround(10.5/s))*s));assert.ok(x<=10.5&&10.5-x<s);
 assert.ok(z<=-3.2&&-3.2-z<s);
 assert.deepEqual(levelCentre(0,0,s),[0,0]);
});

test('probability quad starts gridSize*gridScale/2 floored in float32 (62 / 125 m)',()=>{
 const tp=[-7999.99951171875,0,-8000];
 const [x0,z0]=probabilityStart(0,0,tp,340,0.36764705181121826);
 assert.equal(Math.round((x0-Math.fround(7999.99951171875))*1000)/1000,-62);assert.equal(z0,8000-62);
 const [x1,z1]=probabilityStart(0,0,tp,340,0.7352941036224365);
 assert.equal(z1,8000-125); // double arithmetic would floor 124.99999 to 124
 assert.ok(Math.abs(x1-(7999.99951171875-125))<1e-3);
});

test('detail table rounds to Alpha8 bytes and decodes back to the stored ids',()=>{
 const pixels=Array.from({length:32},()=>[1,1,1,0]);[0,1,2,3,4,15].forEach((id,i)=>pixels[i][3]=id/256);
 const t=detailTable(pixels);
 for(const [i,id] of [0,1,2,3,4,15].entries()){const stored=storeByte(t.ids[i]+1/256);assert.equal(decodeDetail(stored),id);}
 assert.equal(decodeDetail(storeByte(0)),-1);
});

test('probability selection follows cumulative splat weight then cumulative slot probability',()=>{
 const pixels=Array.from({length:32},()=>[1,1,1,0]);
 // channel 1 (G): ids 5,6 with probabilities .5,.5; channel 2 (B): id 7 with .25
 pixels[4][3]=5/256;pixels[5][3]=6/256;pixels[20][3]=0.5;pixels[21][3]=0.5;pixels[8][3]=7/256;pixels[24][3]=0.25;
 const t=detailTable(pixels),id=v=>decodeDetail(storeByte(v));
 assert.equal(id(probabilityValue([0,1,0,0],0.3,t)),5);
 assert.equal(id(probabilityValue([0,1,0,0],0.7,t)),6);
 assert.equal(id(probabilityValue([0,0,1,0],0.2,t)),7);
 assert.equal(id(probabilityValue([0,0,1,0],0.6,t)),-1); // slot probabilities sum to .25 < noise
 assert.equal(id(probabilityValue([1,0,0,0],0.6,t)),-1); // channel R has no grass
 // No channel reaches the noise: row -1 clamps every lookup to texel 0 (channel R slot 0, probability 0 here).
 assert.equal(id(probabilityValue([0.1,0,0,0],0.5,t)),-1);
});

test('shipped probabilities: rock/dirt have no grass, grass and dry grass channels pick their atlas cells',{skip:!manifest},()=>{
 const t=detailTable(manifest.probabilities.pixels),id=(s,n)=>decodeDetail(storeByte(probabilityValue(s,n,t)));
 for(const n of [0.05,0.3,0.6,0.95]){assert.equal(id([1,0,0,0],n),-1);assert.equal(id([0,0,0,1],n),-1);}
 const g=new Set(),b=new Set();for(let n=0.001;n<1;n+=0.01){g.add(id([0,1,0,0],n));b.add(id([0,0,1,0],n));}
 assert.deepEqual([...g].sort(),[0,1,2,3]);assert.deepEqual([...b].sort(),[-1,2,4]); // G slots sum to 254/255
 assert.equal(manifest.atlas.textures.filter(Boolean).length,5);
});

test('patch template matches the exported patch layout',{skip:!manifest},()=>{
 for(const level of manifest.levels){
  const n=level.gridSize,t=patchTemplate(n,level.gridSpacingAtLevel,level.patches[0].patchSize);
  assert.equal(t.position.length/3,4*n*n);assert.equal(t.index.length,6*n*n);
  const b=n+3,v=b*4+2;assert.equal(t.position[v*3],Math.fround(-level.patches[0].patchSize/2+1*level.gridSpacingAtLevel));
  assert.equal(t.position[v*3+2],Math.fround(-level.patches[0].patchSize/2+3*level.gridSpacingAtLevel));
  assert.deepEqual([t.corner[v*2],t.corner[v*2+1],t.cell[v*2],t.cell[v*2+1]],[-0.5,1,1,3]);
  assert.deepEqual([...t.index.slice(b*6,b*6+6)],[b*4,b*4+2,b*4+3,b*4,b*4+3,b*4+1]);
  assert.equal(level.patches.length,16);assert.ok(manifest.meshChecks.every(c=>c.maxError<1e-5));
  // Patch cells tile the level's 340 x 340 probability grid.
  const cells=new Set(level.patches.map(p=>p.cell.join(',')));assert.equal(cells.size,16);
  for(const p of level.patches)assert.equal(p.cell[0]/n+0,Math.round((p.position[0]+level.levelSize/2-p.patchSize/2)/p.patchSize)+0);
 }
 assert.deepEqual(manifest.levels.map(l=>l.material.floats._Distance),[62.5,125]);
});

test('patch bounds use the four corner heights +-5 m; height fade reaches 0 at the level distance',()=>{
 const b=patchBounds(10,20,31.25,(x,z)=>x+z);
 assert.deepEqual(b.min,[10-15.625,(10-15.625)+(20-15.625)-5,20-15.625]);
 assert.deepEqual(b.max,[10+15.625,(10+15.625)+(20+15.625)+5,20+15.625]);
 assert.equal(distanceFade(0,0,62.5),1);assert.equal(distanceFade(62.5,0,62.5),0);
 assert.ok(Math.abs(distanceFade(30,30,62.5)-(1-2*30**4/62.5**4))<1e-12);
 assert.equal(distanceFade(55,55,62.5),0);assert.ok(distanceFade(60,0,62.5)>0); // superellipse: corners fade earlier than the axes
});

test('displacement camera re-centres only beyond 5 m, snapped to 50/512',()=>{
 const a=displacementCentre(null,10.04,20.01);const step=50/512;
 assert.deepEqual(a,[Math.round(10.04/step)*step,Math.round(20.01/step)*step]);
 assert.equal(displacementCentre(a,13,22),a);
 assert.notEqual(displacementCentre(a,20,20),a);
});

const GRASS_SHADER='analysis/grass-source/shaders/Custom_FPGrassShader.shader.txt';
test('grass shadows: DrawMesh(castShadows, receiveShadows) from grass.shadowcast / grass.shadowreceive',()=>{
 assert.deepEqual(grassShadows({drawn:true,shadowsEnabled:true,shadowcast:false,shadowreceive:true}),{cast:false,receive:true},'shipped defaults');
 assert.equal(grassShadows({drawn:true,shadowsEnabled:true,shadowcast:true,shadowreceive:true}).cast,true);
 assert.equal(grassShadows({drawn:false,shadowsEnabled:true,shadowcast:true}).cast,false,'grass off or below Good');
 assert.equal(grassShadows({drawn:true,shadowsEnabled:false,shadowcast:true}).cast,false,'no sun shadows at the level');
 assert.equal(grassShadows({drawn:true,shadowsEnabled:true,shadowcast:true,shadowreceive:false}).receive,false);
});
test('grass SHADOWCASTER pass state matches the shipped shader',{skip:!present(GRASS_SHADER)},()=>{
 const t=readFileSync(GRASS_SHADER,'utf8').replace(/\r\n/g,'\n'),i=t.indexOf('Name "SHADOWCASTER"'),pass=t.slice(i,t.indexOf('Program "vp"',i));
 assert.ok(i>0);assert.match(pass,/REQUIREOPTIONS"="SoftVegetation"/);assert.match(pass,/Cull Off/);
 assert.ok(pass.includes(`Offset ${GRASS_CASTER_STATE.polygonOffset[0]}, ${GRASS_CASTER_STATE.polygonOffset[1]}`));
 const f=t.indexOf('#ifdef FRAGMENT',i),fp=t.slice(f,t.indexOf('#endif',f));
 assert.ok(fp.includes(`texture2D (_MainTex, xlv_TEXCOORD2).w - ${GRASS_CASTER_STATE.alphaCutoff}`),fp);assert.match(fp,/discard/);
});
