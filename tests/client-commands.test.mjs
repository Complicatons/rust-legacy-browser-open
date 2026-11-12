import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {CLIENT_HELP,consoleArg,csFloat,csParse,valueReply,changedReply,findReply,FpsLog,usDateTime,brandingText,DEFAULT_CONFIG_LINES,createClientCommands,smoothDelta} from '../browser/client-commands.mjs';
import {CLIENT_COMMANDS,consoleRoute,forwardableConsoleText} from '../browser/console-route.mjs';
import {FavouriteList,OFFLINE_ADDRESS} from '../browser/server-list.mjs';
import {ConVars} from '../browser/convars.mjs';
import {KeyBindings} from '../browser/key-bindings.mjs';
import {armorKeys,censorship} from '../browser/armor.mjs';
import {present} from './helpers/assets.mjs';

const memory=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),map:m};};

test('every new console command is a [Client] command that stays local (never forwarded); interp.* is [Admin] only and is forwarded',()=>{
 for(const c of ['gui.hide','gui.show','gui.hide_branding','gui.show_branding','censor.nudity false','gametip.scale 2','footsteps.quality 0','global.fpslog 1','fpslog 1','echo hi','find render','config.load','config.save','serverfavourite.add "x"','serverfavourite.remove x','serverfavourite.save','serverfavourite.load','net.reconnect','net.connect a:1','net.disconnect']){
  assert.equal(consoleRoute(c),'client',c);assert.equal(forwardableConsoleText(c,{trusted:true}),null,c);}
 for(const c of ['interp.ratio 2','interp.delayms 50'])assert.equal(consoleRoute(c),'server',c);
 // The help table names exactly the routing table's [Client] members.
 const fromHelp={};for(const [cls,member] of CLIENT_HELP)(fromHelp[cls]??=[]).push(member);
 assert.deepEqual(Object.fromEntries(Object.entries(fromHelp).map(([k,v])=>[k,[...v].sort()])),Object.fromEntries(Object.entries(CLIENT_COMMANDS).map(([k,v])=>[k,[...v].sort()])));
});

