// Remote control through the website (SERVER-MANAGEMENT-PLAN.md section 1): the host app reports status and logs to
// central with its host app key and picks up the owner's commands; the owner and site staff read and command it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {central} from './helpers/central-fixture.mjs';

async function setup(){
 const c=await central();
 const login=await c.call('POST','/auth/login',{data:{subject:'owner-1',name:'Owner'}});
 const owner={cookie:login.cookie,csrf:login.data.csrf};
 const id=(await c.call('POST','/owner/servers',{data:{name:'Relay test',region:'eu',endpoint:'wss://play.example.test/play'},...owner})).data.id;
 const key=(await c.call('POST',`/owner/servers/${id}/host-key`,{data:{},...owner})).data.hostKey;
 const report=async(data,k=key)=>{const r=await fetch(c.base+'/host-relay/report',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+k},body:JSON.stringify(data)});return {status:r.status,data:await r.json().catch(()=>null)};};
 const status={components:[{name:'server',state:'running',label:'Game server'},{name:'gateway',state:'running',label:'Gateway'}],players:{inGame:3,sessions:4},watchdog:{verdict:'ok'}};
 return {c,owner,id,key,report,status};
}
const line=(seq,text,source='server')=>({seq,source,stream:'stdout',text,at:1,level:'info'});

test('the host app reports with its key; the owner reads status and new log lines; others cannot', async () => {
 const {c,owner,id,report,status}=await setup();
 try{
  assert.equal((await report({status,logs:[]},'rlbh_'+'x'.repeat(43))).status,401);
  const r=await report({status,control:true,logs:[line(1,'Server started'),line(2,'Saved 12 Object(s).')]});
  assert.equal(r.status,200);assert.deepEqual(r.data.commands,[]);
  const con=await c.call('GET',`/owner/servers/${id}/console`,owner);
  assert.equal(con.status,200);assert.equal(con.data.connected,true);assert.equal(con.data.control,true);
  assert.equal(con.data.status.players.inGame,3);
  assert.deepEqual(con.data.logs.map(l=>l.text),['Server started','Saved 12 Object(s).']);
  const after=con.data.seq;
  await report({status,logs:[line(3,'Player joined')]});
  const next=await c.call('GET',`/owner/servers/${id}/console?since=${after}`,owner);
  assert.deepEqual(next.data.logs.map(l=>l.text),['Player joined']);
  // A stranger and a server moderator see nothing; site staff sees everything.
  const s=await c.call('POST','/auth/login',{data:{subject:'stranger',name:'Stranger'}});
  assert.equal((await c.call('GET',`/owner/servers/${id}/console`,{cookie:s.cookie})).status,404);
  c.db.addStaff(s.data.player??c.db.identity('dev','stranger').uuid,c.clock.t);
  assert.equal((await c.call('GET',`/owner/servers/${id}/console`,{cookie:s.cookie})).status,200);
  // Logs live in memory only: nothing about them reaches the database.
  assert.equal(c.db.raw.prepare("select count(*) n from audit_events where detail like '%Player joined%'").get().n,0);
 }finally{await c.close();}
});

test('a command waits for the next report, runs once, and its result comes back; all of it is audited', async () => {
 const {c,owner,id,report,status}=await setup();
 try{
  await report({status,control:true,logs:[]});
  const bad=await c.call('POST',`/owner/servers/${id}/console-command`,{data:{op:'format-disk',target:'all'},...owner});
  assert.equal(bad.status,400);
  assert.equal((await c.call('POST',`/owner/servers/${id}/console-command`,{data:{op:'restart',target:'nope'},...owner})).status,400);
  const q=await c.call('POST',`/owner/servers/${id}/console-command`,{data:{op:'restart',target:'server'},...owner});
  assert.equal(q.status,202);
  const got=await report({status,logs:[]});
  assert.deepEqual(got.data.commands.map(x=>[x.id,x.op,x.target]),[[q.data.id,'restart','server']]);
  assert.deepEqual((await report({status,logs:[]})).data.commands,[],'handed out once');
  await report({status,logs:[],results:[{id:q.data.id,ok:true}]});
  const con=await c.call('GET',`/owner/servers/${id}/console`,owner);
  assert.equal(con.data.commands.find(x=>x.id===q.data.id).state,'done');
  assert.equal(c.db.raw.prepare("select count(*) n from audit_events where action='host-command' and target=?").get(id).n,1);
  // Backups: keep needs nothing more; restore needs a name.
  assert.equal((await c.call('POST',`/owner/servers/${id}/console-command`,{data:{op:'backup-keep',label:'before wipe'},...owner})).status,202);
  assert.equal((await c.call('POST',`/owner/servers/${id}/console-command`,{data:{op:'backup-restore'},...owner})).status,400);
 }finally{await c.close();}
});

test('commands are refused while the host app is away or has website control switched off, and expire unclaimed', async () => {
 const {c,owner,id,report,status}=await setup();
 try{
  assert.equal((await c.call('POST',`/owner/servers/${id}/console-command`,{data:{op:'start',target:'all'},...owner})).status,409,'never reported');
  await report({status,control:false,logs:[]});
  const off=await c.call('POST',`/owner/servers/${id}/console-command`,{data:{op:'start',target:'all'},...owner});
  assert.equal(off.status,409);assert.equal(off.data.error,'control-off');
  await report({status,control:true,logs:[]});
  const q=await c.call('POST',`/owner/servers/${id}/console-command`,{data:{op:'stop',target:'gateway'},...owner});
  assert.equal(q.status,202);
  c.clock.t+=61e3;
  const con=await c.call('GET',`/owner/servers/${id}/console`,owner);
  assert.equal(con.data.connected,false,'no report for a minute');
  assert.equal(con.data.commands.find(x=>x.id===q.data.id).state,'expired');
  assert.deepEqual((await report({status,logs:[]})).data.commands,[],'an expired command never runs');
 }finally{await c.close();}
});

test('the log buffer keeps the newest 2000 lines and long lines are cut', async () => {
 const {c,owner,id,report,status}=await setup();
 try{
  for(let b=0;b<3;b++)await report({status,logs:Array.from({length:1000},(_,i)=>line(b*1000+i+1,'line '+(b*1000+i+1)))});
  await report({status,logs:[line(3001,'x'.repeat(5000))]});
  const con=await c.call('GET',`/owner/servers/${id}/console?since=0`,owner);
  assert.equal(con.data.logs.length,500,'one page at a time');
  const all=[];let since=0;for(;;){const p=await c.call('GET',`/owner/servers/${id}/console?since=${since}`,owner);if(!p.data.logs.length)break;all.push(...p.data.logs);since=p.data.logs.at(-1).n;}
  assert.equal(all.length,2000);assert.equal(all[0].text,'line 1002');
  assert.equal(all.at(-1).text.length,2000);
  assert.equal((await report({status,logs:Array.from({length:1001},(_,i)=>line(i,'x'))})).status,413);
 }finally{await c.close();}
});
