// Builds the read-only tools/data ISO for the isolated server-test VM (SERVER-TESTING-PLAN.md §3 step 5, §7 item 4).
// Runs on the HOST; packaging only: it copies files, hashes them and calls tools/new-iso-image.ps1 (Windows' built-in
// IMAPI2FS COM). It downloads nothing and never opens or runs anything it packages (the server zip stays zipped).
//   node tools/build-vm-iso.mjs [--zip <RustLegacyServer.zip>] [--installers <dir>] [--out <iso>] [--no-line-of-sight]
//   node tools/build-vm-iso.mjs --handoff <serverId> <enrolmentCode>    → tiny RLB_HANDOFF ISO for 10-Enrol-Gateway.ps1
// ISO layout (volume RLB_VMTEST, UDF):
//   README.txt, MANIFEST.sha256 (sha256 *path for every other file)
//   app/            our code: tools/gateway.mjs, tools/adapter-sidecar.mjs, bridge/, the browser/*.mjs they import,
//                   node_modules packages they import, package.json, deploy/vm-test/ (configs, scripts, RUNBOOK.md),
//                   browser/assets/recovered subset (anti-cheat limits, NGC registry, line-of-sight collision),
//                   adapter/ (build outputs from build/vm-test/adapter, plus adapter/patcher sources for reference)
//   server/RustLegacyServer.zip   (SHA-256 verified against the recorded value; never extracted on the host)
//   installers/     owner-supplied official installers copied from --installers (default build/vm-test/installers)
import {createHash} from 'node:crypto';
import {createReadStream,existsSync,mkdirSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync,copyFileSync} from 'node:fs';
import {dirname,join,relative,resolve,sep,posix} from 'node:path';
import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import {builtinModules} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const settings=JSON.parse(readFileSync(join(repo,'deploy/vm-test/settings.json'),'utf8'));

export async function sha256File(path){
 const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex').toUpperCase();
}

// Static ESM import closure of the entry files: relative files plus bare package names (node: builtins skipped).
export function importClosure(entries,root=repo){
 const files=new Set(),packages=new Set(),missing=[];
 const queue=entries.map(e=>resolve(root,e));
 const specRe=[/\b(?:import|export)\b[^;'"`]*?\bfrom\s*['"]([^'"]+)['"]/g,/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,/(?:^|;|\n)\s*import\s+['"]([^'"]+)['"]/g];
 while(queue.length){
  const file=queue.pop();if(files.has(file))continue;
  if(!existsSync(file)){missing.push(relative(root,file));continue;}
  files.add(file);
  const src=readFileSync(file,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
  for(const re of specRe)for(const m of src.matchAll(re)){
   const spec=m[1];
   if(spec.startsWith('node:')||builtinModules.includes(spec))continue;
   if(spec.startsWith('.')||spec.startsWith('/'))queue.push(resolve(dirname(file),spec));
   else packages.add(spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0]);
  }
 }
 // Packages' own runtime dependencies (package.json "dependencies"), recursively.
 const pkgQueue=[...packages];
 while(pkgQueue.length){
  const name=pkgQueue.pop(),pj=join(root,'node_modules',name,'package.json');
  if(!existsSync(pj)){missing.push('node_modules/'+name);continue;}
  for(const dep of Object.keys(JSON.parse(readFileSync(pj,'utf8')).dependencies??{}))if(!packages.has(dep)){packages.add(dep);pkgQueue.push(dep);}
 }
 return {files:[...files].map(f=>relative(root,f)).sort(),packages:[...packages].sort(),missing};
}

function walk(dir){const out=[];for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())out.push(...walk(p));else if(e.isFile())out.push(p);}return out;}
function copyInto(stage,src,dest){const d=join(stage,dest);mkdirSync(dirname(d),{recursive:true});copyFileSync(src,d);}
function copyTree(stage,srcDir,destDir,filter=()=>true){for(const f of walk(srcDir)){const rel=relative(srcDir,f);if(filter(rel))copyInto(stage,f,join(destDir,rel));}}

