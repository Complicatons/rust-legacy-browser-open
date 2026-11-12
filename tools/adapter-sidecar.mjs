// Starts the browser-admission sidecar beside a Legacy server (pilot; not yet run beside a real server).
// Usage: node tools/adapter-sidecar.mjs <config.json>
// config: {serverId, port (default 28090), dataFile, pluginKeyFile, controlKeyFile, namespace?: {base, size}, steamGroupWhitelisted?}
// Key files hold 64+ hex characters. Keep them readable only by the server and gateway accounts.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {createIdentityAdapter,createIdentityMap} from '../bridge/adapter.mjs';
import {createAdapterSidecar,loadIdentityEntries,saveIdentityEntries} from '../bridge/sidecar.mjs';

const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
const key=path=>{const hex=readFileSync(path,'utf8').trim();if(!/^([0-9a-f]{2}){32,}$/i.test(hex))throw Error('Key file must contain at least 32 bytes of hex: '+path);return Buffer.from(hex,'hex');};
const identities=createIdentityMap({namespace:config.namespace??null,entries:loadIdentityEntries(config.dataFile),onChange:e=>saveIdentityEntries(config.dataFile,e)});
const adapter=createIdentityAdapter({serverId:config.serverId,controlKey:key(config.controlKeyFile),identities,steamGroupWhitelisted:()=>Boolean(config.steamGroupWhitelisted)});
const sidecar=createAdapterSidecar({adapter,pluginKey:key(config.pluginKeyFile)});
const port=config.port??28090;
createServer((req,res)=>sidecar.handle(req,res)).listen(port,'127.0.0.1',()=>console.log(`Browser admission sidecar on 127.0.0.1:${port} for server ${config.serverId}${config.namespace?'':' (linked identities only)'}`));
