// A small in-memory S3 stand-in for tests: path-style PUT, GET, HEAD, DELETE and ListObjectsV2 (with paging), and a
// real SigV4 check of every request (host/s3.mjs signV4 recomputed from what arrived) plus the payload SHA-256.
import {createServer} from 'node:http';
import {listenServer} from '../../bridge/listen.mjs';
import {createHash} from 'node:crypto';
import {signV4} from '../../host/s3.mjs';

export async function startFakeS3({bucket,accessKeyId,secretAccessKey,region='us-east-1',pageSize=2}){
 const objects=new Map(),log=[];
 const xml=(res,status,body)=>{res.writeHead(status,{'content-type':'application/xml'});res.end('<?xml version="1.0" encoding="UTF-8"?>\n'+body);};
 const error=(res,status,code,msg)=>xml(res,status,`<Error><Code>${code}</Code><Message>${msg}</Message></Error>`);
 const server=createServer((req,res)=>{
  const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
   const body=Buffer.concat(chunks),url=new URL(req.url,`http://${req.headers.host}`);
   const auth=String(req.headers.authorization??''),m=/^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=[0-9a-f]{64}$/.exec(auth);
   if(!m||m[1]!==accessKeyId||m[3]!==region)return error(res,403,'InvalidAccessKeyId','bad credential');
   const signed={};for(const h of m[4].split(';'))if(h!=='x-amz-date')signed[h]=req.headers[h];
   const d=String(req.headers['x-amz-date']),date=new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${d.slice(9,11)}:${d.slice(11,13)}:${d.slice(13,15)}Z`);
   const again=signV4({method:req.method,url:url.href,headers:signed,payloadHash:req.headers['x-amz-content-sha256'],region,accessKeyId,secretAccessKey,date});
   if(again.headers.authorization!==auth)return error(res,403,'SignatureDoesNotMatch','The request signature we calculated does not match');
   if(createHash('sha256').update(body).digest('hex')!==req.headers['x-amz-content-sha256'])return error(res,400,'XAmzContentSHA256Mismatch','payload hash');
   const [,b,...rest]=url.pathname.split('/'),key=rest.map(decodeURIComponent).join('/');
   if(b!==bucket)return error(res,404,'NoSuchBucket','no such bucket');
   log.push(`${req.method} ${key||url.search}`);
   if(req.method==='PUT'){objects.set(key,{body,at:Date.now()});res.writeHead(200,{etag:'"x"'});return res.end();}
   if(req.method==='DELETE'){objects.delete(key);res.writeHead(204);return res.end();}
   if((req.method==='GET'||req.method==='HEAD')&&key){
    const o=objects.get(key);if(!o){if(req.method==='HEAD'){res.writeHead(404);return res.end();}return error(res,404,'NoSuchKey','The specified key does not exist.');}
    res.writeHead(200,{'content-length':o.body.length,'content-type':'application/octet-stream'});return res.end(req.method==='HEAD'?undefined:o.body);
   }
   if(req.method==='GET'&&url.searchParams.get('list-type')==='2'){
    const prefix=url.searchParams.get('prefix')??'',after=url.searchParams.get('continuation-token')??'';
    const keys=[...objects.keys()].filter(k=>k.startsWith(prefix)&&k>after).sort(),page=keys.slice(0,pageSize),more=keys.length>pageSize;
    return xml(res,200,`<ListBucketResult><Name>${bucket}</Name><Prefix>${prefix}</Prefix><KeyCount>${page.length}</KeyCount><IsTruncated>${more}</IsTruncated>${more?`<NextContinuationToken>${page.at(-1)}</NextContinuationToken>`:''}${page.map(k=>`<Contents><Key>${k}</Key><Size>${objects.get(k).body.length}</Size><LastModified>${new Date(objects.get(k).at).toISOString()}</LastModified></Contents>`).join('')}</ListBucketResult>`);
   }
   error(res,400,'NotImplemented','not in the fake');
  });
 });
 await listenServer(server);
 return {endpoint:`http://127.0.0.1:${server.address().port}`,objects,log,close:()=>new Promise(r=>{server.closeAllConnections?.();server.close(r);})};
}
