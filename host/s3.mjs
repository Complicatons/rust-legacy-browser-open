// A small S3-compatible client for off-site backups (host/offsite.mjs): AWS Signature Version 4 with node:crypto and
// fetch, no SDK. PUT, GET, HEAD, DELETE and ListObjectsV2, path style or virtual-host style, any region and endpoint,
// so AWS S3, Backblaze B2, Cloudflare R2 (region "auto") and Wasabi all work. The payload is always signed with its
// real SHA-256 (not UNSIGNED-PAYLOAD), so the store itself refuses an upload that arrives changed.
// The endpoint is the owner's own setting: https only, except a loopback address (a local MinIO or test server).
import {createHash,createHmac} from 'node:crypto';
import {createReadStream,createWriteStream,statSync,unlinkSync,renameSync} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export const hashHex=data=>createHash('sha256').update(data).digest('hex');
const hmac=(key,data)=>createHmac('sha256',key).update(data).digest();
// RFC 3986 unreserved characters stay; everything else is %XX (encodeURIComponent leaves !'()* alone, SigV4 does not).
const enc=s=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const amzDate=d=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
export const LOOPBACK=h=>h==='127.0.0.1'||h==='localhost'||h==='[::1]'||h==='::1';

// Returns the headers to send (host, x-amz-date, authorization added) and the intermediate strings for tests.
// Every header passed in is signed. path segments are encoded once (S3 does not double-encode).
export function signV4({method,url,headers={},payloadHash,region,service='s3',accessKeyId,secretAccessKey,sessionToken,date=new Date()}){
 const u=new URL(url),t=amzDate(date),day=t.slice(0,8);
 const h={};for(const [k,v] of Object.entries(headers))h[k.toLowerCase()]=String(v);
 h.host??=u.host;h['x-amz-date']=t;if(sessionToken)h['x-amz-security-token']=sessionToken;
 const names=Object.keys(h).sort();
 const canonHeaders=names.map(k=>`${k}:${h[k].trim().replace(/\s+/g,' ')}\n`).join('');
 const path=u.pathname.split('/').map(s=>enc(decodeURIComponent(s))).join('/')||'/';
 const query=[...u.searchParams].map(([k,v])=>[enc(k),enc(v)]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:a[1]>b[1]?1:0).map(([k,v])=>`${k}=${v}`).join('&');
 const canonicalRequest=[method,path,query,canonHeaders,names.join(';'),payloadHash].join('\n');
 const scope=`${day}/${region}/${service}/aws4_request`;
 const stringToSign=['AWS4-HMAC-SHA256',t,scope,hashHex(canonicalRequest)].join('\n');
 const key=hmac(hmac(hmac(hmac('AWS4'+secretAccessKey,day),region),service),'aws4_request');
 const signature=createHmac('sha256',key).update(stringToSign).digest('hex');
 h.authorization=`AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
 return {headers:h,canonicalRequest,stringToSign,signature};
}

const BUCKET=/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
// The object URL. Path style: <endpoint>/<bucket>/<key>; virtual-host style: <bucket>.<endpoint host>/<key>.
export function s3Url({endpoint,bucket,pathStyle=true},key,query=''){
 let e;try{e=new URL(endpoint);}catch{throw Error('The S3 endpoint must be a URL such as https://s3.us-east-1.amazonaws.com');}
 if(e.protocol!=='https:'&&!(e.protocol==='http:'&&LOOPBACK(e.hostname)))throw Error('The S3 endpoint must use https (plain http only for a loopback test server)');
 if((e.pathname!=='/'&&e.pathname!=='')||e.search||e.username)throw Error('The S3 endpoint must be just the scheme and host, such as https://s3.us-east-1.amazonaws.com');
 if(!BUCKET.test(bucket??''))throw Error('The bucket name must be 3 to 63 lower-case letters, digits, dots or dashes');
 const k=String(key).split('/').map(enc).join('/');
 return new URL(pathStyle?`${e.origin}/${bucket}/${k}${query}`:`${e.protocol}//${bucket}.${e.host}/${k}${query}`);
}

