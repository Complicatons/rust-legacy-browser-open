// Server settings editor (host/server-settings.mjs, HOST-AND-LOADER-BUILD.md H4) on fixture cfg files in a temp folder:
// line-by-line rewrite that keeps comments, unknown lines, order, BOM and line endings; validation; the rcon password
// is write-only; atomic write with a backup; the adapter's LauncherOnly and Motd (vanilla cfg and Oxide JSON); the
// message of the day in both adapters' C# source (not compiled here).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseCfg,applyCfg,applyKeyValue,createServerSettings,serverPaths,SETTINGS,normalize} from '../host/server-settings.mjs';

const FIX=new URL('./fixtures/host-settings/',import.meta.url);
const fixture=n=>readFileSync(new URL(n,FIX),'utf8');
function setup({adapter='vanilla',state='stopped'}={}){
 const root=mkdtempSync(join(tmpdir(),'rlb-settings-')),dir=join(root,'Rust Server');
 mkdirSync(join(dir,'cfg'),{recursive:true});writeFileSync(join(dir,'cfg','server.cfg'),fixture('server.cfg'));
 if(adapter==='vanilla'){mkdirSync(join(dir,'rust_server_Data','cfg'),{recursive:true});writeFileSync(join(dir,'rust_server_Data','cfg','rustlegacybrowser.cfg'),fixture('rustlegacybrowser.cfg'));}
 if(adapter==='oxide'){mkdirSync(join(dir,'oxide','config'),{recursive:true});mkdirSync(join(dir,'oxide','plugins'),{recursive:true});writeFileSync(join(dir,'oxide','config','RustLegacyBrowser.json'),fixture('RustLegacyBrowser.json'));}
 const config={dataDir:join(root,'host'),components:{server:{kind:'mock',dir}}};
 let st=state;const logs=[];
 const s=createServerSettings({config,serverState:()=>st,log:t=>logs.push(t),now:()=>Date.parse('2026-10-24T12:00:00Z')});
 return {root,dir,s,logs,setState:v=>{st=v;},cfg:()=>readFileSync(join(dir,'cfg','server.cfg'),'utf8'),done:()=>rmSync(root,{recursive:true,force:true})};
}

test('cfg parser and writer: comments, unknown lines, order, BOM and CRLF stay; duplicates all get the new value; new keys at the end',()=>{
 const text=fixture('server.cfg'),p=parseCfg(text);
 assert.equal(p.bom,true);
 assert.equal(p.lines.filter(l=>l.key).length,9);
 assert.deepEqual(p.lines.find(l=>l.key==='custom.thing'),{raw:'custom.thing 42',key:'custom.thing',value:'42'}); // unquoted values read too
 const out=applyCfg(text,{set:{'server.pvp':'false','server.hostname':'New Name','save.autosavetime':'300'},remove:['custom.thing']});
 const eol=text.includes('\r\n')?'\r\n':'\n';
 assert.ok(out.startsWith('\ufeff// Owner notes'),'BOM and the first comment kept');
 const lines=out.slice(1).split(eol);
 assert.deepEqual(lines.filter(l=>/^server\.pvp/.test(l)),['server.pvp "false"','server.pvp "false"']);
 assert.ok(lines.includes('something we do not understand')&&lines.includes(''),'unknown and blank lines kept');
 assert.ok(!lines.some(l=>l.startsWith('custom.thing')));
 assert.equal(lines.at(-2),'save.autosavetime "300"');assert.equal(lines.at(-1),'','trailing newline kept');
 assert.equal(lines.indexOf('server.hostname "New Name"'),2,'order kept');
 // Untouched text round-trips byte for byte, and keys match without case.
 assert.equal(applyCfg(text,{}),text);
 assert.match(applyCfg(text,{set:{'player.backpacklocktime':'5'}}),/player\.backpackLockTime "5"/);
 assert.equal(applyCfg('',{set:{'server.pvp':'true'}}),'server.pvp "true"\n');
});

test('validation: types, ranges, quotes and line breaks refused; every curated key is a plain section.name',()=>{
 const def=k=>SETTINGS.find(s=>s.key===k);
 assert.equal(normalize(def('server.pvp'),false),'false');assert.equal(normalize(def('airdrop.min_players'),'25'),'25');
 assert.throws(()=>normalize(def('airdrop.min_players'),'2.5'),/whole number/);
 assert.throws(()=>normalize(def('airdrop.min_players'),9999),/between 0 and 500/);
 assert.throws(()=>normalize(def('server.pvp'),'yes'),/on or off/);
 assert.throws(()=>normalize(def('server.hostname'),'Bad "name"'),/quotes/);
 assert.throws(()=>normalize(def('server.hostname'),'two\nlines'),/line breaks/);
 assert.throws(()=>normalize(def('server.hostname'),'x'.repeat(65)),/longer than 64/);
 for(const s of SETTINGS){assert.match(s.key,/^[a-z]+\.[A-Za-z_]+$/);assert.ok(s.help&&s.evidence,s.key);}
});

