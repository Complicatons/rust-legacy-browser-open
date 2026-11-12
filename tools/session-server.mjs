// Browser-port transport harness. This is NOT an implementation of legacy uLink/1069.
import {readFile} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {Vector3} from 'three';
import {LegacyMotor} from '../browser/motor.mjs';
import {buildOriginalCollision} from '../browser/collision.mjs';
import {sampleTriangle,worldToGrid} from '../browser/terrain.mjs';
const base=new URL('../browser/assets/recovered/',import.meta.url);
export async function createSessionAPI(){
 const config=JSON.parse(await readFile(new URL('player.json',base))),manifest=JSON.parse(await readFile(new URL('scene/manifest.json',base)));
 const bytes=await readFile(new URL('heights.f32',base)),full=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 const size=2049,ground=(x,z)=>sampleTriangle(full,size,...worldToGrid(x,z,16000,size-1)); // all original samples, as the browser uses
 async function binary(desc,T){const b=await readFile(new URL('scene/'+desc.file,base));return new T(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));}
 const world=await buildOriginalCollision({manifest,binary},ground),players=new Map();
 const warehouse=manifest.instances.find(i=>i.name==='Warehouse1'),[lo,hi]=warehouse.worldBounds;
 const spawn=new Vector3(hi[0]+3,ground(hi[0]+3,hi[2]+3)+0.002,hi[2]+3);
 let previous=performance.now(),tick=0;
 const clock=setInterval(()=>{const now=performance.now(),dt=Math.min((now-previous)/1000,0.1);previous=now;tick++;
  for(const [id,p] of players){if(now-p.lastSeen>120000){players.delete(id);continue;}p.motor.update(dt,now-p.lastInput<250?p.input:{},p.yaw);}
 },1000/60);
 function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
 async function body(req){if(req.headers['content-type']!=='application/json')throw Error('Expected JSON');let data='';for await(const chunk of req){data+=chunk;if(data.length>4096)throw Error('Request too large');}return JSON.parse(data||'{}');}
 function auth(req){const id=req.headers['x-session-id'],p=players.get(id);if(!p)throw Error('Unauthorized');const supplied=Buffer.from(req.headers.authorization?.replace(/^Bearer /,'')||''),expected=Buffer.from(p.token);if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw Error('Unauthorized');p.lastSeen=performance.now();return p;}
 return {close(){clearInterval(clock);players.clear();},async handle(req,res){try{
  const allowedOrigin=`http://127.0.0.1:${req.socket.localPort}`;
  if(req.headers.origin&&req.headers.origin!==allowedOrigin){send(res,403,{error:'Origin rejected'});return;}
  const route=req.url.split('?')[0];
  if(route==='/api/session'&&req.method==='POST'){
   if(players.size>=4){send(res,429,{error:'Local test session is full'});return;}
   const data=await body(req),id=randomBytes(8).toString('hex'),token=randomBytes(24).toString('hex');const motor=new LegacyMotor(config,world);motor.teleport(spawn.clone());
   players.set(id,{id,token,name:String(data.name||'Player').slice(0,24),motor,input:{},yaw:0,pitch:0,seq:-1,lastInput:0,lastSeen:performance.now()});
   send(res,201,{id,token,protocol:'local-port-test-v1',limitations:['Original uLink protocol, native authentication, combat, survival and peer animation are not implemented.']});return;
  }
  const p=auth(req);
  if(route==='/api/input'&&req.method==='POST'){
   const d=await body(req);
   if(!Number.isSafeInteger(d.seq)||d.seq<=p.seq||![d.forward,d.right,d.yaw,d.pitch].every(Number.isFinite)||Math.abs(d.forward)>1||Math.abs(d.right)>1||Math.abs(d.yaw)>1000||Math.abs(d.pitch)>Math.PI/2||!['sprint','crouch','jump'].every(k=>typeof d[k]==='boolean')){send(res,400,{error:'Invalid input'});return;}
   p.input={forward:d.forward,right:d.right,sprint:d.sprint,crouch:d.crouch,jump:d.jump};p.yaw=d.yaw;p.pitch=d.pitch;p.seq=d.seq;p.lastInput=performance.now();send(res,200,{accepted:p.seq});return;
  }
  if(route==='/api/state'&&req.method==='GET'){
   send(res,200,{protocol:'local-port-test-v1',tick,players:[...players.values()].map(p=>({id:p.id,name:p.name,seq:p.seq,feet:p.motor.feet.toArray(),height:p.motor.height,eye:p.motor.eye,velocity:p.motor.velocity.toArray(),grounded:p.motor.grounded,yaw:p.yaw,pitch:p.pitch}))});return;
  }
  if(route==='/api/session'&&req.method==='DELETE'){players.delete(p.id);send(res,200,{left:true});return;}
  send(res,404,{error:'Unknown endpoint'});
 }catch(error){send(res,error.message==='Unauthorized'?401:400,{error:error.message==='Unauthorized'?'Unauthorized':'Invalid request'});}}
 };
}
