// Builds the Rust Legacy host app installer (HOST-APP-PLAN.md "Installer", "Owner installer"): the kit folder
// build/host-installer/RustLegacyHost/, RustLegacyHost.zip beside it, and RustLegacyHostSetup.exe (the zip inside a small
// wizard: what owners download). Packaging only: it runs nothing it packages.
//   app\      the host app, website, gateway and sidecar code (import closure + their data folders), the setup scripts
//             (so scripts mode works from an installed copy), the npm packages they use and the dashboard fonts, plus
//             what Setup's "existing server" installs: adapter/RustLegacyBrowser.cs (Oxide) and, at
//             app\build\vm-test\adapter, the vanilla adapter DLL and VanillaPatcher.exe (Build-AdapterOutputs.ps1)
//   node\     this machine's node.exe (MIT) and its licence
//   service\  RustLegacyHostService.exe, compiled here from host/service-wrapper with the .NET Framework compiler
//             every Windows has (no third-party service tool)
//   desktop\  RustLegacyHost.exe, the desktop app (host/desktop, .NET 8 WinForms + WebView2, `dotnet publish`,
//             framework-dependent like the game loader), with an icon drawn here from host/dashboard/icon.svg.
//             Needs the .NET 8 SDK; --no-desktop leaves it out (the installer then adds no shortcuts to it)
//   Install-RustLegacyHost.ps1, Uninstall-RustLegacyHost.ps1, README.txt, version.txt (package.json's version)
// The recovered game assets (browser/assets/recovered) stay out unless --with-assets: they are private, so only a
// private kit may carry them. Without them the website does not serve the game itself and the gateway's line-of-sight
// checks are off; owners whose players come from the project website do not need either.
// Code signing (tools/code-sign.mjs): when RLB_SIGN_* is set, the service wrapper, the desktop app, the patcher and the
// setup program are signed; otherwise the build says plainly that they are unsigned.
// --release: build/host-installer/release/RustLegacyHostSetup-<version>.exe, its .sha256, and latest.json, the installer
// manifest signed with the project's release key, as the update feed is (RLB_RELEASE_KEY = path to its signing-<uuid>.pem;
// host/release.mjs, tools/publish-release.mjs keygen). These go to the website's downloads folder (/downloads/host/).
//   node tools/build-host-installer.mjs [--out <dir>] [--adapter <dir>] [--with-assets] [--no-zip] [--no-desktop] [--release]
import {existsSync,mkdirSync,readdirSync,statSync,copyFileSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {dirname,join,relative,resolve,sep,posix} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {importClosure} from './build-vm-iso.mjs';
import {TAR} from './kit-install.mjs';
import {signFiles,signingConfig} from './code-sign.mjs';
import {signInstaller,verifyInstaller,PRODUCT} from '../host/release.mjs';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fwd=p=>p.split(sep).join(posix.sep);
const walk=d=>readdirSync(d).flatMap(n=>{const p=join(d,n),s=statSync(p);return s.isDirectory()?walk(p):s.isFile()?[p]:[];});
export const HOST_VERSION=JSON.parse(readFileSync(join(repo,'package.json'),'utf8')).version; // the feed's app version too (host/release-feed.mjs)
export const ENTRY_POINTS=['host/service.mjs','host/setup.mjs','host/mock-game-server.mjs','tools/central.mjs','tools/gateway.mjs','tools/adapter-sidecar.mjs','tools/kit-install.mjs'];
// Folders the tools read at run time (data files, the dashboard, the website and game page, the setup scripts).
const TREES=['host/dashboard','bridge','central','site','browser','deploy/host-test','deploy/azure-test','deploy/host-app'];
// The Oxide adapter (the plugin manager, the health check and Setup's existing-server step use it) and, once the project
// has a release key, its public half (host/release-feed.mjs KIT_KEY).
const EXTRA_FILES=['package.json','HOST-APP-PLAN.md','adapter/RustLegacyBrowser.cs','host/release-feed.pub.pem'];
const EXTRA_PACKAGES=['@dimforge/rapier3d-compat','@fontsource-variable/archivo','@fontsource/jetbrains-mono','@xterm/xterm','@xterm/addon-fit']; // fonts and the terminal panel's renderer (host/service.mjs VENDOR)
const RECOVERED=/^browser\/assets\/recovered\//;
// The website's built output (npm run build:site, roadmap media, wiki data: git-ignored, hundreds of MB) never goes in a
// kit; a checkout that has it (or a junction to one) would otherwise ship it.
const GENERATED=/^site\/generated\//;
const ADAPTER_FILES=['RustLegacyBrowser.Vanilla.dll','patcher/VanillaPatcher.exe'];
const FRAMEWORK=join(process.env.WINDIR??'C:/Windows','Microsoft.NET','Framework64','v4.0.30319');
const sha256=f=>createHash('sha256').update(readFileSync(f)).digest('hex').toUpperCase();

export function hostAppFiles(root=repo,{withAssets=false}={}){
 const closure=importClosure(ENTRY_POINTS,root);
 if(closure.missing.length)throw Error('Unresolved imports: '+closure.missing.join(', '));
 const files=new Set([...closure.files.map(f=>fwd(relative(root,f))),...EXTRA_FILES.filter(f=>existsSync(join(root,f)))]);
 for(const t of [...TREES,...[...new Set([...closure.packages,...EXTRA_PACKAGES])].map(p=>'node_modules/'+p)]){
  const src=join(root,t);if(!existsSync(src))throw Error('missing '+t);
  for(const f of walk(src)){const rel=fwd(relative(root,f));if(GENERATED.test(rel))continue;if(withAssets||!RECOVERED.test(rel))files.add(rel);}
 }
 return [...files].sort();
}

export function compileWrapper(out){
 const csc=join(process.env.WINDIR??'C:/Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 if(!existsSync(csc))throw Error('The .NET Framework 4 compiler was not found at '+csc);
 mkdirSync(dirname(out),{recursive:true});
 const r=spawnSync(csc,['/nologo','/target:exe','/platform:anycpu','/optimize+','/r:System.ServiceProcess.dll','/out:'+out,join(repo,'host','service-wrapper','RustLegacyHostService.cs')],{encoding:'utf8',windowsHide:true});
 if(r.status!==0)throw Error('csc failed: '+(r.stdout+r.stderr).trim());
 return out;
}

// The app icon: host/dashboard/icon.svg (a 32-unit square: near-black, an orange square, a teal bar along its foot)
// drawn at each icon size with exact area coverage, as 32-bit BMP images in one .ico.
export const ICON_RECTS=[[0,0,32,32,[10,10,10]],[7,7,25,25,[205,90,40]],[7,21,25,25,[95,169,160]]];
export function iconIco(sizes=[16,20,24,32,40,48,64,256]){
 const images=sizes.map(n=>{
  const px=Buffer.alloc(n*n*4),mask=Math.ceil(n/32)*4*n,k=32/n;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
   let c=[0,0,0];
   for(const [x0,y0,x1,y1,col] of ICON_RECTS){
    const cover=Math.max(0,Math.min(x1,(x+1)*k)-Math.max(x0,x*k))*Math.max(0,Math.min(y1,(y+1)*k)-Math.max(y0,y*k))/(k*k);
    c=c.map((v,i)=>v*(1-cover)+col[i]*cover);
   }
   const o=((n-1-y)*n+x)*4; // bottom-up rows, BGRA
   px[o]=Math.round(c[2]);px[o+1]=Math.round(c[1]);px[o+2]=Math.round(c[0]);px[o+3]=255;
  }
  const head=Buffer.alloc(40);
  head.writeUInt32LE(40,0);head.writeInt32LE(n,4);head.writeInt32LE(n*2,8);head.writeUInt16LE(1,12);head.writeUInt16LE(32,14);head.writeUInt32LE(px.length+mask,20);
  return Buffer.concat([head,px,Buffer.alloc(mask)]); // an all-clear AND mask: the alpha channel decides
 });
 const dir=Buffer.alloc(6+16*sizes.length);dir.writeUInt16LE(1,2);dir.writeUInt16LE(sizes.length,4);
 let at=dir.length;
 sizes.forEach((n,i)=>{const e=6+16*i;dir.writeUInt8(n>=256?0:n,e);dir.writeUInt8(n>=256?0:n,e+1);dir.writeUInt16LE(1,e+4);dir.writeUInt16LE(32,e+6);dir.writeUInt32LE(images[i].length,e+8);dir.writeUInt32LE(at,e+12);at+=images[i].length;});
 return Buffer.concat([dir,...images]);
}

// dotnet publish of host/desktop into <out> (the kit's desktop folder), framework-dependent, with the drawn icon.
export function buildDesktop(out){
 const ico=join(repo,'build','host-desktop','RustLegacyHost.ico');mkdirSync(dirname(ico),{recursive:true});writeFileSync(ico,iconIco());
 const r=spawnSync('dotnet',['publish',join(repo,'host','desktop','RustLegacyHost.csproj'),'-c','Release','-r','win-x64','--self-contained','false','-nologo','-v','q','-o',out,'-p:AppIcon='+ico],{encoding:'utf8',windowsHide:true});
 if(r.error)throw Error('The .NET 8 SDK (dotnet) is needed to build the desktop app ('+r.error.message+'); --no-desktop builds the kit without it');
 if(r.status!==0)throw Error('dotnet publish failed: '+(r.stdout+r.stderr).trim());
 return join(out,'RustLegacyHost.exe');
}


// RustLegacyHostSetup.exe: host/setup-exe/RustLegacyHostSetup.cs with the kit zip as the resource "RustLegacyHost.zip".
// manifest: tests build a copy that runs without administrator rights (its /snapshot mode installs nothing).
export function compileSetup({zip,out,work,manifest=join(repo,'host','setup-exe','RustLegacyHostSetup.manifest')}){
 const csc=join(FRAMEWORK,'csc.exe');if(!existsSync(csc))throw Error('The .NET Framework 4 compiler was not found at '+csc);
 mkdirSync(work,{recursive:true});
 const info=join(work,'BuildInfo.cs'),icon=join(work,'setup.ico');
 writeFileSync(info,`// Generated by tools/build-host-installer.mjs\nstatic class BuildInfo { public const string Version = "${HOST_VERSION}"; }\n`);
 writeFileSync(icon,iconIco());
 const r=spawnSync(csc,['/nologo','/target:winexe','/platform:anycpu','/optimize+',`/win32manifest:${manifest}`,`/win32icon:${icon}`,`/resource:${zip},RustLegacyHost.zip`,
  ...['System.Windows.Forms','System.Drawing','System.IO.Compression','System.IO.Compression.FileSystem','System.Web.Extensions'].map(x=>`/r:${x}.dll`),
  '/out:'+out,join(repo,'host','setup-exe','RustLegacyHostSetup.cs'),info],{encoding:'utf8',windowsHide:true,maxBuffer:1<<24});
 if(r.status!==0)throw Error('csc failed: '+(r.stdout+r.stderr).trim());
 return out;
}

export function buildHostInstaller({out=join(repo,'build','host-installer'),withAssets=false,zip=true,desktop=true,setup=zip,adapterDir=join(repo,'build','vm-test','adapter'),release=false,releaseKey=process.env.RLB_RELEASE_KEY,env=process.env,log=console.log}={}){
 if(release&&(!releaseKey||!existsSync(releaseKey)))throw Error('--release needs RLB_RELEASE_KEY: the path to the project release key, signing-<uuid>.pem (tools/publish-release.mjs keygen)');
 const kit=join(out,'RustLegacyHost');rmSync(kit,{recursive:true,force:true});mkdirSync(kit,{recursive:true});
 const files=hostAppFiles(repo,{withAssets});
 for(const f of files){const dst=join(kit,'app',f);mkdirSync(dirname(dst),{recursive:true});copyFileSync(join(repo,f),dst);}
 mkdirSync(join(kit,'node'),{recursive:true});copyFileSync(process.execPath,join(kit,'node','node.exe'));
 const licence=join(dirname(process.execPath),'LICENSE');if(existsSync(licence))copyFileSync(licence,join(kit,'node','LICENSE'));
 const wrapper=compileWrapper(join(kit,'service','RustLegacyHostService.exe'));
 if(desktop)buildDesktop(join(kit,'desktop'));
 const app=desktop?join(kit,'desktop','RustLegacyHost.exe'):null;
 // The vanilla adapter and patcher for Setup's "browser ready" (the same path inside the app as in the repository).
 const adapter=ADAPTER_FILES.every(f=>existsSync(join(adapterDir,f)));
 if(adapter)for(const f of ADAPTER_FILES){const dst=join(kit,'app','build','vm-test','adapter',f);mkdirSync(dirname(dst),{recursive:true});copyFileSync(join(adapterDir,f),dst);}
 else if(release)throw Error(`A release needs the vanilla adapter and patcher in ${adapterDir} (deploy/vm-test/host/Build-AdapterOutputs.ps1)`);
 else log(`!! no vanilla adapter in ${adapterDir}: this kit cannot make a stock server browser ready (Oxide still works)`);
 const toSign=[wrapper,...(app?[app]:[]),...(adapter?[join(kit,'app','build','vm-test','adapter','patcher','VanillaPatcher.exe')]:[])];
 const signing=signingConfig(env)?signFiles(toSign,{env,log}):{signed:false,reason:'no code-signing certificate is configured (RLB_SIGN_*)'};
 for(const s of ['Install-RustLegacyHost.ps1','Uninstall-RustLegacyHost.ps1'])copyFileSync(join(repo,'deploy','host-app',s),join(kit,s));
 writeFileSync(join(kit,'version.txt'),HOST_VERSION+'\r\n');
 writeFileSync(join(kit,'README.txt'),[
  `Rust Legacy Host ${HOST_VERSION}`,
  '',
  'Runs your own Rust Legacy server with the gateway that lets browser players in, watches it, and gives you a dashboard',
  'on http://127.0.0.1:28100/ (this PC only) and on the website.',
  '',
  'Most owners run RustLegacyHostSetup.exe instead of this folder. To install from here:',
  '1. Open PowerShell as administrator in this folder.',
  '2. .\\Install-RustLegacyHost.ps1           shows what it will do and changes nothing',
  '3. .\\Install-RustLegacyHost.ps1 -Apply    installs, starts the service and prints your sign-in link',
  '   Add -ServerDir "C:\\path\\to\\your\\server" to attach an existing server as it is, -DesktopShortcut for a desktop',
  '   shortcut, -StartAtSignIn to keep the app in the tray from sign-in.',
  '',
  desktop?'Then open Rust Legacy Host from the Start menu: it signs you in by itself. Finish on its Setup page.':'This kit has no desktop app (built with --no-desktop): use the dashboard in a browser and finish on its Setup page.',
  '',
  'Your server setup (the deploy\\host-test scripts, C:\\RLB-host) keeps working on its own; the app shares its run',
  'state, so a server started either way shows on the dashboard. Uninstall-RustLegacyHost.ps1 removes the app and keeps',
  'your settings, logs and backups unless you add -RemoveData (-RestoreServer puts an attached server\'s own files back).',
  signing.signed?'':'\nThese programs are not code-signed yet.',
  withAssets?'\nThis kit contains private game assets. Do not share it.':'\nThis kit contains no game assets.',
 ].join('\r\n'));
 log(`host installer kit ${HOST_VERSION}: ${files.length} app files${withAssets?' (with recovered assets)':''}, node ${process.version}, service wrapper${app?', desktop app':''}${adapter?', vanilla adapter':''} -> ${kit}`);
 const result={kit,files,version:HOST_VERSION,signed:signing.signed};
 if(!zip)return result;
 const z=join(out,'RustLegacyHost.zip');rmSync(z,{force:true});
 const r=spawnSync(TAR,['-a','-cf',z,'-C',out,'RustLegacyHost'],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error('zip failed: '+r.stderr);
 log('zip: '+z);result.zip=z;
 if(!setup)return result;
 const exe=compileSetup({zip:z,out:join(out,'RustLegacyHostSetup.exe'),work:join(out,'setup-work')});
 if(signing.signed)signFiles([exe],{env,log});
 result.setup=exe;
 log(`setup: ${exe} (${(statSync(exe).size/1048576).toFixed(1)} MB, SHA-256 ${sha256(exe)})`);
 if(!signing.signed)log(`!! UNSIGNED: ${signing.reason}. Windows SmartScreen will warn owners; the download page says so.`);
 if(release){
  const dir=join(out,'release'),name=`RustLegacyHostSetup-${HOST_VERSION}.exe`,dst=join(dir,name);
  rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});copyFileSync(exe,dst);
  const manifest={format:'rlb-installer-1',product:PRODUCT,version:HOST_VERSION,file:name,bytes:statSync(dst).size,sha256:sha256(dst),signed:signing.signed,...(signing.signed&&env.RLB_SIGN_NAME?{signer:env.RLB_SIGN_NAME}:{}),publishedAt:Date.now()};
  const text=signInstaller(manifest,releaseKey);verifyInstaller(text,undefined,PRODUCT);
  writeFileSync(join(dir,'latest.json'),text);
  writeFileSync(join(dir,name+'.sha256'),`${manifest.sha256}  ${name}\n`);
  log(`release ${HOST_VERSION}: ${dir} (latest.json signed with the project release key); upload the folder's files to the website's downloads/host/`);
  result.release={dir,manifest};
 }
 return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const a=process.argv.slice(2),val=f=>{const i=a.indexOf(f);return i>=0?resolve(a[i+1]):undefined;};
 try{buildHostInstaller({out:val('--out'),adapterDir:val('--adapter'),withAssets:a.includes('--with-assets'),zip:!a.includes('--no-zip'),desktop:!a.includes('--no-desktop'),release:a.includes('--release')});}
 catch(e){console.error(e.message);process.exit(1);}
}
