#!/usr/bin/env node
// Decode and compare Rust Legacy (uLink 1.5.6 / Lidgren) packet captures with our own bridge/ulink codecs
// (SERVER-TESTING-PLAN.md section 7 item 2). Reads pcap/pcapng (Ethernet, Npcap loopback NULL/LOOP, Linux cooked,
// raw IP; IPv4/IPv6; UDP). Never runs or contacts anything except in `record`, which only relays UDP you point it at.
//
//   node tools/compare-captures.mjs decode <capture> [--port 29015|auto] [--peer IP[:PORT]] [--session N]
//        [--json out.json] [--text out.txt] [--all] [--strict] [--schema file] [--registry file] [--no-verify]
//   node tools/compare-captures.mjs compare <ours> <native> [--port N] [--port-a N] [--port-b N] [--peer-a ..] [--peer-b ..]
//        [--session-a N] [--session-b N] [--labels ours,native] [--tolerance 0.25] [--json out.json] [--text out.txt] [--strict]
//   node tools/compare-captures.mjs record --target HOST:PORT [--listen [HOST:]PORT] --out file.pcapng [--label-port 29015] [--link null|ethernet]
//   node tools/compare-captures.mjs selftest [--out DIR]   (records our gateway and a stand-in client against the mock server)
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodeCapture,formatDecode,profileSession,compareProfiles,formatComparison,pickSession,toJsonValue,startRecordingProxy,PcapngWriter,LINKTYPE,readCapture,writePcap,DEFAULT_SERVER_PORT} from '../bridge/ulink/capture.mjs';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const USAGE=`usage:
  compare-captures decode <capture> [--port N|auto] [--peer IP[:PORT]] [--session N] [--json F] [--text F] [--all] [--strict]
  compare-captures compare <ours> <native> [--port N] [--port-a N] [--port-b N] [--peer-a P] [--peer-b P] [--session-a N] [--session-b N] [--json F] [--text F] [--strict]
  compare-captures record --target HOST:PORT [--listen [HOST:]PORT] --out F.pcapng [--label-port N] [--link null|ethernet]
  compare-captures selftest [--out DIR]
common: --schema F (default bridge/ulink/rpc-schema.json), --registry F (default browser/assets/recovered/ngc/registry.json if present), --no-verify`;

function parseArgs(argv){
 const pos=[],opt={};
 for(let i=0;i<argv.length;i++){
  const a=argv[i];
  if(!a.startsWith('--')){pos.push(a);continue;}
  const k=a.slice(2);
  if(['all','strict','no-verify','help'].includes(k))opt[k]=true;else{if(i+1>=argv.length)throw new Error('Missing value for '+a);opt[k]=argv[++i];}
 }
 return {pos,opt};
}
const portOpt=v=>v===undefined?DEFAULT_SERVER_PORT:v==='auto'?'auto':Number(v);
const hostPort=(s,host='127.0.0.1')=>{const m=/^(?:\[?([^\]]*)\]?:)?(\d+)$/.exec(s??'');if(!m)throw new Error('Expected [HOST:]PORT, got '+s);return {host:m[1]||host,port:Number(m[2])};};

async function context(opt){
 const schema=JSON.parse(await readFile(opt.schema??join(ROOT,'bridge/ulink/rpc-schema.json'),'utf8'));
 const regPath=opt.registry??join(ROOT,'browser/assets/recovered/ngc/registry.json');
 const registry=opt.registry||existsSync(regPath)?JSON.parse(await readFile(regPath,'utf8')):undefined;
 if(!registry)console.error('note: no NGC registry (run python -I tools/export_ngc_registry.py, or pass --registry); NGC calls stay undecoded');
 return {schema,registry,verify:!opt['no-verify']};
}
async function output(opt,text,json){
 if(opt.json)await writeFile(opt.json,JSON.stringify(toJsonValue(json),null,1));
 if(opt.text)await writeFile(opt.text,text);else process.stdout.write(text);
}
const bad=r=>r.sessions.some(s=>s.issues.unknown||s.issues.undecoded||s.issues.roundTripMismatch||s.issues.garbage);

