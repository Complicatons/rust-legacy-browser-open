// tools/host-control.mjs (04-Install-KitViaHost.ps1's way into the service): signs in with the owner token, passes the
// service's CSRF checks, and waits for each action's end state against the real service handler and a fake host.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServiceHandler} from '../host/service.mjs';
import {listenServer} from '../bridge/listen.mjs';
import {connectHost,hostEndpoint} from '../tools/host-control.mjs';

function fakeHost(){
 const parts={central:{name:'central',state:'running',pid:10},gateway:{name:'gateway',state:'running',pid:11},server:{name:'server',state:'running',pid:12,external:{verified:false}}};
 const acts=[];
 return {acts,parts,hub:{subscribe:()=>()=>{},since:()=>[],push(){}},on(){},off(){},components:()=>Object.keys(parts),
  status:()=>({components:Object.values(parts).map(p=>({...p}))}),
  async act(action,target){
   acts.push(`${action} ${target}`);const p=parts[target];
   p.state=action==='stop'?'stopping':'starting';
   setTimeout(()=>{if(target==='gateway'&&action==='start'){p.state='failed';p.message='port 28443 in use';return;}p.state=action==='stop'?'stopped':'running';p.pid=action==='stop'?null:p.pid+100;},30);
  }};
}

test('host-control: sign in, restart and stop wait for the end state; a failed part fails at once',async()=>{
 const host=fakeHost(),token='t'.repeat(43),server=await listenServer(createServer());
 const port=server.address().port;server.on('request',createServiceHandler({host,token,port}));
 const data=mkdtempSync(join(tmpdir(),'rlb-hc-'));
 try{
  writeFileSync(join(data,'owner.token'),token+'\n');writeFileSync(join(data,'host.json'),JSON.stringify({listen:{port}}));
  const ep=hostEndpoint(data);assert.equal(ep.base,`http://127.0.0.1:${port}`);
  await assert.rejects(connectHost({...ep,token:'x'.repeat(43)}),/sign-in refused \(401\)/);
  const h=await connectHost(ep);
  const c=await h.act('restart','central',{pollMs:20});assert.equal(c.state,'running');assert.equal(c.pid,110);
  const s=await h.act('stop','server',{pollMs:20});assert.equal(s.state,'stopped');
  host.parts.gateway.state='stopped';
  await assert.rejects(h.act('start','gateway',{pollMs:20}),/gateway failed: port 28443 in use/);
  await assert.rejects(h.act('start','nope',{pollMs:20}),/no part named nope/);
  assert.deepEqual(host.acts,['restart central','stop server','start gateway']);
 }finally{server.close();rmSync(data,{recursive:true,force:true});}
});

test('host-control: no owner token means no host here',()=>{
 const data=mkdtempSync(join(tmpdir(),'rlb-hc-'));
 try{assert.throws(()=>hostEndpoint(data),/no owner token/);}finally{rmSync(data,{recursive:true,force:true});}
});
