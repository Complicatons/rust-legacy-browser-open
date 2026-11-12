// API for the Settings (server), Plugins and health-check pieces, kept out of service.mjs so it stays a small edit.
// service.mjs calls this after its own checks (signed in; POST only with Origin and X-RLB-Host). Fixed routes; names
// are checked by the modules; a plugin upload is the raw request body, size-limited while it streams.
//   GET  /api/server-settings            POST /api/server-settings {version, values, other, remove, rconPassword, adapter}
//   GET  /api/plugins                    POST /api/plugins/enable|disable|remove|reload {name}
//                                        POST /api/plugins/upload?name=<Name>.cs   (body: the file)
//   GET  /api/health-check (last result) POST /api/health-check (run now)
export const TOOL_PATHS=/^\/api\/(server-settings|plugins(\/(enable|disable|remove|reload|upload))?|health-check)$/;

const readJson=(req,limit=16384)=>new Promise((res,rej)=>{let b='';req.setEncoding('utf8');req.on('data',d=>{b+=d;if(b.length>limit){rej(Object.assign(Error('too large'),{status:413}));req.destroy();}});req.on('end',()=>{try{res(b?JSON.parse(b):{});}catch{rej(Object.assign(Error('bad json'),{status:400}));}});});

export async function handleToolsApi(req,url,host,send){
 const path=url.pathname,post=req.method==='POST',res=send;
 try{
  if(path==='/api/server-settings'){
   if(!post)return res(200,host.serverSettings.read());
   return res(200,host.serverSettings.save(await readJson(req)));
  }
  if(path==='/api/plugins'){if(post)return res(405,{error:'method'});return res(200,host.plugins.status());}
  if(path==='/api/plugins/upload'){if(!post)return res(405,{error:'method'});return res(200,await host.plugins.upload(url.searchParams.get('name'),req));}
  if(path.startsWith('/api/plugins/')){
   if(!post)return res(405,{error:'method'});
   const b=await readJson(req,1024),verb=path.slice(13);
   return res(200,await host.plugins[verb](b.name));
  }
  if(path==='/api/health-check')return res(200,post?await host.healthCheck.run():host.healthCheck.last());
  return res(404,{error:'not-found'});
 }catch(e){return res(e.status??500,{error:e.message,...(e.problems?{problems:e.problems}:{})});}
}
