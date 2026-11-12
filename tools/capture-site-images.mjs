// Captures clean screenshots of our browser port for the website (site/generated/media/*.jpg). Runs our own port only
// (game page with ?dev, UI hidden); output is derived from recovered assets, so it stays in ignored site/generated/.
//   node tools/capture-site-images.mjs            all shots      node tools/capture-site-images.mjs hero gather   some
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import {mkdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createServer} from './serve.mjs';
import {launchOptions} from './qa-browser.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),OUT=path.join(root,'site/generated/media');
const R=path.join(root,'browser/assets/recovered');
const W=1920,H=1080,CELL=16000/2048;

// Ground height (metres) at scene coordinates, bilinear over the original 2049² height grid.
async function heightSampler(){
 const buf=await readFile(path.join(R,'heights.f32')),h=new Float32Array(buf.buffer,buf.byteOffset,buf.byteLength/4),n=2049;
 return (x,z)=>{const c=(x+8000)/CELL,r=(8000-z)/CELL,c0=Math.floor(c),r0=Math.floor(r),fc=c-c0,fr=r-r0,at=(rr,cc)=>h[Math.min(n-1,Math.max(0,rr))*n+Math.min(n-1,Math.max(0,cc))];
  return at(r0,c0)*(1-fc)*(1-fr)+at(r0,c0+1)*fc*(1-fr)+at(r0+1,c0)*(1-fc)*fr+at(r0+1,c0+1)*fc*fr;};
}
// Building centroids from the original scene, for camera targets.
async function places(){
 const m=JSON.parse(await readFile(path.join(R,'scene/manifest.json'),'utf8')),find=re=>m.instances.filter(i=>re.test(i.name)&&i.worldBounds).map(i=>i.worldBounds);
 const centre=bounds=>bounds.reduce((a,[lo,hi])=>[a[0]+(lo[0]+hi[0])/2/bounds.length,a[1]+(lo[2]+hi[2])/2/bounds.length],[0,0]);
 return {smokestack:centre(find(/^SmokestackBase/)),warehouse:centre(find(/^Warehouse\d*$/).slice(0,1)),hangar:centre(find(/^Hangar/))};
}

const SHOTS={
 // The original MenuBackground scene (the game's title screen).
 async hero({browser,base}){
  const page=await browser.newPage({viewport:{width:W,height:H}});
  await page.route('**/site-capture-menu',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><head><link rel="icon" href="data:,"><style>body{margin:0}canvas{display:block}</style><script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/addons/"}}</script></head><body><canvas id="c"></canvas></body></html>'}));
  await page.goto(base+'/site-capture-menu');
  await page.evaluate(async()=>{const THREE=await import('three'),{loadMenuBackground}=await import('/menu-background.mjs');const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('#c'),antialias:true,preserveDrawingBuffer:true});renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
   const bg=await loadMenuBackground({aspect:innerWidth/innerHeight});let frames=0,last=performance.now();window.capture={get frames(){return frames;}};const draw=t=>{bg.frame(Math.min(.05,(t-last)/1000));last=t;renderer.render(bg.scene,bg.camera);frames++;requestAnimationFrame(draw);};requestAnimationFrame(draw);});
  await page.waitForFunction(()=>window.capture?.frames>90,{},{timeout:60000});
  await page.screenshot({path:path.join(OUT,'hero-menu.jpg'),type:'jpeg',quality:86});await page.close();
 },
 async explore(ctx){const [x,z]=ctx.places.smokestack,g=ctx.ground(x,z);return world(ctx,'explore',{hour:10.5,from:[x-170,g+70,z+150],to:[x,g+10,z]});},
 async gather(ctx){const t=ctx.forest,g=ctx.ground(t[0],t[1]);return world(ctx,'gather',{hour:11,from:[t[0]+6,ctx.ground(t[0]+6,t[1]+3)+1.7,t[1]+3],to:[t[0],g+3,t[1]]});},
 async dusk(ctx){const [x,z]=ctx.places.warehouse,g=ctx.ground(x,z);return world(ctx,'dusk',{hour:18.8,from:[x+140,g+40,z-120],to:[x,g+8,z]});},
 async hangar(ctx){const [x,z]=ctx.places.hangar,g=ctx.ground(x,z);return world(ctx,'hangar',{hour:14,from:[x-110,g+35,z-90],to:[x,g+6,z]});},
};

let worldPage=null;
async function world({browser,base},name,{hour,from,to}){
 if(!worldPage){
  worldPage=await (await browser.newContext({viewport:{width:W,height:H},bypassCSP:true})).newPage(); // our capture tool hides the game UI with a stylesheet
  await worldPage.goto(base+'/?dev&fresh',{waitUntil:'networkidle'});
  await worldPage.waitForFunction(()=>window.explorerState?.frames>5,{},{timeout:120000});
  await worldPage.evaluate(()=>{window.explorerDev.setQuality(1);});
  await worldPage.addStyleTag({content:'body>*:not(canvas){visibility:hidden !important}'});
 }
 await worldPage.evaluate(({hour,from,to})=>{window.explorerDev.setTime(hour);window.explorerDev.flyTo(from,to);},{hour,from,to});
 const start=await worldPage.evaluate(()=>window.explorerState.frames);
 await worldPage.waitForFunction(n=>window.explorerState.frames>n+90,start,{timeout:120000});
 await worldPage.screenshot({path:path.join(OUT,name+'.jpg'),type:'jpeg',quality:86});
}

export async function captureSiteImages(names=Object.keys(SHOTS)){
 await mkdir(OUT,{recursive:true});
 const server=createServer();await listenServer(server);
 const browser=await chromium.launch(launchOptions()),base=`http://127.0.0.1:${server.address().port}`;
 try{
  const ground=await heightSampler(),pl=await places();
  // A tree with many neighbours inside the playable area, for the forest shot.
  const trees=JSON.parse(await readFile(path.join(R,'trees.json'),'utf8')).filter(t=>t[0]>4400&&t[0]<7000&&t[2]>3000&&t[2]<5600);
  let forest=trees[0],best=-1;for(const t of trees.filter((_,i)=>i%7===0)){const n=trees.filter(u=>Math.hypot(u[0]-t[0],u[2]-t[2])<25).length;if(n>best){best=n;forest=t;}}
  const ctx={browser,base,ground,places:pl,forest:[forest[0],forest[2]]};
  for(const name of names){if(!SHOTS[name])throw Error('Unknown shot '+name);await SHOTS[name](ctx);console.log('captured',name);}
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await captureSiteImages(process.argv.slice(2).length?process.argv.slice(2):undefined);
