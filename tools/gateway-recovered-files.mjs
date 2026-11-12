// The files from browser/assets/recovered that a gateway with "recoveredDir" reads (tools/gateway.mjs: player.json,
// items/manifest.json, scene/manifest.json; bridge/line-of-sight.mjs: terrain, scene, trees, rocks, deployables), found
// by loading them, not by listing them by hand: a hand-made list missed deployables/manifest.json and the EU 1 gateway
// crash-looped for 7 minutes (30 Oct, 14:01Z).
//   node tools/gateway-recovered-files.mjs <recoveredDir> <out.txt>
// Copies the optional manifests into an empty folder, then loads the gateway's recovered data from it; each missing file
// it reads is copied over and the load is tried again, until it loads. The list it writes is exactly that folder.
import {mkdtempSync,mkdirSync,copyFileSync,existsSync,readFileSync,writeFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,relative,resolve} from 'node:path';
import {loadLineOfSight} from '../bridge/line-of-sight.mjs';

// Read with .catch(()=>null) by line-of-sight.mjs: a missing one is skipped silently (weaker line of sight), so they are
// copied up front when they exist and never "found" by a failed load.
const OPTIONAL=['resources/manifest.json','rockspawn/manifest.json'];

export async function gatewayRecoveredFiles(source){
 const dir=mkdtempSync(join(tmpdir(),'rlb-recovered-')),files=new Set();
 const add=f=>{const from=join(source,f);if(!existsSync(from))throw new Error(`the gateway reads ${f}, which is not in ${source}`);
  mkdirSync(dirname(join(dir,f)),{recursive:true});copyFileSync(from,join(dir,f));files.add(f.replace(/\\/g,'/'));};
 try{
  for(const f of OPTIONAL)if(existsSync(join(source,f)))add(f);
  for(let tries=0;;tries++){
   try{
    // tools/gateway.mjs run: the anti-cheat limits, weapon data and scene door IDs, then the line of sight.
    for(const f of ['player.json','items/manifest.json','scene/manifest.json'])JSON.parse(readFileSync(join(dir,f),'utf8'));
    await loadLineOfSight(dir,{trees:true});
    return {files:[...files].sort(),bytes:[...files].reduce((n,f)=>n+statSync(join(dir,f)).size,0)};
   }catch(e){
    if(e.code!=='ENOENT'||tries>2000)throw e;
    const f=relative(dir,resolve(e.path));if(f.startsWith('..')||files.has(f.replace(/\\/g,'/')))throw e;add(f);
   }
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
}

if(import.meta.url===`file://${process.argv[1].replace(/\\/g,'/').replace(/^\/?/,'/')}`||process.argv[1]?.endsWith('gateway-recovered-files.mjs')){
 const [source,out]=process.argv.slice(2);
 if(!source||!out){console.error('usage: node tools/gateway-recovered-files.mjs <recoveredDir> <out.txt>');process.exit(2);}
 const r=await gatewayRecoveredFiles(source);
 writeFileSync(out,r.files.join('\n')+'\n');console.log(`${r.files.length} files, ${(r.bytes/1048576).toFixed(1)} MB`);
}
