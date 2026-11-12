// Listening on a port the OS picks (port 0) without landing on a port that fetch refuses.
// fetch (undici, also Node's global WebSocket) and browsers block the WHATWG "bad ports" with "bad port" /
// ERR_UNSAFE_PORT before connecting. Windows hands out port-0 ports from 1024 up, one after another, system-wide, so
// every listener opened while the counter passes 6665-6669 (or 6000, 10080, ...) is unreachable by fetch: several
// concurrent test files then fail at once. A chosen port is used as it is; only port 0 is re-picked.
export const FETCH_BAD_PORTS=new Set([1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,101,102,103,104,109,110,111,113,115,117,
 119,123,135,137,139,143,161,179,389,427,465,512,513,514,515,526,530,531,532,540,548,554,556,563,587,601,636,989,990,993,995,1719,1720,1723,2049,
 3659,4045,4190,5060,5061,6000,6566,6665,6666,6667,6668,6669,6679,6697,10080]);

// Resolves with the server once it listens; rejects on a listen error (EADDRINUSE for a chosen port, for example).
export async function listenServer(server,{port=0,host='127.0.0.1'}={}){
 for(let attempt=0;;attempt++){
  await new Promise((resolve,reject)=>{
   const ok=()=>{server.off('error',fail);resolve();},fail=e=>{server.off('listening',ok);reject(e);};
   server.once('listening',ok);server.once('error',fail);server.listen(port,host);
  });
  if(port!==0||!FETCH_BAD_PORTS.has(server.address().port)||attempt>=20)return server;
  await new Promise(r=>server.close(()=>r()));
 }
}
