// Labelled demo files in the mock server's folder, so Settings, Plugins and the health check have something to show in
// `npm run host:demo` and the dashboard check. The mock game server reads none of them; nothing here is a real plugin.
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {REPO} from './config.mjs';

const demoPlugin=(cls,title,version,what)=>`// DEMO PLUGIN written by host/demo.mjs for the host app demo. It does nothing; the mock game server never loads it.
using Oxide.Core;

namespace Oxide.Plugins
{
    [Info("${title}", "Demo author", "${version}")]
    [Description("${what} (demo)")]
    class ${cls} : RustLegacyPlugin { }
}
`;

export function writeDemoServerFiles(dir,{pluginKeyHex,sidecarPort=28090}={}){
 const cfgDir=join(dir,'cfg'),plugins=join(dir,'oxide','plugins'),config=join(dir,'oxide','config');
 for(const d of [cfgDir,join(plugins,'disabled'),config])mkdirSync(d,{recursive:true});
 // The shipped cfg (deploy/vm-test/server/server.cfg), with a demo admin password and a demo note on top.
 const shipped=readFileSync(join(REPO,'deploy','vm-test','server','server.cfg'),'utf8').replace(/\r\n/g,'\n');
 if(!existsSync(join(cfgDir,'server.cfg')))writeFileSync(join(cfgDir,'server.cfg'),'// Demo copy of the shipped cfg/server.cfg (host app demo); the mock server does not read it\n'
  +shipped.replace('"__RCON_PASSWORD__"',`"demo-${randomBytes(9).toString('base64url')}"`).replace('server.hostname "Server Name"','server.hostname "Host app demo"'));
 writeFileSync(join(plugins,'RustLegacyBrowser.cs'),readFileSync(join(REPO,'adapter','RustLegacyBrowser.cs'),'utf8'));
 writeFileSync(join(plugins,'DemoWelcomeKit.cs'),demoPlugin('DemoWelcomeKit','Demo Welcome Kit','1.2.0','Gives new players a starter kit'));
 writeFileSync(join(plugins,'DemoHomes.cs'),demoPlugin('DemoHomes','Demo Homes','0.9.4','Lets players set a home and go back to it'));
 writeFileSync(join(plugins,'disabled','DemoOldVote.cs'),demoPlugin('DemoOldVote','Demo Day Vote','0.3.0','Vote to skip the night'));
 // The Oxide config our plugin would write at its first start, with the demo's plugin key.
 if(!existsSync(join(config,'RustLegacyBrowser.json')))writeFileSync(join(config,'RustLegacyBrowser.json'),JSON.stringify({SidecarUrl:`http://127.0.0.1:${sidecarPort}/plugin`,PluginKeyHex:pluginKeyHex??'',LauncherOnly:false,Motd:'Welcome to the host app demo. Be nice.'},null,2));
}