test('settings: read hides the rcon password, save writes atomically with a backup and says a restart is needed',()=>{
 const t=setup({state:'running'});
 try{
  const r=t.s.read();
  assert.equal(r.exists,true);assert.equal(r.restartNeeded,true);
  assert.equal(JSON.stringify(r).includes('fixture-secret-123'),false,'the password never leaves the host');
  assert.deepEqual(r.secrets,{'rcon.password':{set:true}});
  assert.equal(r.values.find(v=>v.key==='server.hostname').value,'Fixture Island');
  assert.equal(r.values.find(v=>v.key==='save.autosavetime').value,null);
  assert.deepEqual(r.other,[{key:'custom.thing',value:'42'}]);
  assert.deepEqual(r.duplicates,['server.pvp']);
  assert.equal(r.kept,3); // the comment, the unknown line, the blank line
  assert.equal(r.adapter.kind,'vanilla');assert.equal(r.adapter.values.LauncherOnly,'false');assert.equal(r.adapter.pluginKey.set,true);
  assert.equal(JSON.stringify(r.adapter).includes('abab'),false,'the plugin key never leaves the host');

  const w=t.s.save({version:r.version,values:{'server.hostname':'Zoë\'s Island','server.pvp':false},other:{'custom.thing':'43'},rconPassword:'correct-horse-battery'});
  assert.equal(w.restartNeeded,true);assert.equal(w.written.length,1);
  const after=t.cfg();
  assert.match(after,/server\.hostname "Zoë's Island"/);assert.match(after,/rcon\.password "correct-horse-battery"/);assert.match(after,/custom\.thing "43"/);
  assert.match(after,/^\ufeff\/\/ Owner notes/);
  const backups=readdirSync(join(t.root,'host','settings-backups'));
  assert.deepEqual(backups,['server.cfg.20261024-120000-000']);
  assert.equal(readFileSync(join(t.root,'host','settings-backups',backups[0]),'utf8'),fixture('server.cfg'));
  assert.ok(!existsSync(join(t.dir,'cfg','server.cfg.rlb-tmp')),'no temp file left');
  assert.match(t.logs.join('\n'),/rcon\.password \(new value hidden\)/);assert.ok(!t.logs.join('\n').includes('correct-horse'));
  // A stale page (the file changed since it was read) is refused; nothing is written when any value is bad.
  assert.throws(()=>t.s.save({version:r.version,values:{'server.pvp':true}}),e=>e.status===409);
  const before=t.cfg();
  assert.throws(()=>t.s.save({values:{'server.pvp':true,'airdrop.min_players':-1}}),e=>e.status===400&&/between/.test(e.message));
  assert.equal(t.cfg(),before);
  t.setState('stopped');assert.equal(t.s.save({values:{'server.pvp':true}}).restartNeeded,false);
 }finally{t.done();}
});

test('settings: other values need a section.name key and are never secrets or commands; the password has rules',()=>{
 const t=setup();
 try{
  const bad=[[{other:{'quit':'1'}},/not a setting name/],[{other:{'global.quit':'1'}},/command/],[{other:{'rcon.login':'x'}},/command/],[{other:{'airdrop.drop':'1'}},/command/],
   [{other:{'steam.apikey':'x'}},/secret/],[{other:{'server.pvp':'true'}},/own field/],[{other:{'../x.y':'1'}},/not a setting name/],[{other:{'a.b':'say "hi"'}},/quotes/],
   [{remove:['rcon.password']},/cannot be removed/],[{remove:['server.hostname']},/cannot be removed/],[{values:{'made.up':'1'}},/not one of the listed/],
   [{rconPassword:'short'},/12 to 64/],[{rconPassword:'has space in it'},/12 to 64/],[{rconPassword:'semi;colon;pass'},/semicolons/]];
  for(const [body,re] of bad)assert.throws(()=>t.s.save(body),e=>e.status===400&&re.test(e.message),JSON.stringify(body));
  assert.equal(t.cfg(),fixture('server.cfg'),'nothing written');
  t.s.save({remove:['custom.thing'],other:{'server.maxsleep':'7'}});
  assert.doesNotMatch(t.cfg(),/custom\.thing/);assert.match(t.cfg(),/server\.maxsleep "7"/);
  t.s.save({reset:['sleeper.on']});assert.doesNotMatch(t.cfg(),/sleeper\.on/); // back to the server's default
  assert.throws(()=>t.s.save({reset:['custom.other']}),/not one of the listed/);
 }finally{t.done();}
});

