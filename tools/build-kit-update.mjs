// Builds an update tar for the Azure test VM's kit folder C:\RLB-kit\app (deploy/azure-test/RUNBOOK.md "Kit updates").
// Packaging only, like build-azure-kit.mjs: it copies nothing into the repo and runs nothing it packages.
//   node tools/build-kit-update.mjs --out <tar> [--manifest <vm-manifest.sha256>] [--with-central] [--with-adapter] [--list]
// Files: the kit's app files (kitAppFiles), minus the central-only side (central/, site/ and what only tools/central.mjs
// imports) unless --with-central: the VM keeps the central it was set up with, and the gateway/game code does not need a
// newer one. The adapter (adapter/vanilla, build/vm-test/adapter) stays out unless --with-adapter: the VM's test copy is
// already patched, and a checkout's fresh source times would make 10-Patch-TestCopy call the DLL stale. --manifest is the VM's own manifest (deploy/azure-test/scripts/02-Send-KitManifest.ps1; lines
// "<sha256> *<path>"): only files that are new or differ from it go in. Ignored data (browser/assets/recovered,
// node_modules, build/vm-test/adapter) may be junctions to the main checkout; they are followed.
// Writes <tar>, <tar>.sha256 and <tar>.files.txt.
import {existsSync,mkdirSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {dirname,join,relative,resolve,sep,posix} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {importClosure,sha256File} from './build-vm-iso.mjs';
import {kitAppFiles} from './build-azure-kit.mjs';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fwd=p=>p.split(sep).join(posix.sep);
// statSync follows junctions/symlinks, so linked asset folders are walked too.
const walk=d=>readdirSync(d).flatMap(n=>{const p=join(d,n),s=statSync(p);return s.isDirectory()?walk(p):s.isFile()?[p]:[];});

// Repo-relative paths (forward slashes) the update may contain.
export function updateFiles(root=repo,{withCentral=false,withAdapter=false}={}){
 const {files,trees:allTrees}=kitAppFiles(root);
 const trees=withAdapter?allTrees:allTrees.filter(t=>t!=='adapter/vanilla'&&t!=='build/vm-test/adapter');
 const all=new Set(files);
 for(const t of trees){const src=join(root,t);if(!existsSync(src))throw Error('missing '+t);
  for(const f of walk(src)){const rel=fwd(relative(root,f));if(!(t==='adapter/vanilla'&&/^adapter\/vanilla\/(bin|obj)\//.test(rel)))all.add(rel);}}
 if(withCentral)return [...all].sort();
 // Keep what the gateway, sidecar and game server (tools/serve.mjs) import, even when it lives in central/.
 const shared=new Set(importClosure(['tools/gateway.mjs','tools/adapter-sidecar.mjs','tools/serve.mjs'],root).files.map(fwd));
 const centralOnly=new Set(importClosure(['tools/central.mjs'],root).files.map(fwd).filter(f=>!shared.has(f)));
 return [...all].filter(f=>!centralOnly.has(f)&&!/^(central|site)\//.test(f)||shared.has(f)).sort();
}

export function parseManifest(text){
 const m=new Map();
 for(const line of text.split(/\r?\n/)){const x=/^([0-9a-fA-F]{64}) \*(.+)$/.exec(line.trim());if(x)m.set(x[2].replace(/\\/g,'/').replace(/^app\//,''),x[1].toLowerCase());}
 return m;
}

async function main(argv){
 const opt=k=>{const i=argv.indexOf(k);return i>=0?argv[i+1]:undefined;};
 const out=resolve(opt('--out')??join(repo,'build','azure-test','updates',`rlb-kit-update-${new Date().toISOString().replace(/[-:]/g,'').slice(0,13)}.tar`));
 const files=updateFiles(repo,{withCentral:argv.includes('--with-central'),withAdapter:argv.includes('--with-adapter')});
 let pick=files;
 if(opt('--manifest')){
  const have=parseManifest(readFileSync(opt('--manifest'),'utf8'));
  if(!have.size)throw Error('empty or unreadable manifest '+opt('--manifest'));
  pick=[];for(const f of files)if(have.get(f)!==(await sha256File(join(repo,f))).toLowerCase())pick.push(f);
 }
 const bytes=pick.reduce((n,f)=>n+statSync(join(repo,f)).size,0);
 console.log(`${pick.length} of ${files.length} files, ${(bytes/1048576).toFixed(1)} MB`);
 if(argv.includes('--list'))for(const f of pick)console.log('  '+f);
 if(!pick.length){console.log('Nothing to update.');return;}
 mkdirSync(dirname(out),{recursive:true});
 writeFileSync(out+'.files.txt',pick.join('\n')+'\n');
 // Windows' own bsdtar (keeps modification times: 10-Patch-TestCopy compares the adapter DLL with its sources).
 const tar=process.platform==='win32'?join(process.env.SystemRoot??'C:\\Windows','System32','tar.exe'):'tar';
 const r=spawnSync(tar,['-cf',out,'-C',repo,'-T',out+'.files.txt'],{stdio:'inherit',windowsHide:true});
 if(r.status!==0)throw Error('tar failed');
 const hash=(await sha256File(out)).toLowerCase();
 writeFileSync(out+'.sha256',`${hash} *${posix.basename(fwd(out))}\n`);
 console.log(`Update: ${out}\n  ${statSync(out).size} bytes, SHA-256 ${hash}`);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exit(1);});
