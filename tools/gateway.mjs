// Gateway command line (pilot; see bridge/gateway-launcher.mjs).
//   node tools/gateway.mjs enrol <config.json> <owner-enrolment-code>   → stores this instance's credential in config.credentialFile
//   node tools/gateway.mjs check <config.json>                         → validates configuration
//   node tools/gateway.mjs run <config.json>                           → serves the browser endpoint
// config.json: {serverId, centralUrl, credentialFile, controlKeyFile, [metricsTokenFile], sidecarUrl, native:{host,port}, allowedOrigins:[...],
//   listen:{host,port}, path, tls?:{cert,key}|{pfx,passphraseFile}, mode?:'vm-test' with testHostOnlyBind:{subnet} (isolated test VM only), capacity, wipe, ngcRegistry?: path to registry.json, reportMs?,
//   recoveredDir?: browser/assets/recovered (anti-cheat limits from player.json + items/manifest.json, line of sight from the
//   recovered collision), anticheat?:{policy:{autoKick,kickScore}, lineOfSight?:false (skip the ~0.5 GB collision world), trees?:false}}
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {enrolGateway} from '../bridge/remote-account.mjs';
import {startGateway,validateConfig,hostOnlyBindProblems} from '../bridge/gateway-launcher.mjs';
import {guardProcess} from '../bridge/gateway-service.mjs';
import {limitsFromPlayerConfig,weaponsFromItems} from '../bridge/anticheat.mjs';
import {loadLineOfSight} from '../bridge/line-of-sight.mjs';
import {SCENE_DOOR_VIEWS} from '../bridge/scene-door-views.mjs';

const [cmd,file,code]=process.argv.slice(2);
if(!cmd||!file){console.error('usage: node tools/gateway.mjs enrol|check|run <config.json> [code]');process.exit(2);}
const config=JSON.parse(readFileSync(file,'utf8'));
const load=()=>({...config,credential:existsSync(config.credentialFile)?readFileSync(config.credentialFile,'utf8').trim():undefined,controlKeyHex:readFileSync(config.controlKeyFile,'utf8').trim(),...(config.metricsTokenFile?{metricsToken:readFileSync(config.metricsTokenFile,'utf8').trim()}:{})});

if(cmd==='enrol'){
 const {serverId,credential}=await enrolGateway({baseUrl:config.centralUrl,code});
 if(serverId!==config.serverId)throw Error(`Code belongs to server ${serverId}, config says ${config.serverId}`);
 writeFileSync(config.credentialFile,credential+'\n',{mode:0o600});
 console.log('Enrolled; credential stored in',config.credentialFile);
}else if(cmd==='check'){
 const c=load(),errors=validateConfig(c);if(!errors.length)errors.push(...hostOnlyBindProblems(c));console.log(errors.length?'Problems:\n - '+errors.join('\n - '):'Configuration OK');process.exit(errors.length?1:0);
}else if(cmd==='run'){
 // A stray error is logged, never the end of every player's session (bridge/gateway-service.mjs guardProcess).
 guardProcess({log:(...a)=>console.error(new Date().toISOString(),...a)});
 const schema=JSON.parse(readFileSync(new URL('../bridge/ulink/rpc-schema.json',import.meta.url)));
 const ngcRegistry=config.ngcRegistry?JSON.parse(readFileSync(config.ngcRegistry,'utf8')):{prefabs:[]};
 // Anti-cheat limits from the recovered static data when available; otherwise the built-in recovered defaults.
 const recovered=config.recoveredDir,readRecovered=f=>JSON.parse(readFileSync(join(recovered,f),'utf8'));
 const anticheat=recovered?{limits:limitsFromPlayerConfig(readRecovered('player.json')),weapons:weaponsFromItems(readRecovered('items/manifest.json'))}:{};
 // Line of sight: one shared copy of the recovered collision world for every session (bridge/line-of-sight.mjs).
 if(recovered&&config.anticheat?.lineOfSight!==false)anticheat.lineOfSight=await loadLineOfSight(recovered,{trees:config.anticheat?.trees!==false});
 // Scene doors: never Created, but Context:A names them by their manual view ID (scene export doors[i].viewID).
 const sceneDoors=recovered?(readRecovered('scene/manifest.json').doors??[]).map(d=>d.viewID).filter(Number.isInteger):SCENE_DOOR_VIEWS;
 // Missing data that silently breaks play (EU 1, 29-30 Oct): say so on every start.
 if(!config.ngcRegistry)console.warn(new Date().toISOString(),'WARNING: no ngcRegistry: player-built structures and deployables (doors, boxes, walls) are unnamed, so browser players cannot see them and walk into invisible walls');
 if(!recovered)console.warn(new Date().toISOString(),'WARNING: no recoveredDir: anti-cheat weapon limits and line of sight are off (scene doors use the built-in list)');
 const g=await startGateway(load(),{schema,ngcRegistry,sceneDoors,anticheat,log:(...a)=>console.log(new Date().toISOString(),...a)});
 console.log(`Gateway listening on ${config.listen?.host??'127.0.0.1'}:${g.port}${config.path??'/play'} → native ${config.native.host}:${config.native.port}`);
 for(const s of ['SIGINT','SIGTERM'])process.on(s,async()=>{await g.close();process.exit(0);});
}else{console.error('unknown command',cmd);process.exit(2);}