export async function findServerZip(explicit){
 const want=settings.server.zipSha256.toUpperCase(),bytes=settings.server.zipBytes,name=settings.server.zipName;
 const candidates=[explicit,join(repo,'analysis',name),join(repo,'..','..','workspaces',repo.split(sep).pop(),name)].filter(Boolean);
 // Then a shallow search of the user's orca folders (depth 4, no node_modules/.git).
 const search=(dir,depth)=>{if(depth<0)return;let ents;try{ents=readdirSync(dir,{withFileTypes:true});}catch{return;}
  for(const e of ents){const p=join(dir,e.name);if(e.isFile()&&e.name===name)candidates.push(p);else if(e.isDirectory()&&!/^(node_modules|\.git|\.claude)$/.test(e.name))search(p,depth-1);}};
 search(join(homedir(),'orca'),4);
 const tried=[];
 for(const c of [...new Set(candidates.map(p=>resolve(p)))]){
  if(!existsSync(c)){continue;}
  if(statSync(c).size!==bytes){tried.push(`${c}: size ${statSync(c).size}`);continue;}
  const h=await sha256File(c);if(h===want)return c;tried.push(`${c}: SHA-256 ${h}`);
 }
 throw Error(`No ${name} with SHA-256 ${want} found.${tried.length?' Rejected:\n  '+tried.join('\n  '):''}`);
}

function runIso(stage,out,label){
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(repo,'tools','new-iso-image.ps1'),'-SourceDir',stage,'-Output',out,'-VolumeName',label],{stdio:'inherit',windowsHide:true});
 if(r.status!==0)throw Error('new-iso-image.ps1 failed ('+r.status+')');
}

async function writeManifest(stage){
 const lines=[];
 for(const f of walk(stage).sort()){const rel=relative(stage,f).split(sep).join(posix.sep);if(rel==='MANIFEST.sha256')continue;lines.push(`${(await sha256File(f)).toLowerCase()} *${rel}`);}
 writeFileSync(join(stage,'MANIFEST.sha256'),lines.join('\n')+'\n');return lines.length;
}

function signatureReport(dir){
 if(!existsSync(dir)||!walk(dir).some(f=>/\.(msi|exe)$/i.test(f)))return [];
 const ps=`Get-ChildItem -LiteralPath '${dir.replace(/'/g,"''")}' -Recurse -File | Where-Object { $_.Extension -in '.msi','.exe' } | ForEach-Object { $s = Get-AuthenticodeSignature -LiteralPath $_.FullName; '{0}|{1}|{2}' -f $_.Name, $s.Status, $(if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { '' }) }`;
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{encoding:'utf8',windowsHide:true});
 return r.stdout.trim().split(/\r?\n/).filter(Boolean).map(l=>{const [name,status,signer]=l.split('|');return {name,status,signer};});
}

async function buildHandoff([serverId,code]){
 if(!/^[0-9a-f-]{36}$/.test(serverId??'')||!/^[A-Za-z0-9_-]{20,64}$/.test(code??''))throw Error('usage: --handoff <serverId> <enrolmentCode>');
 const base=join(repo,'build','vm-test'),stage=join(base,'handoff-stage'),out=join(base,'rlb-handoff.iso');
 rmSync(stage,{recursive:true,force:true});mkdirSync(stage,{recursive:true});
 writeFileSync(join(stage,'handoff.json'),JSON.stringify({serverId,enrolmentCode:code,createdAt:new Date().toISOString()},null,1)+'\n');
 runIso(stage,out,settings.vm.handoffVolumeLabel);rmSync(stage,{recursive:true,force:true});
 console.log(`Handoff ISO: ${out}\nAttach it to the VM's CD drive, run 10-Enrol-Gateway.ps1 -Apply within 15 minutes, then detach and delete it (it holds a one-use enrolment code).`);
}

