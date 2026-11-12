// Finds flat, buildable test ground near the default spawn: outside original no-placement zones, away from scene
// structures/rocks (25 m) and trees (12 m), above sea level. Used to pick the fixed build site in check-browser.mjs.
import {readFileSync} from 'node:fs';
import {sampleTriangle,worldToGrid} from '../browser/terrain.mjs';
const R='browser/assets/recovered/',b=readFileSync(R+'heights.f32'),h=new Float32Array(b.buffer,b.byteOffset,b.length/4);
const g=(x,zB)=>sampleTriangle(h,2049,...worldToGrid(x,zB,16000,2048));
const scene=JSON.parse(readFileSync(R+'scene/manifest.json')),zones=(scene.world.noPlacementZones??[]).map(z=>({x:z.position[0],y:z.position[1],zB:-z.position[2],r:z.radius}));
const boxes=scene.instances.map(i=>i.worldBounds).filter(b=>b&&(b[1][0]-b[0][0])<3000);
const trees=JSON.parse(readFileSync(R+'trees.json'));
const out=[];
for(let x=5000;x<=5800;x+=8)for(let zB=4500;zB<=5200;zB+=8){const y=g(x,zB);if(y<262)continue;let lo=1e9,hi=-1e9;for(let dx=-8;dx<=8;dx+=2)for(let dz=-8;dz<=8;dz+=2){const v=g(x+dx,zB+dz);lo=Math.min(lo,v);hi=Math.max(hi,v);}
 if(hi-lo>0.8)continue;if(zones.some(z=>Math.hypot(x-z.x,y-z.y,zB-z.zB)<z.r+25))continue;
 if(boxes.some(b=>x>b[0][0]-25&&x<b[1][0]+25&&zB>b[0][2]-25&&zB<b[1][2]+25))continue;
 if(trees.some(p=>Math.hypot(p[0]-x,p[2]-zB)<12))continue;
 out.push({x,zB,y:+y.toFixed(2),slope:+(hi-lo).toFixed(2),fromSpawn:Math.round(Math.hypot(x-5244,zB-4839.6))});}
out.sort((a,b)=>a.slope-b.slope||a.fromSpawn-b.fromSpawn);console.log(out.length);console.log(out.slice(0,8));
