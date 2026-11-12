import {readdir,readFile,stat,writeFile,rename,rm} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

// Caches under the OS temp directory are shared by every server on the machine (central, the dev server, concurrent
// test files), and one may read while another writes: write a private file and rename it into place, so a reader sees
// the old file or the whole new one, never a part of one. Windows refuses the rename (EPERM) while a reader has the file
// open: a few short retries, then the error (callers treat these caches as best effort).
export async function writeFileAtomic(file,data){
 const tmp=`${file}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
 try{
  await writeFile(tmp,data);
  for(let attempt=0;;attempt++){
   try{await rename(tmp,file);return;}
   catch(e){if(!['EPERM','EACCES','EBUSY'].includes(e.code)||attempt>=5)throw e;await new Promise(r=>setTimeout(r,20*(attempt+1)));}
  }
 }catch(e){await rm(tmp,{force:true}).catch(()=>{});throw e;}
}

// Content versions of the game files, so the page can ask for `file?v=<version>` and the server can mark those answers
// immutable: a repeat visit then loads ~200 MB of game data from the browser cache with no request at all, instead of
// one revalidation round trip per file (~1,400 serial round trips over HTTP/1.1). A version is the first 16 hex digits
// of the file's SHA-256, so it survives a redeploy that resets modification times; hashes are remembered by
// size + mtime in a file under the OS temp directory, so only new or changed files are hashed after a restart.
// sources: [{url, dir}] trees served at url (subdirectories and symbolic links followed) and [{url, file}] single files.
export const versionOf=buf=>createHash('sha256').update(buf).digest('hex').slice(0,16);
export function createAssetVersions({sources,accept=()=>true,cacheFile=null,minScanMs=2000}){
 const known=new Map(),stamp=info=>info.size+'-'+info.mtimeMs;let loaded=null,last=0,scanning=null,current={generation:0,files:new Map(),stamps:new Map()};
 const load=()=>loaded??=(cacheFile?readFile(cacheFile,'utf8').then(text=>{for(const [file,[s,v]] of Object.entries(JSON.parse(text)))known.set(file,{stamp:s,v});}).catch(()=>{}):Promise.resolve());
 async function list(){const out=[];
  async function walk(dir,url){let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch{return;}
   for(const e of entries){const file=path.join(dir,e.name),u=url+encodeURIComponent(e.name);
    let isDir=e.isDirectory();if(e.isSymbolicLink())isDir=await stat(file).then(s=>s.isDirectory()).catch(()=>false);
    if(isDir)await walk(file,u+'/');else if(accept(u))out.push([u,file]);}}
  for(const s of sources){if(s.dir)await walk(s.dir,s.url);else out.push([s.url,s.file]);}
  return out;}
 // Hashes run a few at a time so a first scan of ~1.2 GB does not hold every file in memory at once.
 async function scan(){await load();const files=new Map(),stamps=new Map(),todo=[];
  for(const [url,file] of await list()){const info=await stat(file).catch(()=>null);if(!info)continue;const k=known.get(file),s=stamp(info);stamps.set(url,s);
   if(k?.stamp===s)files.set(url,k.v);else todo.push([url,file,s]);}
  let i=0;await Promise.all(Array.from({length:8},async()=>{while(i<todo.length){const [url,file,s]=todo[i++];const v=versionOf(await readFile(file));known.set(file,{stamp:s,v});files.set(url,v);}}));
  if(todo.length&&cacheFile)await writeFileAtomic(cacheFile,JSON.stringify(Object.fromEntries([...known].map(([f,k])=>[f,[k.stamp,k.v]])))).catch(()=>{});
  const same=files.size===current.files.size&&[...files].every(([u,v])=>current.files.get(u)===v);
  current={generation:current.generation+(same?0:1),files,stamps};last=Date.now();return current;}
 return {
  // The current {generation, files: Map url -> version}; rescanned (stat only, unless something changed) at most every minScanMs.
  async current(){if(scanning)return scanning;if(current.generation&&Date.now()-last<minScanMs)return current;scanning=scan().finally(()=>{scanning=null;});return scanning;},
  // The version of the file at url as last scanned, or null when it has changed since (info: its fs.Stats).
  version(url,info){return current.stamps.get(url)===stamp(info)?current.files.get(url)??null:null;},
 };
}
export const defaultCacheFile=root=>path.join(os.tmpdir(),'rlb-asset-versions-'+versionOf(root)+'.json');

// Static `import … from '…'` specifiers of an ES module (dynamic import() calls excluded).
export function staticImports(source){const out=[];for(const m of source.matchAll(/(?:^|[;\n}])\s*(?:import|export)\s*(?:[\w*{}\s,$]*?\s*from\s*)?['"]([^'"\n]+)['"]/g))out.push(m[1]);return out;}

// The page with versioned URLs: an import map that gives every module URL its version (relative imports resolve to
// these URLs, then the map adds ?v=), versioned src/href attributes, <link rel=modulepreload> for main.mjs's whole
// static import graph (one round of parallel fetches instead of one round per import depth), and the version index's
// own versioned URL in <meta name="rlb-asset-versions"> (browser/asset-versions.mjs) with a preload so it starts at once.
// readModule(url) returns a module's source (for the import graph). Returns {html, importMap}.
export async function versionedPage(template,files,{readModule,indexUrl,baseImports}){
 const v=url=>files.has(url)?url+'?v='+files.get(url):null;
 const imports={};for(const [bare,url] of Object.entries(baseImports)){if(bare.endsWith('/')){imports[bare]=url;for(const u of files.keys())if(u.startsWith(url)&&/\.m?js$/.test(u))imports[bare+u.slice(url.length)]=v(u);}else imports[bare]=v(url)??url;}
 for(const u of files.keys())if(/\.m?js$/.test(u)&&!u.startsWith('/assets/'))imports[u]=v(u);
 const importMap=JSON.stringify({imports});
 const resolve=(spec,from)=>{if(Object.hasOwn(imports,spec)&&!/^[./]/.test(spec))return imports[spec].split('?')[0];
  for(const [bare,url] of Object.entries(baseImports))if(bare.endsWith('/')&&spec.startsWith(bare))return url+spec.slice(bare.length);
  return new URL(spec,'http://page'+from).pathname;};
 const graph=new Set(),walk=async url=>{if(graph.has(url)||!files.has(url))return;graph.add(url);const source=await readModule(url).catch(()=>'');for(const s of staticImports(source))await walk(resolve(s,url));};
 const entry=template.match(/<script type="module" src="([^"]+)"/)?.[1];if(entry)await walk(entry);graph.delete(entry);
 // The import map moves into <head>, ahead of the preloads: a modulepreload answered from the cache resolves its module
 // before an import map later in the page is parsed, and the map's rules for those URLs are then dropped (seen on reload).
 const head=[`<script type="importmap">${importMap}</script>`,`<meta name="rlb-asset-versions" content="${indexUrl}">`,`<link rel="preload" as="fetch" crossorigin href="${indexUrl}">`,...[...graph].map(u=>`<link rel="modulepreload" href="${v(u)}">`)].join('');
 const html=template.replace(/<script type="importmap">[\s\S]*?<\/script>/,'')
  .replace(/\b(src|href)="(\/[^"?#]*)"/g,(m,attr,url)=>files.has(url)?`${attr}="${v(url)}"`:m).replace('</head>',head+'</head>');
 return {html,importMap};
}
