// Port-0 listeners never land on a port fetch refuses (bridge/listen.mjs). This machine hands out ephemeral ports from
// 1024 up, in order and system-wide, so concurrent test files listening while the counter passed 6665-6669 all failed
// together with "fetch failed: bad port".
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readdirSync,readFileSync} from 'node:fs';
import {FETCH_BAD_PORTS,listenServer} from '../bridge/listen.mjs';

const refusal=async port=>{try{await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(200)});return null;}catch(e){return String(e.cause?.message??e.cause??e.name);}};

test('the list matches what this Node fetch refuses', async()=>{
 for(const port of FETCH_BAD_PORTS)assert.equal(await refusal(port),'bad port',String(port));
 for(const port of [1024,1718,6001,6664,6670,6696,10079,10081,49152])assert.notEqual(await refusal(port),'bad port',String(port));
});

test('port 0 is picked again until the port is one fetch can reach; a chosen port is kept', async()=>{
 const fake=ports=>{const s=new EventEmitter(),given=[...ports];let current=null;
  s.listen=(port,host)=>{s.asked=[port,host];current=port||given.shift();queueMicrotask(()=>s.emit('listening'));};
  s.address=()=>({port:current});s.close=cb=>{s.closed=(s.closed??0)+1;queueMicrotask(cb);};return s;};
 const s=await listenServer(fake([6665,6666,6667,6668,6669,6670]));
 assert.equal(s.address().port,6670);assert.equal(s.closed,5);assert.deepEqual(s.asked,[0,'127.0.0.1']);
 const chosen=await listenServer(fake([]),{port:6000,host:'127.0.0.2'});
 assert.equal(chosen.address().port,6000,'an explicit port is the operator\'s choice');assert.equal(chosen.closed,undefined);
 const busy=new EventEmitter();busy.listen=()=>queueMicrotask(()=>busy.emit('error',Object.assign(Error('in use'),{code:'EADDRINUSE'})));
 await assert.rejects(listenServer(busy,{port:1234}),/in use/);
 assert.equal(busy.listenerCount('listening'),0);assert.equal(busy.listenerCount('error'),0);
});

test('tests and tools listen through listenServer, not a raw port-0 listen', ()=>{
 const dirs=[new URL('./',import.meta.url),new URL('./helpers/',import.meta.url),new URL('../tools/',import.meta.url),new URL('../tools/playtest/',import.meta.url)];
 const raw=dirs.flatMap(d=>readdirSync(d).filter(f=>f.endsWith('.mjs')).filter(f=>/\.listen\(0\b/.test(readFileSync(new URL(f,d),'utf8'))).map(f=>new URL(f,d).pathname.split('/').slice(-2).join('/')));
 assert.deepEqual(raw,[],'use listenServer(server) from bridge/listen.mjs');
});