async function main(argv){
 if(argv[0]==='--handoff')return buildHandoff(argv.slice(1));
 const opt=k=>{const i=argv.indexOf(k);return i>=0?argv[i+1]:undefined;};
 const base=join(repo,'build','vm-test');
 const out=resolve(opt('--out')??join(base,'rlb-vm-tools.iso')),stage=join(base,'stage');
 const installers=resolve(opt('--installers')??join(base,'installers'));
 const lineOfSight=!argv.includes('--no-line-of-sight');
 const gaps=[];

 console.log('Locating and verifying the server zip...');
 const zip=await findServerZip(opt('--zip'));
 console.log('  ',zip,'OK');

 rmSync(stage,{recursive:true,force:true});mkdirSync(stage,{recursive:true});
 // Our code: import closure of the gateway and sidecar entry points, plus the whole bridge/ folder (schemas, profiles).
 const closure=importClosure(['tools/gateway.mjs','tools/adapter-sidecar.mjs']);
 if(closure.missing.length)throw Error('Unresolved imports: '+closure.missing.join(', '));
 const appFiles=new Set([...closure.files,...walk(join(repo,'bridge')).map(f=>relative(repo,f)),'package.json']);
 for(const f of appFiles)copyInto(stage,join(repo,f),join('app',f));
 for(const p of closure.packages)copyTree(stage,join(repo,'node_modules',p),join('app','node_modules',p));
 copyTree(stage,join(repo,'deploy','vm-test'),join('app','deploy','vm-test'));
 // Recovered data the gateway reads (tools/gateway.mjs, bridge/line-of-sight.mjs).
 const rec=join(repo,'browser','assets','recovered'),recOut=join('app','browser','assets','recovered');
 const recFiles=['player.json','items/manifest.json'];
 if(lineOfSight)recFiles.push('manifest.json');
 for(const f of recFiles){if(!existsSync(join(rec,f)))throw Error('missing recovered file '+f+' (export browser/assets/recovered first)');copyInto(stage,join(rec,f),join(recOut,f));}
 copyTree(stage,join(rec,'ngc'),join(recOut,'ngc'));
 if(lineOfSight){
  const terrain=JSON.parse(readFileSync(join(rec,'manifest.json'),'utf8'));copyInto(stage,join(rec,terrain.heightFile),join(recOut,terrain.heightFile));
  for(const d of ['scene','resources','deployables'])copyTree(stage,join(rec,d),join(recOut,d));
 }else gaps.push('Built with --no-line-of-sight: set "anticheat": {"lineOfSight": false} or use 11-Start-Bridge.ps1 -NoLineOfSight.');
 // Adapter/patcher build outputs (host/Build-AdapterOutputs.ps1) and their sources for reference.
 const built=join(base,'adapter');
 if(existsSync(join(built,'RustLegacyBrowser.Vanilla.dll'))&&existsSync(join(built,'patcher','VanillaPatcher.exe')))copyTree(stage,built,join('app','adapter'));
 else gaps.push('Adapter/patcher build outputs missing (build/vm-test/adapter). P4+ needs them: run deploy/vm-test/host/Build-AdapterOutputs.ps1 -AllowNuGetRestore (downloads NuGet packages), then rebuild this ISO. P0-P3 do not need them.');
 for(const f of ['adapter/vanilla/RustLegacyBrowserVanilla.cs','adapter/vanilla/RustLegacyBrowserVanilla.Evidence.cs','adapter/vanilla/RustLegacyBrowser.Vanilla.csproj','tools/vanilla-patcher/Program.cs','tools/vanilla-patcher/VanillaPatcher.csproj','tools/vanilla-patcher/README.md'])copyInto(stage,join(repo,f),join('app','adapter','src',f));
 copyInto(stage,zip,join('server',settings.server.zipName));
 // Installers slot: whatever the owner downloaded from the official sites. Never fetched by this script.
 mkdirSync(installers,{recursive:true});
 if(!existsSync(join(installers,'PUT-OFFICIAL-INSTALLERS-HERE.txt')))writeFileSync(join(installers,'PUT-OFFICIAL-INSTALLERS-HERE.txt'),'Drop official installers here before building the ISO (see deploy/vm-test/RUNBOOK.md):\n  node-v<LTS>-x64.msi   https://nodejs.org/en/download (Windows Installer .msi, x64)\n  Wireshark-<ver>-x64.exe https://www.wireshark.org/download.html (bundles Npcap)\n  ProcessMonitor.zip, TCPView.zip  https://learn.microsoft.com/sysinternals/\n');
 copyTree(stage,installers,'installers');
 const sigs=signatureReport(installers);
 if(!walk(installers).some(f=>/node-v.*-x64\.msi$/i.test(f)))gaps.push('No Node.js LTS MSI in the installers slot: the VM cannot run the gateway/sidecar until one is added (rebuild the ISO).');
 for(const s of sigs)if(s.status!=='Valid')gaps.push(`Installer ${s.name} signature: ${s.status}`);

 const zipHash=settings.server.zipSha256;
 writeFileSync(join(stage,'README.txt'),[
  'Rust Legacy browser port - isolated server-test VM tools (volume RLB_VMTEST, read-only)',
  `Built ${new Date().toISOString()} on the host by tools/build-vm-iso.mjs. Nothing was downloaded to build it.`,'',
  'Use ONLY inside the isolated test VM. Step-by-step: app/deploy/vm-test/RUNBOOK.md',
  'Scripts (run in an elevated PowerShell inside the VM, from this disc or C:\\RLB\\app after 02-Install-Tools):',
  '  powershell -ExecutionPolicy Bypass -File <drive>:\\app\\deploy\\vm-test\\scripts\\00-Test-Isolation.ps1','',
  'Every script prints its plan and changes nothing without -Apply; 07-Start-Server.ps1 (the only one that runs an',
  'original binary) needs -ConfirmRunOriginalBinaries and a passing isolation check.','',
  `server/${settings.server.zipName}: ${settings.server.zipBytes} bytes, SHA-256 ${zipHash} (analysis/INITIAL-FINDINGS.md)`,
  `Our code: ${closure.files.length} files from the gateway/sidecar import closure + bridge/, packages: ${closure.packages.join(', ')}`,
  `Line-of-sight data: ${lineOfSight?'included':'not included'}`,
  `Installers: ${sigs.length?sigs.map(s=>`${s.name} (${s.status}; ${s.signer})`).join('; '):'none'}`,'',
  'Known gaps at build time:',...(gaps.length?gaps.map(g=>'  - '+g):['  none']),'',
  'MANIFEST.sha256 lists the SHA-256 of every other file; 02-Install-Tools.ps1 verifies it before copying.',''].join('\r\n'));
 const count=await writeManifest(stage);

 console.log(`Staged ${count} files; writing ISO...`);
 mkdirSync(dirname(out),{recursive:true});
 runIso(stage,out,settings.vm.isoVolumeLabel);
 const isoHash=await sha256File(out),size=statSync(out).size;
 writeFileSync(out+'.sha256',`${isoHash.toLowerCase()} *${out.split(sep).pop()}\n`);
 // Contents listing next to the ISO (top-level summary + every file).
 const listing=walk(stage).map(f=>[relative(stage,f).split(sep).join('/'),statSync(f).size]).sort((a,b)=>a[0]<b[0]?-1:1);
 const tops={};for(const [p,s] of listing){const k=p.split('/').slice(0,p.startsWith('app/')?2:1).join('/');tops[k]=(tops[k]??0)+s;}
 writeFileSync(out.replace(/\.iso$/i,'')+'.contents.txt',listing.map(([p,s])=>`${String(s).padStart(12)}  ${p}`).join('\n')+'\n');
 rmSync(stage,{recursive:true,force:true});
 console.log(`\nISO: ${out}\nSize: ${size} bytes (${(size/2**20).toFixed(1)} MiB)\nSHA-256: ${isoHash}`);
 console.log('Top-level contents:');for(const [k,s] of Object.entries(tops))console.log(`  ${(s/2**20).toFixed(1).padStart(8)} MiB  ${k}`);
 if(gaps.length){console.log('\nGaps:');for(const g of gaps)console.log('  - '+g);}
 return {out,size,isoHash,gaps};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exit(1);});
}