const xmlAll=(xml,tag)=>[...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`,'g'))].map(m=>m[1]);
const unxml=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
async function fail(res,what){
 const text=await res.text().catch(()=>'');
 const code=xmlAll(text,'Code')[0],msg=xmlAll(text,'Message')[0];
 throw Object.assign(Error(`${what}: ${res.status}${code?' '+code:''}${msg?' ('+unxml(msg).slice(0,200)+')':''}`),{status:res.status===404?404:502,code});
}

// opts: {endpoint, region, bucket, accessKeyId, secretAccessKey, sessionToken?, pathStyle, fetch?, now?}
export function createS3Client(opts){
 const f=opts.fetch??fetch,region=opts.region||'us-east-1';
 const call=async(method,key,{query='',headers={},payloadHash=hashHex(''),body,duplex}={})=>{
  const url=s3Url(opts,key,query);
  const s=signV4({method,url:url.href,headers:{...headers,'x-amz-content-sha256':payloadHash},payloadHash,region,accessKeyId:opts.accessKeyId,secretAccessKey:opts.secretAccessKey,sessionToken:opts.sessionToken,date:new Date(opts.now?.()??Date.now())});
  const {host,...send}=s.headers; // fetch sets Host itself, from the URL that was signed
  return f(url,{method,headers:send,body,duplex,redirect:'error',signal:AbortSignal.timeout(opts.timeoutMs??30*60e3)});
 };
 return {
  // Uploads a local file; sha256 is the file's hex SHA-256 (the store checks it against the signed header).
  async putFile(key,file,sha256){
   const bytes=statSync(file).size;
   const res=await call('PUT',key,{headers:{'content-length':String(bytes),'content-type':'application/octet-stream'},payloadHash:sha256,body:Readable.toWeb(createReadStream(file)),duplex:'half'});
   if(!res.ok)await fail(res,`Upload of ${key} failed`);await res.arrayBuffer();
   return {bytes};
  },
  async putText(key,text){
   const body=Buffer.from(text);
   const res=await call('PUT',key,{headers:{'content-length':String(body.length),'content-type':'application/json'},payloadHash:hashHex(body),body});
   if(!res.ok)await fail(res,`Upload of ${key} failed`);await res.arrayBuffer();
  },
  async head(key){
   const res=await call('HEAD',key);
   if(res.status===404)return null;if(!res.ok)await fail(res,`Checking ${key} failed`);
   return {bytes:Number(res.headers.get('content-length'))};
  },
  async getText(key,maxBytes=1<<20){
   const res=await call('GET',key);if(!res.ok)await fail(res,`Download of ${key} failed`);
   const b=Buffer.from(await res.arrayBuffer());if(b.length>maxBytes)throw Error(`${key} is larger than expected`);return b.toString('utf8');
  },
  // Streams an object to a local file (via <file>.part), refusing more than maxBytes.
  async getFile(key,file,maxBytes){
   const res=await call('GET',key);if(!res.ok)await fail(res,`Download of ${key} failed`);
   let n=0;const cap=async function*(src){for await(const c of src){n+=c.length;if(n>maxBytes)throw Error(`${key} is larger than its set says`);yield c;}};
   try{await pipeline(Readable.fromWeb(res.body),cap,createWriteStream(file+'.part'));renameSync(file+'.part',file);}
   catch(e){try{unlinkSync(file+'.part');}catch{}throw e;}
   return {bytes:n};
  },
  async delete(key){const res=await call('DELETE',key);if(!res.ok&&res.status!==404)await fail(res,`Delete of ${key} failed`);await res.arrayBuffer();},
  // ListObjectsV2, following continuation tokens. Returns [{key, bytes, at}].
  async list(prefix){
   const out=[];let token=null;
   for(let page=0;page<1000;page++){
    const q='?'+new URLSearchParams({'list-type':'2',prefix,...(token?{'continuation-token':token}:{})}).toString();
    const res=await call('GET','',{query:q});if(!res.ok)await fail(res,'Listing the bucket failed');
    const xml=await res.text();
    for(const c of xmlAll(xml,'Contents'))out.push({key:unxml(xmlAll(c,'Key')[0]??''),bytes:Number(xmlAll(c,'Size')[0]??0),at:Date.parse(xmlAll(c,'LastModified')[0]??'')||null});
    if(xmlAll(xml,'IsTruncated')[0]!=='true')return out;
    token=unxml(xmlAll(xml,'NextContinuationToken')[0]??'');if(!token)return out;
   }
   return out;
  },
 };
}
