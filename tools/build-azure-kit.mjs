// Builds the kit zip for the Azure test VM (deploy/azure-test/RUNBOOK.md). Packaging only: it copies files, hashes
// them and zips them with Windows' own .NET ZipFile. It downloads nothing and never opens or runs anything it packages
// (the server zip stays zipped).
//   node tools/build-azure-kit.mjs [--zip <RustLegacyServer.zip>] [--out <zip>]
// Zip layout (extract to C:\RLB-kit on the VM):
//   app/      our code: central, website, game page and recovered assets (central serves the game), gateway, sidecar,
//             bridge/, the node_modules packages they need, deploy/host-test + deploy/azure-test + deploy/game-vps
//             (the same kit sets up the public OVH game VPS, deploy/game-vps/README.md), the adapter build
//             outputs (build/vm-test/adapter) and their sources (for 10-Patch-TestCopy's staleness check)
//   server/RustLegacyServer.zip   (SHA-256 verified against the recorded value)
//   README.txt, MANIFEST.sha256
import {existsSync,mkdirSync,readdirSync,rmSync,statSync,writeFileSync,copyFileSync,utimesSync} from 'node:fs';
import {dirname,join,relative,resolve,sep,posix} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {importClosure,findServerZip,sha256File} from './build-vm-iso.mjs';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const walk=d=>readdirSync(d,{withFileTypes:true}).flatMap(e=>{const p=join(d,e.name);if(e.isDirectory())return walk(p);return statSync(p).isFile()?[p]:[];});
// Keep modification times: 10-Patch-TestCopy compares the adapter DLL with its sources.
function copyInto(stage,src,dest){const d=join(stage,dest);mkdirSync(dirname(d),{recursive:true});copyFileSync(src,d);const s=statSync(src);utimesSync(d,s.atime,s.mtime);}
function copyTree(stage,srcDir,destDir,filter=()=>true){for(const f of walk(srcDir)){const rel=relative(srcDir,f);if(filter(rel))copyInto(stage,f,join(destDir,rel));}}

// Files the VM needs, relative to the repo (exported for tests/azure-test-config.test.mjs).
export function kitAppFiles(root=repo){
 // kit-install and host-control are what 04-Install-KitViaHost.ps1 runs from the kit to update the host service's app.
 const closure=importClosure(['tools/central.mjs','tools/gateway.mjs','tools/adapter-sidecar.mjs','tools/kit-install.mjs','tools/host-control.mjs'],root);
 if(closure.missing.length)throw Error('Unresolved imports: '+closure.missing.join(', '));
 const files=new Set([...closure.files.map(f=>relative(root,f)),'package.json',
  'deploy/vm-test/server/server.cfg','deploy/vm-test/host/probe-gateway-cert.mjs']);
 // Rapier is served to the game page by tools/serve.mjs (not imported by the Node tools).
 const packages=[...new Set([...closure.packages,'@dimforge/rapier3d-compat'])];
 const trees=['bridge','central','site','browser','deploy/host-test','deploy/azure-test','deploy/game-vps','build/vm-test/adapter','adapter/vanilla',...packages.map(p=>'node_modules/'+p)];
 return {files:[...files].map(f=>f.split(sep).join(posix.sep)),trees,packages};
}

async function main(argv){
 const opt=k=>{const i=argv.indexOf(k);return i>=0?argv[i+1]:undefined;};
 const base=join(repo,'build','azure-test'),stage=join(base,'stage'),out=resolve(opt('--out')??join(base,'rlb-azure-kit.zip'));
 for(const f of ['build/vm-test/adapter/RustLegacyBrowser.Vanilla.dll','build/vm-test/adapter/patcher/VanillaPatcher.exe'])
  if(!existsSync(join(repo,f)))throw Error(`Missing ${f}: build it with deploy/vm-test/host/Build-AdapterOutputs.ps1`);
 console.log('Locating and verifying the server zip...');
 const zip=await findServerZip(opt('--zip'));console.log('  ',zip,'OK');
 rmSync(stage,{recursive:true,force:true});mkdirSync(stage,{recursive:true});
 const {files,trees}=kitAppFiles();
 for(const f of files)copyInto(stage,join(repo,f),join('app',f));
 for(const t of trees){const src=join(repo,t);if(!existsSync(src))throw Error('missing '+t);
  // adapter/vanilla: sources only (its bin/obj build folders are not needed; the built DLL comes from build/vm-test).
  copyTree(stage,src,join('app',t),rel=>!(t==='adapter/vanilla'&&/^(bin|obj)([\\/]|$)/.test(rel)));}
 copyInto(stage,zip,join('server','RustLegacyServer.zip'));
 writeFileSync(join(stage,'README.txt'),[
  'Rust Legacy browser port: Azure test VM kit',
  '',
  'Extract this zip to C:\\RLB-kit on the VM, then follow app\\deploy\\azure-test\\RUNBOOK.md.',
  'app\\     our own code (website, game page, gateway, sidecar, setup scripts). Private: do not share.',
  'server\\  the original server zip (verified hash). Never run anything from it directly: the scripts unpack it',
  '         into a locked-down test copy.',
  ''].join('\r\n'));
 console.log('Hashing files...');
 const lines=[];for(const f of walk(stage).sort()){const rel=relative(stage,f).split(sep).join(posix.sep);lines.push(`${(await sha256File(f)).toLowerCase()} *${rel}`);}
 writeFileSync(join(stage,'MANIFEST.sha256'),lines.join('\n')+'\n');
 rmSync(out,{force:true});mkdirSync(dirname(out),{recursive:true});
 console.log(`Zipping ${lines.length} files...`);
 const ps=`Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory('${stage.replace(/'/g,"''")}', '${out.replace(/'/g,"''")}', [IO.Compression.CompressionLevel]::Fastest, $false)`;
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{stdio:'inherit',windowsHide:true});
 if(r.status!==0)throw Error('zip failed');
 rmSync(stage,{recursive:true,force:true});
 const hash=await sha256File(out);writeFileSync(out+'.sha256',`${hash.toLowerCase()} *${posix.basename(out.split(sep).join(posix.sep))}\n`);
 console.log(`Kit: ${out}\n  ${statSync(out).size} bytes, SHA-256 ${hash}\nCopy it to the VM (Remote Desktop copy and paste) and extract it to C:\\RLB-kit.`);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exit(1);});