const SOURCE=new URL('../analysis/decompiled/client/Assembly-CSharp/',import.meta.url);
test('help table matches the decompiled [Client] members and their [Help] attributes',{skip:!present(SOURCE)&&'decompiled client source not present'},()=>{
 const out=[];
 for(const f of readdirSync(SOURCE).filter(f=>f.endsWith('.cs'))){const src=readFileSync(new URL(f,SOURCE),'utf8');if(!src.includes(': ConsoleSystem'))continue;
  for(const m of src.matchAll(/^(\t*)(?:public |internal )?class (\w+) : ConsoleSystem\r?\n\1\{/gm)){const indent=m[1],end=src.indexOf('\n'+indent+'}',m.index+m[0].length),body=src.slice(m.index+m[0].length,end);let attrs=[],help=null;
   for(const line of body.split('\n')){const depth=line.length-line.replace(/^\t+/,'').length,s=line.trim();if(depth!==indent.length+1)continue;
    if(s.startsWith('[')){attrs.push(...[...s.matchAll(/\[(\w+)/g)].map(x=>x[1]));const h=/\[Help\("((?:[^"\\]|\\.)*)", "((?:[^"\\]|\\.)*)"\)\]/.exec(s);if(h)help=[h[1],h[2]];continue;}
    const member=/^public static (?:readonly )?([\w<>\[\],. ]+?) (\w+)\s*(\(ref Arg|\{|=|;|$)/.exec(s);
    if(member&&attrs.includes('Client'))out.push([m[2],member[2],member[3]==='(ref Arg'?'method':member[3]==='{'||member[3]===''?'property':'field',member[1],help?.[0]??null,help?.[1]??null]);
    if(s){attrs=[];help=null;}}}}
 assert.deepEqual(out,CLIENT_HELP.map(r=>[...r]));
});

test('ConsoleSystem replies: field/property values, changes, parse failures, C# number text',()=>{
 assert.equal(csFloat(1),'1');assert.equal(csFloat(1.5),'1.5');assert.equal(csFloat(0.1),'0.1');assert.equal(csFloat(-1),'-1');assert.equal(csFloat(59.94006),'59.94006');assert.equal(csFloat(1e7),'1E+07');assert.equal(csFloat(1e-5),'1E-05');assert.equal(csFloat(123456.7),'123456.7');
 assert.equal(csParse(' 2 ','int'),2);assert.equal(csParse('2.5','int'),null);assert.equal(csParse('TRUE','bool'),true);assert.equal(csParse('1','bool'),null,'bool.Parse refuses 1');assert.equal(csParse('1,000','float'),1000);assert.equal(csParse('x','float'),null);
 assert.equal(valueReply('gametip','scale',1,'float'),'gametip.scale: "1" (Single)');assert.equal(changedReply('censor','nudity',true,false,'bool'),'censor.nudity: changed "True" to "False" (Boolean)');
 const convars=new ConVars(memory());let censored=true;const cc=createClientCommands({convars,censor:{get:()=>censored,set:v=>{censored=v;}}});
 assert.deepEqual(cc.command('gametip.scale'),{ok:true,text:'gametip.scale: "1" (Single)'});assert.equal(cc.command('gametip.scale 2.5').text,'gametip.scale: changed "1" to "2.5" (Single)');assert.equal(cc.command('gametip.scale big').text,'error setting value: gametip.scale');
 // gametip.scale is a plain [Client] field nothing reads (GameTip/GameTooltipManager never use it).
 assert.equal(cc.values['gametip.scale'],2.5);
 assert.equal(cc.command('footsteps.quality').text,'footsteps.quality: "2" (Int32)');assert.equal(cc.command('footsteps.quality 0').text,'footsteps.quality: changed "2" to "0" (Int32)');assert.equal(convars.get('footsteps.quality'),0);
 assert.equal(cc.command('footsteps.quality 1.5').text,'error setting value: footsteps.quality');assert.equal(cc.command('footsteps.quality 7').text,'footsteps.quality: changed "0" to "7" (Int32)','int.Parse, no range check');
 assert.equal(cc.command('censor.nudity false').text,'censor.nudity: changed "True" to "False" (Boolean)');assert.equal(censored,false);
 assert.equal(cc.command('global.fpslog').text,'global.fpslog: "-1" (Single)');assert.equal(cc.command('FPSLOG 2'),null,'function names are case-sensitive');
 // global.echo replies with ArgsStr; empty prints nothing. Unknown functions fall through.
 assert.equal(cc.command('echo  hello   world ').text,'hello   world');assert.equal(cc.command('global.echo').text,'');assert.equal(cc.command('gui.nothing'),null);assert.equal(cc.command('render.fov 90'),null);
 assert.equal(consoleArg('echo "a b" c').argsStr,'"a b" c');
});

test('global.find lists matching [Client] members with BuildMethodString / BuildFieldsString text',()=>{
 const gui=findReply('gui').split('\n');assert.equal(gui[0],'Finding gui:');
 assert.deepEqual(gui.slice(1,5),['gui.hide(  ) : Hides all GUI (useful for taking screenshots)','gui.show(  ) : The opposite of gui.hide','gui.hide_branding(  ) : Hides the alpha/branding on the top right','gui.show_branding(  ) : The opposite of gui.hide_branding']);
 assert.ok(findReply('fpslog').includes('global.fpslog : Prints fps at said interval\n'));assert.ok(findReply('connect').includes('net.connect( string serverurl ) : connect to a server\n'));
 assert.ok(findReply('add').includes('chat.add() : no help\n'),'no [Help]: empty parentheses, "no help"');assert.ok(findReply('nudity').includes('censor.nudity : no help\n'));
 assert.equal(findReply('*').split('\n').length-2,CLIENT_HELP.length);assert.equal(findReply('GUI'),'Finding GUI:\n','case-sensitive');
 const cc=createClientCommands();assert.equal(cc.command('find').text,'command global.find was executed');assert.equal(cc.command('find gui').text,findReply('gui'));
});

test('gui.hide/show and branding toggles; censor.nudity rebinds the uncensored model',()=>{
 const calls=[];const cc=createClientCommands({gui:{setVisible:v=>calls.push(['gui',v]),setBrandingVisible:v=>calls.push(['brand',v])}});
 for(const c of ['gui.hide','gui.show','gui.hide_branding','gui.show_branding'])assert.equal(cc.command(c).text,`command ${c} was executed`);
 assert.deepEqual(calls,[['gui',false],['gui',true],['brand',false],['brand',true]]);
 const players=new URL('../browser/assets/recovered/players/manifest.json',import.meta.url);if(!existsSync(players))return;
 const armor=JSON.parse(readFileSync(players)).armor,censoredLegs=armor.defaults.legs;
 assert.equal(armor.models[censoredLegs].name,'naked_legs_censored.armor');const uncensored=armor.models[censoredLegs].uncensored;assert.equal(armor.models[uncensored].name,'naked_legs.armor');assert.ok(armor.models[uncensored].skin&&armor.models[uncensored].sleepMesh);
 assert.equal(censorship.censored,true,'ArmorModelRenderer.censored starts true');
 assert.equal(armorKeys(armor,[])[1],censoredLegs);assert.equal(armorKeys(armor,[],false)[1],uncensored);
 const seen=[];const off=censorship.onChange(v=>seen.push(v));censorship.set(false);assert.equal(armorKeys(armor,[])[1],uncensored);censorship.set(false);censorship.set(true);off();assert.deepEqual(seen,[false,true]);
 // Worn legs armour has no censored variant: unchanged either way.
 const pantsUID=Object.keys(armor.items).find(k=>armor.items[k].slot==='legs');assert.equal(armorKeys(armor,[0,Number(pantsUID)],false)[1],armorKeys(armor,[0,Number(pantsUID)],true)[1]);
});

test('config.save / config.load: saved values come back; without a saved config the default config runs',()=>{
 const storage=memory(),convars=new ConVars(storage),bindings=new KeyBindings(),log=[];const cc=createClientCommands({convars,bindings,storage,log:t=>log.push(t)});
 convars.set('footsteps.quality','1');bindings.bind('Up','K','None');assert.deepEqual(cc.command('config.save'),{ok:true,text:'Saved config.cfg'});
 convars.set('footsteps.quality','2');bindings.bind('Up','W','None');assert.deepEqual(cc.command('config.load'),{ok:true,text:'Loaded cfg/client.cfg'});
 assert.equal(convars.get('footsteps.quality'),1);assert.equal(bindings.get('Up')[0],'K');assert.deepEqual(log,[]);
 const fresh=memory(),b2=new KeyBindings(),l2=[],ran=[];const c2=createClientCommands({convars:new ConVars(fresh),bindings:b2,storage:fresh,log:t=>l2.push(t),run:line=>{ran.push(line);return line.startsWith('input.bind')?b2.command(line):createClientCommands({log:t=>l2.push(t)}).command(line);}});
 b2.bind('Up','K','None');c2.command('config.load');assert.deepEqual(ran,DEFAULT_CONFIG_LINES);assert.deepEqual(l2,['default config']);assert.equal(b2.get('Up')[0],'W');
});

test('serverfavourite.*: FavouriteList rules (no duplicates, 8+ characters, the port offline island exempt), save and load',()=>{
 const storage=memory(),list=new FavouriteList(storage);const cc=createClientCommands({favourites:list});
 const id='3f2b1c9e-0000-4000-8000-000000000001';cc.command(`serverfavourite.add "${id}"`);cc.command(`serverfavourite.add ${id}`);cc.command('serverfavourite.add short');cc.command('serverfavourite.add '+OFFLINE_ADDRESS);
 assert.deepEqual(list.list,[id,OFFLINE_ADDRESS]);assert.equal(storage.getItem('rlb-server-favourites'),null,'only save writes');
 cc.command('serverfavourite.save');assert.deepEqual(JSON.parse(storage.getItem('rlb-server-favourites')),[id,OFFLINE_ADDRESS]);
 cc.command('serverfavourite.remove '+OFFLINE_ADDRESS);assert.deepEqual(list.list,[id]);cc.command('serverfavourite.load');assert.deepEqual(list.list,[id,OFFLINE_ADDRESS],'load clears then re-adds the saved file');
 storage.setItem('rlb-server-favourites',JSON.stringify(['tiny',id,id,42]));assert.equal(list.load(),1);assert.deepEqual(list.list,[id]);
});

test('net.connect / disconnect / reconnect messages and net.lasturl',()=>{
 let connected=false,connecting=false,last=null;const log=[],joined=[];const net={connected:()=>connected,connecting:()=>connecting,connect:a=>joined.push(a),disconnect:()=>{connected=false;joined.push('bye');},lastUrl:()=>last,setLastUrl:a=>{last=a;}};
 const cc=createClientCommands({net,log:t=>log.push(t)});
 assert.equal(cc.command('net.reconnect').text,'command net.reconnect was executed');assert.deepEqual(log,["You havn't connected to a server yet"]);
 cc.command('net.disconnect');assert.equal(log[1],"You're not connected to a server.");
 cc.command('net.connect');assert.equal(log[2],'Not a valid ip - or port missing');
 cc.command('net.connect offline');assert.deepEqual([log[3],last,joined[0]],['Connecting to offline','offline','offline']);
 connected=true;cc.command('net.reconnect');assert.equal(log[4],'Use net.disconnect before trying to connect to a new server.');
 connecting=true;cc.command('net.connect x');assert.equal(log[5],'Connect already in progress!');connecting=false;
 cc.command('net.disconnect');assert.equal(joined.at(-1),'bye');cc.command('net.reconnect');assert.deepEqual([log.at(-1),joined.at(-1)],['Connecting to offline','offline']);
});

test('global.fpslog (NetPreUpdate): first line at once, then every interval; 0 logs every frame; negative stops',()=>{
 const d=new Date(2015,2,11,23,45,7);assert.equal(usDateTime(d),'3/11/2015 11:45:07 PM');assert.equal(usDateTime(new Date(2015,0,2,0,5,9)),'1/2/2015 12:05:09 AM');
 const f=new FpsLog(),at=(t,fps)=>f.update(2,t,Math.round(t*60),1/fps,d);assert.equal(at(10,50),'3/11/2015 11:45:07 PM: frame #600, fps 50');assert.equal(at(11,50),null);assert.equal(at(12,40),'3/11/2015 11:45:07 PM: frame #720, fps 40');
 assert.equal(f.update(-1,13,1,1/60,d),null);assert.ok(f.update(0,13,1,1/60,d));assert.ok(f.update(0,13.01,2,1/60,d));
 const log=[];const cc=createClientCommands({log:t=>log.push(t)});assert.equal(cc.frame(1,1,1/60),null);cc.command('fpslog 1');cc.frame(5,300,1/60,d);assert.equal(log.length,1);assert.match(log[0],/: frame #300, fps 60$/);
 assert.ok(Math.abs(smoothDelta(0.016,0.032)-0.0192)<1e-9);
});

test('BrandingVersion text: linker timestamp + whole local UTC-offset hours, "d MMM yyyy, h:mmtt"',()=>{
 assert.equal(brandingText(1426117557,0),'11 Mar 2015, 11:45PM');assert.equal(brandingText(1426117557,1),'12 Mar 2015, 12:45AM');assert.equal(brandingText(1426117557,-8),'11 Mar 2015, 3:45PM');
 const fe=new URL('../browser/assets/recovered/frontend/manifest.json',import.meta.url);if(!existsSync(fe))return;
 const overlay=JSON.parse(readFileSync(fe)).screens.Overlay;assert.ok(overlay,'GameUI Root/Overlay exported');assert.deepEqual(overlay.nodes.map(n=>n.name),['Overlay','BrandingPanel','Name-Shadow','Name','Version','Background','Background-Shadow','GameTooltips']);
 assert.ok(overlay.nodes[0].components.GUIHide);const stamp=overlay.nodes[1].components.BrandingVersion[0];assert.equal(stamp.linkerTimestamp,1426117557,'client Assembly-CSharp.dll TimeDateStamp, 2015-03-11 23:45:57 UTC');
});

test('gizmos.carrier ([Client] bool, default true) switches the explosive charge carrier highlight',async()=>{
 const {gizmos}=await import('../browser/placement-preview.mjs'),cc=createClientCommands({gizmos});
 assert.equal(cc.command('gizmos.carrier').text,'gizmos.carrier: "True" (Boolean)');
 assert.equal(cc.command('gizmos.carrier false').text,'gizmos.carrier: changed "True" to "False" (Boolean)');assert.equal(gizmos.carrier,false);
 cc.command('gizmos.carrier true');assert.equal(gizmos.carrier,true);
});
