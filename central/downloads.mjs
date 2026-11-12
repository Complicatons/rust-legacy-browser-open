// Downloads (HOST-APP-PLAN.md "Owner installer", the /downloads page): the host app's installer and the game loader, each
// with its signed release manifest, and (H11, owner decision 2 of 29 Oct 2026) the kit-update release feed that a running
// host polls for server-part updates (host/release-feed.mjs). All served from the folder in central's config
// `downloadsDir` (the files are build output, uploaded by the hosting runbook, never in git).
//   GET /downloads/host/latest.json              the host installer's signed manifest (host/release.mjs), always revalidated
//   GET /downloads/host/<file>                   RustLegacyHostSetup-<version>.exe and its .sha256 (immutable names)
//   GET /downloads/loader/latest.json            the game loader's signed manifest, always revalidated
//   GET /downloads/loader/<file>                 RustLegacyLoader-<version>.zip and its .sha256 (immutable names)
//   GET /download/host, /download/loader         redirect to the file the product's latest.json names
//   GET /downloads/updates/release-feed.json      the signed kit-update feed (host/release-feed.mjs), always revalidated
//   GET /downloads/updates/rlb-<version>.tar      a kit update tar (tools/build-kit-update.mjs output, immutable names)
// Anything else, or no downloadsDir, falls through (404).
import {createReadStream,existsSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';

const PRODUCTS={
 host:{name:/^(latest\.json|RustLegacyHostSetup-\d+\.\d+\.\d+\.exe(\.sha256)?)$/,docs:'/docs/install-the-host-app'},
 loader:{name:/^(latest\.json|RustLegacyLoader-\d+\.\d+\.\d+\.zip(\.sha256)?)$/,docs:'/docs/the-game-loader'},
};
const UPDATES_NAME=/^(release-feed\.json|rlb-\d{1,5}\.\d{1,5}\.\d{1,5}(-[0-9A-Za-z.]{1,40})?\.tar)$/;
const TYPES={'.json':'application/json','.exe':'application/vnd.microsoft.portable-executable','.zip':'application/zip','.sha256':'text/plain; charset=utf-8','.tar':'application/x-tar'};
const extOf=name=>name.endsWith('.sha256')?'.sha256':name.slice(name.lastIndexOf('.'));

export function createDownloadsHandler(dir){
 if(!dir)return ()=>false;
 const updatesFolder=join(dir,'updates');
 const serve=(req,res,f,name,ext)=>{
  let size;try{size=statSync(f).size;}catch{return false;}
  res.writeHead(200,{'Content-Type':TYPES[ext],'Content-Length':size,'X-Content-Type-Options':'nosniff',
   'Cache-Control':(name==='latest.json'||name==='release-feed.json')?'no-cache':'public, max-age=31536000, immutable',
   ...(ext==='.exe'||ext==='.zip'?{'Content-Disposition':`attachment; filename="${name}"`}:{})});
  if(req.method==='HEAD'){res.end();return true;}
  createReadStream(f).pipe(res);
  return true;
 };
 return (req,res)=>{
  if(req.method!=='GET'&&req.method!=='HEAD')return false;
  const path=new URL(req.url,'http://central').pathname;
  const d=/^\/download\/(host|loader)$/.exec(path);
  if(d){
   const p=PRODUCTS[d[1]],folder=join(dir,d[1]);
   let file=null;try{file=JSON.parse(Buffer.from(JSON.parse(readFileSync(join(folder,'latest.json'),'utf8')).manifest,'base64').toString('utf8')).file;}catch{}
   const ok=typeof file==='string'&&file!=='latest.json'&&p.name.test(file)&&existsSync(join(folder,file));
   res.writeHead(302,{Location:ok?`/downloads/${d[1]}/${file}`:p.docs,'Cache-Control':'no-store'});res.end();return true;
  }
  const mu=/^\/downloads\/updates\/([^/]+)$/.exec(path);
  if(mu)return UPDATES_NAME.test(mu[1])?serve(req,res,join(updatesFolder,mu[1]),mu[1],mu[1].endsWith('.tar')?'.tar':'.json'):false;
  const m=/^\/downloads\/(host|loader)\/([^/]+)$/.exec(path);
  if(!m||!PRODUCTS[m[1]].name.test(m[2]))return false;
  return serve(req,res,join(dir,m[1],m[2]),m[2],extOf(m[2]));
 };
}