async function decode(pos,opt){
 if(pos.length!==1)throw new Error(USAGE);
 const ctx=await context(opt),result=decodeCapture(await readFile(pos[0]),{...ctx,port:portOpt(opt.port),peer:opt.peer});
 const sessions=opt.session?[pickSession(result,opt.session)]:result.sessions;
 await output(opt,formatDecode(result,{all:opt.all,sessions}),{...result,sessions});
 return opt.strict&&bad({sessions})?1:0;
}
async function compare(pos,opt){
 if(pos.length!==2)throw new Error(USAGE);
 const ctx=await context(opt),labels=(opt.labels??'ours,native').split(',');
 const load=async(file,port,peer,session)=>{const r=decodeCapture(await readFile(file),{...ctx,port:portOpt(port??opt.port),peer});const s=pickSession(r,session);if(!s)throw new Error('No Rust Legacy session found in '+file+' (try --port auto or --peer)');return s;};
 const a=await load(pos[0],opt['port-a'],opt['peer-a'],opt['session-a']),b=await load(pos[1],opt['port-b'],opt['peer-b'],opt['session-b']);
 const report=compareProfiles(profileSession(a),profileSession(b),{labels,timingTolerance:opt.tolerance?Number(opt.tolerance):undefined});
 await output(opt,formatComparison(report),report);
 return opt.strict&&(report.onlyA.some(i=>i.dir==='c2s')||report.onlyB.some(i=>i.dir==='c2s')||report.encoding.some(e=>e.dir==='c2s'))?1:0;
}
async function record(pos,opt){
 if(!opt.target||!opt.out)throw new Error(USAGE);
 const target=hostPort(opt.target),listen=hostPort(opt.listen??'0'),writer=new PcapngWriter({linkType:opt.link==='ethernet'?LINKTYPE.ETHERNET:LINKTYPE.NULL});
 const proxy=await startRecordingProxy({target,listen,writer,serverLabel:opt['label-port']?{port:Number(opt['label-port'])}:undefined});
 console.error(`recording: clients -> udp ${listen.host}:${proxy.port} -> ${target.host}:${target.port}; Ctrl+C writes ${opt.out}`);
 const flush=()=>writeFile(opt.out,writer.toBytes());const timer=setInterval(flush,5000);
 await new Promise(r=>process.once('SIGINT',r));clearInterval(timer);await flush();await proxy.close();
 console.error(`wrote ${writer.count} packets (${proxy.counts.c2s} client->server, ${proxy.counts.s2c} server->client)`);
 return 0;
}
// Records our own stack (tests/helpers/capture-session.mjs) and decodes/compares it: a quick end-to-end check of this tool.
async function selftest(pos,opt){
 const {recordGatewaySession,recordNativeStandIn,TEST_REGISTRY}=await import('../tests/helpers/capture-session.mjs');
 const ctx={...await context({...opt,registry:undefined}),registry:TEST_REGISTRY};
 const g=await recordGatewaySession(),n=await recordNativeStandIn({linkType:LINKTYPE.ETHERNET});
 const nPcap=writePcap(readCapture(n.bytes).packets,{linkType:LINKTYPE.ETHERNET});
 if(opt.out){await mkdir(opt.out,{recursive:true});await writeFile(join(opt.out,'gateway-session.pcapng'),g.bytes);await writeFile(join(opt.out,'native-standin.pcap'),nPcap);console.error('wrote',join(opt.out,'gateway-session.pcapng'),join(opt.out,'native-standin.pcap'));}
 const ra=decodeCapture(g.bytes,ctx),rb=decodeCapture(nPcap,ctx);
 process.stdout.write(formatDecode(ra));
 process.stdout.write('\n'+formatComparison(compareProfiles(profileSession(pickSession(ra)),profileSession(pickSession(rb)),{labels:['gateway','stand-in']})));
 return bad(ra)||bad(rb)?1:0;
}

const COMMANDS={decode,compare,record,selftest};
try{
 const [cmd,...rest]=process.argv.slice(2),{pos,opt}=parseArgs(rest);
 if(!COMMANDS[cmd]||opt.help){console.error(USAGE);process.exit(cmd?2:0);}
 process.exitCode=await COMMANDS[cmd](pos,opt);
}catch(e){console.error(e.message);process.exit(2);}
