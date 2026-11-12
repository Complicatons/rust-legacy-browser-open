// The host app's side of remote control (host/remote.mjs, SERVER-MANAGEMENT-PLAN.md section 1): what it reports to
// central, how it runs the commands it picks up, and that nothing runs when website control is off.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createLogHub} from '../host/log-hub.mjs';
import {createRemote} from '../host/remote.mjs';

function fakeHost(){
 const hub=createLogHub({perSource:100}),acts=[],kept=[],restored=[];
 return {hub,acts,kept,restored,
  components:()=>['server','gateway'],
  status:()=>({components:[{name:'server',state:'running'},{name:'gateway',state:'running'}],players:{inGame:1,sessions:1},seq:hub.seq}),
  act:async(a,t)=>{acts.push([a,t]);return {};},
  backups:{status:()=>({configured:true,serverState:'running',kept:[{file:'C:/RLB/host/backups/a.sav',name:'a.sav',source:'auto',at:2,bytes:10}],owner:[{file:'C:/x/b.sav',name:'b.sav',source:'owner',at:3,bytes:9,label:'pre-wipe'}]}),keepNow:l=>{kept.push(l);return {name:'k1'};},restore:n=>{if(n==='bad')throw Error('Stop the game server first');restored.push(n);return {};}}};
}
function fakeCentral(){
 const calls=[];let queue=[];
 const fetchImpl=async(url,opts)=>{const b=JSON.parse(opts.body);calls.push({url:String(url),auth:opts.headers.authorization,body:b});const commands=queue;queue=[];return {ok:true,status:200,json:async()=>({commands,nextInMs:2000})};};
 return {calls,fetchImpl,send:c=>queue.push(...c)};
}
const settle=()=>new Promise(r=>setTimeout(r,10));

test('reports status and only new log lines, with the host app key, to the website the gateway uses', async () => {
 const host=fakeHost(),c=fakeCentral();
 const r=createRemote({host,key:()=>'rlbh_k',centralUrl:'https://rustlegacy.example/',fetchImpl:c.fetchImpl});
 host.hub.push('server','stdout','first');host.hub.push('gateway','stdout','second');
 await r.tick();
 assert.equal(c.calls[0].url,'https://rustlegacy.example/host-relay/report');assert.equal(c.calls[0].auth,'Bearer rlbh_k');
 assert.deepEqual(c.calls[0].body.logs.map(l=>l.text),['first','second']);
 assert.equal(c.calls[0].body.control,true);assert.equal(c.calls[0].body.status.players.inGame,1);
 assert.deepEqual(c.calls[0].body.backups.copies.map(x=>x.name),['b.sav','a.sav']);
 assert.ok(!JSON.stringify(c.calls[0].body.backups).includes('C:/'),'no local paths leave the machine');
 host.hub.push('server','stdout','third');await r.tick();
 assert.deepEqual(c.calls[1].body.logs.map(l=>l.text),['third']);
 assert.equal(r.state().state,'connected');
});

test('no key yet: nothing is sent; a failed report sends the same lines again', async () => {
 const host=fakeHost();let key=null,fail=true;const bodies=[];
 const fetchImpl=async(u,o)=>{bodies.push(JSON.parse(o.body));if(fail)throw Error('offline');return {ok:true,status:200,json:async()=>({commands:[]})};};
 const r=createRemote({host,key:()=>key,centralUrl:'https://rustlegacy.example/',fetchImpl});
 await r.tick();assert.equal(bodies.length,0);assert.equal(r.state().state,'no-key');
 key='rlbh_k';host.hub.push('server','stdout','a');
 await r.tick();assert.equal(r.state().state,'unreachable');
 fail=false;await r.tick();
 assert.deepEqual(bodies.map(b=>b.logs.map(l=>l.text)),[['a'],['a']]);
});

test('commands run through the host and their results go back on the next report', async () => {
 const host=fakeHost(),c=fakeCentral();
 const r=createRemote({host,key:()=>'rlbh_k',centralUrl:'https://rustlegacy.example/',fetchImpl:c.fetchImpl});
 c.send([{id:'a',op:'restart',target:'server',by:'Owner'},{id:'b',op:'backup-keep',label:'pre-wipe'},{id:'c',op:'backup-restore',name:'bad'},{id:'d',op:'stop',target:'nonsense'},{id:'e',op:'reboot-pc'}]);
 await r.tick();await settle();
 assert.deepEqual(host.acts,[['restart','server']]);assert.deepEqual(host.kept,['pre-wipe']);
 await r.tick();
 const results=Object.fromEntries(c.calls[1].body.results.map(x=>[x.id,x]));
 assert.equal(results.a.ok,true);assert.equal(results.b.ok,true);
 assert.equal(results.c.ok,false);assert.match(results.c.error,/Stop the game server/);
 assert.equal(results.d.ok,false);assert.equal(results.e.ok,false);
 assert.ok(host.hub.since(0).some(l=>/Website \(Owner\): restart server/.test(l.text)),'the host log says who asked');
 await r.tick();assert.deepEqual(c.calls[2].body.results,[],'each result is sent once');
});

test('with website control off the host still reports but refuses every command', async () => {
 const host=fakeHost(),c=fakeCentral();
 const r=createRemote({host,key:()=>'rlbh_k',centralUrl:'https://rustlegacy.example/',fetchImpl:c.fetchImpl,control:false});
 c.send([{id:'a',op:'stop',target:'all'}]);
 await r.tick();await settle();await r.tick();
 assert.equal(c.calls[0].body.control,false);assert.deepEqual(host.acts,[]);
 assert.equal(c.calls[1].body.results[0].ok,false);
});
