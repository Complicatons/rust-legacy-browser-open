// Aerial layer for the Island page: orthographic top-down renders of the original world by our browser port
// (game page ?dev&aerial, explorerDev.aerialTile), stitched into a tile pyramid by tools/site_map_tiles.py.
// Needs the GPU; output (derived from recovered assets) goes to ignored site/generated/map/aerial/.
//   node tools/capture-aerial.mjs [mpp=0.5]
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createServer} from './serve.mjs';
import {launchOptions} from './qa-browser.mjs';
import {WINDOW} from './site-map.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const RAW=path.join(root,'site/generated/map/aerial-raw');

export async function captureAerial({mpp=0.5,tilePx=1024}={}){
 const span=tilePx*mpp,nx=Math.ceil((WINDOW.x1-WINDOW.x0)/span),nz=Math.ceil((WINDOW.z1-WINDOW.z0)/span);
 await rm(RAW,{recursive:true,force:true});await mkdir(RAW,{recursive:true});
 const server=createServer();await listenServer(server);
 const browser=await chromium.launch(launchOptions()),errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?dev&aerial&fresh`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.explorerState?.frames>5&&window.explorerDev?.aerialTile,{},{timeout:180000});
  await page.evaluate(()=>{window.explorerDev.setQuality(1);window.explorerDev.setTime(12.5);});
  await page.waitForFunction(()=>window.explorerState.frames>40,{},{timeout:120000});
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
   const cx=WINDOW.x0+span*(i+.5),cz=WINDOW.z0+span*(j+.5);
   // Two renders per tile: the first lets textures and tree batches for the new view upload.
   await page.evaluate(a=>window.explorerDev.aerialTile(a),{cx,cz,span,px:tilePx});
   const url=await page.evaluate(a=>window.explorerDev.aerialTile(a),{cx,cz,span,px:tilePx});
   await writeFile(path.join(RAW,`${i}_${j}.png`),Buffer.from(url.split(',')[1],'base64'));
   process.stdout.write(`\raerial ${j*nx+i+1}/${nx*nz}`);
  }
  process.stdout.write('\n');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
 if(errors.length)throw Error('Browser errors during capture:\n'+errors.slice(0,5).join('\n'));
 await writeFile(path.join(RAW,'raw.json'),JSON.stringify({window:WINDOW,mpp,tilePx,nx,nz,span}));
 execFileSync(process.env.PYTHON??'C:/Python314/python.exe',['-I',path.join(root,'tools/site_map_tiles.py'),'aerial'],{stdio:'inherit'});
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await captureAerial({mpp:Number(process.argv[2]??0.5)});
