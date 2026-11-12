// Local preview of the leaderboards with sample data (no game server, nothing leaves this machine):
//   node tools/leaderboard-preview.mjs [port]   → http://127.0.0.1:<port>/leaderboard
// An in-memory central with two listed servers whose "gateways" report a week of play for eight players
// (central/stats.mjs ingestion, so the numbers pass the same rate caps as real reports).
import {createServer} from 'node:http';
import {openCentralDb} from '../central/db.mjs';
import {createCentralService,createDevLoginVerifier} from '../central/service.mjs';
import {createSiteHandler} from '../central/site.mjs';
import {createSigningKey} from '../bridge/admission.mjs';
import {enrolGateway,createRemoteAccount} from '../bridge/remote-account.mjs';

const port=Number(process.argv[2]??4192),origin=`http://127.0.0.1:${port}`;
// The clock runs a week behind and is moved forward report by report, so the history spreads over seven days.
const clock={t:Date.now()-(6*23+1)*3600e3}; // seven daily hours of play, the last one ending now
const svc=createCentralService({db:openCentralDb(),keys:[createSigningKey('preview')],issuer:origin,verifyLogin:createDevLoginVerifier(),allowedOrigins:[origin],publicUrl:origin+'/',secureCookies:false,rateLimit:100000,now:()=>clock.t});
const site=createSiteHandler({providers:[],publicUrl:origin+'/'});
const http=createServer((req,res)=>{if(site(req,res))return;svc.handle(req,res);});
await new Promise(r=>http.listen(port,'127.0.0.1',r));

const call=async(method,path,{data,who}={})=>{const headers={origin};if(data!==undefined)headers['content-type']='application/json';if(who){headers.cookie=who.cookie;headers['x-csrf-token']=who.csrf;}
 const r=await fetch(origin+path,{method,headers,body:data!==undefined?JSON.stringify(data):undefined});return {data:await r.json().catch(()=>null),cookies:r.headers.getSetCookie()};};
const login=async subject=>{const r=await call('POST','/auth/login',{data:{subject,name:subject}});return {cookie:r.cookies.find(c=>c.startsWith('rlb_session=')).split(';')[0],csrf:r.data.csrf,player:r.data.player,name:subject};};
const names=['Rook','Wren','SpeedyPete','Birch','Alder','Hazel','Moss','Flint'],people=[];for(const n of names)people.push(await login(n));
async function server(name,region){
 const made=(await call('POST','/owner/servers',{who:people[0],data:{name,region,endpoint:`wss://${name.toLowerCase().replace(/\W+/g,'-')}.example/play`}})).data;
 const {credential}=await enrolGateway({baseUrl:origin,code:made.enrolmentCode});const remote=createRemoteAccount({baseUrl:origin,credential});
 await remote.heartbeat({players:4,capacity:50});await call('POST',`/owner/servers/${made.id}/publish`,{who:people[0],data:{listed:true}});return remote;
}
const servers=[await server('Legacy EU #1','eu'),await server('Legacy US Vanilla','us')];
// Deterministic sample play: each player has a style (hunter, builder, …) and plays a few hours a day.
let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
const styles=[{'animal:wolf':.04,'animal:bear':.01,'animal:chicken':.05,'gather:raw-chicken-breast':.2,pvp:.003},{'build:structure':.15,'build:deployable':.03,'gather:wood':4,'gather:stones':2},
 {pvp:.01,death:.006,distance:.12},{'gather:wood':9,'gather:metal-ore':1.5,'gather:sulfur-ore':.8},{craft:.12,'gather:animal-fat':.3},{'animal:deer':.03,'animal:rabbit':.03,distance:.1},{'animal:mutant-wolf':.02,death:.004},{distance:.09,'gather:stones':3}];
for(let day=0;day<7;day++){
 for(let tick=0;tick<60;tick++){
  clock.t+=60e3;
  for(const [i,remote] of servers.entries()){
   const on=people.map((p,j)=>({p,j})).filter(({j})=>(j+i)%2===0||rnd()<.3);
   const stats=on.map(({p,j})=>({subject:p.player,counts:Object.fromEntries(Object.entries(styles[j]).map(([k,r])=>[k,k==='distance'?Math.round(r*600*(0.5+rnd())):Math.floor(r*10*(0.5+rnd())+rnd())]).filter(([,n])=>n>0))}));
   await remote.report({players:on.map(({p},k)=>({subject:p.player,name:p.name,playerId:k+1,score:0,flags:{},connectedAt:clock.t})),flags:[],stats});
  }
 }
 if(day<6)clock.t+=22*3600e3;
}
clock.t=Date.now();
console.log(`leaderboard preview: ${origin}/leaderboard`);