test('adapter settings: LauncherOnly and Motd in the vanilla cfg and the Oxide JSON; never creates a config without the key',()=>{
 const v=setup({adapter:'vanilla'});
 try{
  const r=v.s.read();
  v.s.save({adapter:{version:r.adapter.version,LauncherOnly:true,Motd:'Welcome! Rules: no griefing.'}});
  const text=readFileSync(join(v.dir,'rust_server_Data','cfg','rustlegacybrowser.cfg'),'utf8');
  assert.match(text,/^# Rust Legacy browser adapter \(fixture\)$/m);assert.match(text,/^PluginKeyHex=(ab){32}$/m);
  assert.match(text,/^LauncherOnly=true$/m);assert.match(text,/^Motd=Welcome! Rules: no griefing\.$/m);
  assert.equal(v.s.read().adapter.values.Motd,'Welcome! Rules: no griefing.');
  assert.throws(()=>v.s.save({adapter:{Motd:'two\nlines'}}),/line breaks/);
 }finally{v.done();}
 const o=setup({adapter:'oxide'});
 try{
  assert.equal(o.s.read().adapter.kind,'oxide');
  o.s.save({adapter:{LauncherOnly:'true',Motd:'Hi'}});
  const j=JSON.parse(readFileSync(join(o.dir,'oxide','config','RustLegacyBrowser.json'),'utf8'));
  assert.deepEqual(j,{SidecarUrl:'http://127.0.0.1:28090/plugin',PluginKeyHex:'cd'.repeat(32),LauncherOnly:true,Motd:'Hi'});
 }finally{o.done();}
 const n=setup({adapter:'none'});
 try{
  assert.equal(n.s.read().adapter.kind,null);
  assert.throws(()=>n.s.save({adapter:{LauncherOnly:true}}),e=>e.status===409);
  mkdirSync(join(n.dir,'oxide','plugins'),{recursive:true});writeFileSync(join(n.dir,'oxide','plugins','RustLegacyBrowser.cs'),'// plugin');
  assert.throws(()=>n.s.save({adapter:{LauncherOnly:true}}),/Start the server once/);
 }finally{n.done();}
});

test('paths: -cfg and -datadir come from the verified start arguments; maxplayers is read from them',()=>{
 const fwd=p=>p.replace(/\\/g,'/').replace(/^[A-Za-z]:/,''); // Windows resolves /srv/rust onto the current drive
 const p=serverPaths({components:{server:{kind:'original',dir:'/srv/rust'}}},{settings:{server:{args:['-batchmode','-cfg','cfg/server.cfg','-maxplayers','100','-port','29015','-datadir','rust_server_Data/']}}});
 assert.equal(fwd(p.cfgFile),'/srv/rust/cfg/server.cfg');
 assert.equal(fwd(p.vanillaCfg),'/srv/rust/rust_server_Data/cfg/rustlegacybrowser.cfg');
 assert.equal(fwd(p.pluginsDir),'/srv/rust/oxide/plugins');assert.equal(p.maxPlayers,100);
 const o=serverPaths({components:{server:{kind:'mock',dir:'/srv/rust',oxideDir:'serverdata/oxide',cfgFile:'my.cfg'}}});
 assert.equal(fwd(o.pluginsDir),'/srv/rust/serverdata/oxide/plugins');assert.equal(fwd(o.cfgFile),'/srv/rust/my.cfg');
 assert.equal(serverPaths({components:{}}),null);
});

test('key=value writer keeps comments and appends new keys',()=>{
 assert.equal(applyKeyValue('# c\nA=1\n',{A:'2',B:'x=y'}),'# c\nA=2\nB=x=y\n');
});

test('message of the day: both adapters read Motd (off when empty) and send it to every player after the join',()=>{
 const oxide=readFileSync(new URL('../adapter/RustLegacyBrowser.cs',import.meta.url),'utf8');
 const vanilla=readFileSync(new URL('../adapter/vanilla/RustLegacyBrowserVanilla.cs',import.meta.url),'utf8');
 assert.match(oxide,/Config\["Motd"\] = "";/);
 assert.match(oxide,/motd = Config\["Motd"\] != null \?/,'older Oxide configs without the key stay quiet');
 assert.match(vanilla,/motd = Get\(config, "Motd", ""\);/);
 assert.match(vanilla,/LauncherOnly=false\\nMotd=\\n/,'the vanilla default file has it, empty');
 // Sent before the browser-connection early return, so browser players get it too.
 for(const [name,src,send] of [['oxide',oxide,'rust.SendChatMessage(netUser, "Server", motd)'],['vanilla',vanilla,'Say(netUser, "Server", motd)']]){
  const body=src.slice(src.indexOf('OnPlayerConnected('));
  assert.ok(body.indexOf(send)>0&&body.indexOf(send)<body.indexOf('browserConnections.Contains(connection)) return;'),name);
 }
});
