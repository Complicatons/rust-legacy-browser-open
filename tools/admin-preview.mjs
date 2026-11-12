// Local preview of the admin pages with sample data (no game server, nothing leaves this machine):
//   node tools/admin-preview.mjs [port]   → http://127.0.0.1:<port>/admin
// An in-memory central with dev sign-in, one server whose "gateway" reports a roster, an anti-cheat flag that asks for
// an automatic screenshot (answered with analysis/site-captures/game-capture.jpg if present, else a site picture), a
// manual one that fails, alt links and a held account.
// /preview-session signs a browser in as the owner (?as=mod: the moderator) and opens /admin.
import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {openCentralDb} from '../central/db.mjs';
import {createCentralService,createDevLoginVerifier} from '../central/service.mjs';
import {createSiteHandler} from '../central/site.mjs';
import {createSigningKey} from '../bridge/admission.mjs';
import {createConsolePhoneProvider} from '../central/phone.mjs';
import {enrolGateway,createRemoteAccount} from '../bridge/remote-account.mjs';

const port=Number(process.argv[2]??4191),origin=`http://127.0.0.1:${port}`;
const svc=createCentralService({db:openCentralDb(),keys:[createSigningKey('preview')],issuer:origin,verifyLogin:createDevLoginVerifier(),allowedOrigins:[origin],publicUrl:origin+'/',secureCookies:false,rateLimit:10000,phone:createConsolePhoneProvider()});
const site=createSiteHandler({providers:[],publicUrl:origin+'/'});
let ownerToken=null,modToken=null;
const http=createServer((req,res)=>{
 // Signs this browser in as the owner (or ?as=mod as the moderator) and opens the admin page.
 if(req.url.startsWith('/preview-session')){const t=req.url.includes('as=mod')?modToken:ownerToken;res.writeHead(302,{'Set-Cookie':`rlb_session=${t}; HttpOnly; Path=/; SameSite=Lax`,Location:'/admin'});res.end();return;}
 if(site(req,res))return;svc.handle(req,res);
});
await new Promise(r=>http.listen(port,'127.0.0.1',r));

const call=async(method,path,{data,who,extra=''}={})=>{const headers={origin};if(data!==undefined)headers['content-type']='application/json';if(who){headers.cookie=who.cookie+(extra?'; '+extra:'');headers['x-csrf-token']=who.csrf;}
 const r=await fetch(origin+path,{method,headers,body:data!==undefined?JSON.stringify(data):undefined});return {data:await r.json().catch(()=>null),cookies:r.headers.getSetCookie()};};
const login=async subject=>{const r=await call('POST','/auth/login',{data:{subject,name:subject}});return {cookie:r.cookies.find(c=>c.startsWith('rlb_session=')).split(';')[0],csrf:r.data.csrf,player:r.data.player,name:subject};};
const owner=await login('Rook'),mod=await login('Wren'),a=await login('SpeedyPete'),b=await login('PetesBrother'),c=await login('Birch'),d=await login('Alder');
ownerToken=owner.cookie.split('=')[1];modToken=mod.cookie.split('=')[1];
const created=(await call('POST','/owner/servers',{who:owner,data:{name:'Hapis Classic',region:'eu',endpoint:'wss://hapis.example/play'}})).data;
const {credential}=await enrolGateway({baseUrl:origin,code:created.enrolmentCode});
const gw=createRemoteAccount({baseUrl:origin,credential}),id=created.id;
await gw.heartbeat({players:4,capacity:50});await call('POST',`/owner/servers/${id}/publish`,{who:owner,data:{listed:true}});
await call('POST',`/admin/servers/${id}/roles`,{who:owner,data:{player:mod.player,role:'moderator'}});
const signals={ua:'Mozilla/5.0 Firefox/140.0',screen:{w:2560,h:1440,dpr:1},tz:'Europe/London',webgl:'NVIDIA GeForce RTX 3060',lang:'en-GB'};
const token=(await call('POST','/account/device',{who:a,data:{signals}})).data.token;
await call('POST','/account/device',{who:b,extra:`rlb_device=${token}`,data:{signals}});
await call('POST','/account/device',{who:d,data:{signals}});
const roster=[a,c,d].map((p,i)=>({subject:p.player,name:p.name,playerId:i+1,score:[160,20,5][i],flags:i===0?{teleport:2,speed:4}:{},connectedAt:Date.now()-[40,12,3][i]*60e3}));
const r1=await gw.report({players:roster,flags:[{subject:a.player,kind:'teleport',severity:40,score:160,at:Date.now(),detail:{distance:84,budget:10}}],events:[{type:'item-transfer',from:d.player,to:a.player,item:'M4',amount:1}]});
// A real capture from browser/admin-capture.mjs when one is there (analysis/ is not in git), else a site picture.
const image=readFileSync(new URL(existsSync(new URL('../analysis/site-captures/game-capture.jpg',import.meta.url))?'../analysis/site-captures/game-capture.jpg':'../site/content/classic-map.jpg',import.meta.url)).toString('base64');
for(const s of r1.screenshots)console.log('auto screenshot',(await gw.screenshot({id:s.id,ok:true,image,meta:{camera:{feet:[100,20,300],yaw:91},luma:{mean:96,sd:41},hidden:false,quality:0.82},gateway:{latencyMs:640,request:{pos:[100.4,20,300],yaw:93},reply:{pos:[101,20,300],yaw:94}}})).data);
const manual=(await call('POST',`/admin/servers/${id}/screenshot`,{who:mod,data:{player:c.player}})).data.screenshot;
await gw.report({players:roster,flags:[]});await gw.screenshot({id:manual,ok:false,reason:'tab-hidden'});
await call('POST',`/admin/servers/${id}/bans`,{who:owner,data:{player:a.player,reason:'Teleporting across the map'}});
console.log('held join:',(await call('POST',`/servers/${id}/join-ticket`,{who:b})).data);
setInterval(()=>gw.report({players:roster.slice(1),flags:[]}).catch(()=>{}),5000);
console.log(`Admin preview on ${origin}/admin (sign in: /preview-session)`);
