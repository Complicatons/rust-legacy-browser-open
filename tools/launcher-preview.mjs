// Serves the launcher window (launcher/ui + launcher/core.mjs) on 127.0.0.1 for review in a browser. Without the
// WebView2 host the page runs its demo host: a simulated website and gateway (password "demo" signs in).
//   node tools/launcher-preview.mjs [port]     then open http://127.0.0.1:<port>/ui/index.html?demo
import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {FONTS} from './build-launcher.mjs';

const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../launcher');
const modules=path.resolve(dir,'../node_modules');
const fonts=new Map(FONTS.map(([from,to])=>['/ui/fonts/'+to,path.join(modules,from)]));
const TYPES={'.woff2':'font/woff2','.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};

export function startLauncherPreview(port=4196){
 return new Promise(resolve=>{const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://x');
 if(url.pathname==='/'){res.writeHead(302,{location:'/ui/index.html?demo'});return res.end();}
 const file=fonts.get(url.pathname)??path.join(dir,path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/,''));
 if(!(fonts.has(url.pathname)||file.startsWith(dir+path.sep))||!TYPES[path.extname(file)]){res.writeHead(404);return res.end();}
 try{const body=await readFile(file);res.writeHead(200,{'content-type':TYPES[path.extname(file)],'cache-control':'no-store'});res.end(body);}
 catch{res.writeHead(404);res.end();}
});server.listen(port,'127.0.0.1',()=>resolve(server));});
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.argv[2]??4196);
 startLauncherPreview(port).then(()=>console.log(`Launcher preview: http://127.0.0.1:${port}/ui/index.html?demo`));
}
