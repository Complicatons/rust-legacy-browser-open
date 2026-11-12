// Builds the desktop launcher (DESKTOP-LAUNCHER-PLAN.md) into build/launcher/app:
//   RustLegacyLauncher.exe (+ WebView2 SDK DLLs)   launcher/host, .NET 8 WinForms
//   web/ui/*, web/core.mjs                          the window (launcher/ui, launcher/core.mjs)
//   proxy/steam_api.dll                             the x86 steam_api proxy (tools/build-launcher-proxy.mjs)
//   launcher.json                                   default website for new installs (--central <url>)
//   Install-/Uninstall-RustLegacyLauncher.ps1       per-user installer (deploy/launcher); run from this folder
//   Install.cmd                                     double-click entry point: runs the installer with -Apply
// The build is framework-dependent (.NET 8 Desktop Runtime on the player's PC; the installer checks for it and for the
// WebView2 Runtime). A self-contained build (`dotnet publish -r win-x64 --self-contained`, not done here) would carry
// .NET with it at well over 100 MB; the installer recognises one by its coreclr.dll and skips the .NET check.
// --release: build/launcher/release/RustLegacyLoader-<version>.zip (the app folder; version from launcher/host's csproj),
// its .sha256, and latest.json, the manifest signed with the project release key (RLB_RELEASE_KEY, as the host installer:
// host/release.mjs). These go to the website's downloads folder (/downloads/loader/). With RLB_SIGN_* set, the exe and the
// proxy are code-signed first (tools/code-sign.mjs).
//   node tools/build-launcher.mjs [--central https://your-domain.example/] [--test] [--release]
// --test also runs the proxy test (C, against a fake steam_api) and the host test (launch profile on fake game
// files, DPAPI, and the real proxy talking to the real pipe). Needs Visual Studio Build Tools (C++ x86) and the
// .NET SDK. No original game file is used or run.
import {spawnSync} from 'node:child_process';
import {cpSync,mkdirSync,rmSync,writeFileSync,copyFileSync,readFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {signInstaller,verifyInstaller,LOADER_PRODUCT,RELEASE_FILES} from '../host/release.mjs';
import {signFiles,signingConfig} from './code-sign.mjs';
import {TAR} from './kit-install.mjs';

export const LAUNCHER_SCRIPTS=['Install-RustLegacyLauncher.ps1','Uninstall-RustLegacyLauncher.ps1'];
export const LAUNCHER_CMD='Install.cmd';
const sha256=f=>createHash('sha256').update(readFileSync(f)).digest('hex').toUpperCase();
export const loaderVersion=csproj=>/<Version>(\d{1,5}\.\d{1,5}\.\d{1,5})<\/Version>/.exec(csproj)?.[1]??null;

// publicKey defaults to the shipped project key, so a build signed with any other key fails here.
// Zips a built app folder into <out>/RustLegacyLoader-<version>.zip with its .sha256 and the signed latest.json.
export function releaseLoader({app,out,version,releaseKey,publicKey,signed=false,signer=null,log=console.log}){
 if(!releaseKey||!existsSync(releaseKey))throw Error('--release needs RLB_RELEASE_KEY: the path to the project release key, signing-<uuid>.pem (tools/publish-release.mjs keygen)');
 const name=RELEASE_FILES[LOADER_PRODUCT](version),zip=path.join(out,name);
 rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
 const r=spawnSync(TAR,['-a','-cf',zip,'-C',app,...readdirSync(app)],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error('zip failed: '+r.stderr);
 const manifest={format:'rlb-installer-1',product:LOADER_PRODUCT,version,file:name,bytes:statSync(zip).size,sha256:sha256(zip),signed,...(signed&&signer?{signer}:{}),publishedAt:Date.now()};
 const text=signInstaller(manifest,releaseKey);verifyInstaller(text,publicKey,LOADER_PRODUCT);
 writeFileSync(path.join(out,'latest.json'),text);
 writeFileSync(path.join(out,name+'.sha256'),`${manifest.sha256}  ${name}\n`);
 log(`release ${version}: ${out} (${(manifest.bytes/1048576).toFixed(1)} MB, SHA-256 ${manifest.sha256}); upload the folder's files to the website's downloads/loader/`);
 return {dir:out,manifest};
}
export const FONTS=[['@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2','archivo-wdth.woff2'],
 ['@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2','jetbrains-mono-500.woff2']];
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const main=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
const args=main?process.argv.slice(2):[];
const opt=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
const run=(cmd,a,o={})=>{const r=spawnSync(cmd,a,{cwd:root,stdio:'inherit',...o});if(r.status!==0)throw new Error(`${cmd} ${a.join(' ')} failed (${r.status})`);};

if(main){
 const central=opt('--central')??'https://your-domain.example/';
 if(!/^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(central))throw new Error('--central must be https (or http to this PC)');

 run(process.execPath,['tools/build-launcher-proxy.mjs',...(args.includes('--test')?['--test']:[])]);
 const app=path.join(root,'build/launcher/app');
 rmSync(path.join(app,'web'),{recursive:true,force:true});
 run('dotnet',['build','launcher/host','-c','Release','-nologo','-v','q','-o',app]);
 mkdirSync(path.join(app,'web/ui'),{recursive:true});
 cpSync(path.join(root,'launcher/ui'),path.join(app,'web/ui'),{recursive:true});
 copyFileSync(path.join(root,'launcher/core.mjs'),path.join(app,'web/core.mjs'));
 // The website's fonts (same files as tools/build-site.mjs fonts), so the window needs no network.
 mkdirSync(path.join(app,'web/ui/fonts'),{recursive:true});
 for(const [from,to] of FONTS)copyFileSync(path.join(root,'node_modules',from),path.join(app,'web/ui/fonts',to));
 mkdirSync(path.join(app,'proxy'),{recursive:true});
 copyFileSync(path.join(root,'build/launcher/proxy/steam_api.dll'),path.join(app,'proxy/steam_api.dll'));
 writeFileSync(path.join(app,'launcher.json'),JSON.stringify({centralUrl:central},null,2)+'\n');
 for(const f of LAUNCHER_SCRIPTS)copyFileSync(path.join(root,'deploy/launcher',f),path.join(app,f));
 copyFileSync(path.join(root,'deploy/launcher',LAUNCHER_CMD),path.join(app,LAUNCHER_CMD));
 console.log(`Built ${path.relative(root,app)} (website ${central})`);

 if(args.includes('--test')){
  const out=path.join(root,'build/launcher/host-test');
  run('dotnet',['build','launcher/host/test','-c','Release','-nologo','-v','q','-o',out]);
  run(path.join(out,'LauncherHostTest.exe'),[path.join(root,'build/launcher/proxy-test')]);
 }

 if(args.includes('--release')){
  const version=loaderVersion(readFileSync(path.join(root,'launcher/host/RustLegacyLauncher.csproj'),'utf8'));
  if(!version)throw new Error('launcher/host/RustLegacyLauncher.csproj has no <Version>x.y.z</Version>');
  const env=process.env,signing=signingConfig(env)?signFiles([path.join(app,'RustLegacyLauncher.exe'),path.join(app,'proxy/steam_api.dll')],{env}):{signed:false};
  if(!signing.signed)console.log('!! UNSIGNED: no code-signing certificate is configured (RLB_SIGN_*). The download page says so.');
  releaseLoader({app,out:path.join(root,'build/launcher/release'),version,releaseKey:env.RLB_RELEASE_KEY,signed:signing.signed,signer:env.RLB_SIGN_NAME??null});
 }
}
