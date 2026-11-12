import {parseConsoleArg,quoteSafe,removeInvalidCharacters,argString} from './chat.mjs';
// Client console commands of the original client that the F1 console runs locally (ConsoleSystem.RunCommand_Clientside),
// from the decompiled client: gui.cs, censor.cs, gametip (GameTip.cs), footsteps.cs, global.cs (+ NetPreUpdate fpslog),
// config.cs, serverfavourite.cs (+ FavouriteList), net.cs, BrandingVersion.cs. interp.ratio / interp.delayms are [Admin]
// only (no [Client]), so the client never runs them: they go to the server like any other server command and the client's
// Interpolation stays at its static BindTiming(20 ms, 1.5, sendRate) (airdrops.mjs interpolationDelay).

// [Client] ConsoleSystem members: [class, member, kind, C# type, Help.helpDescription, Help.argsDescription] in source
// order (tests/client-commands.test.mjs re-reads the decompiled source). Used by global.find.
export const CLIENT_HELP=Object.freeze([
 ['censor','nudity','property','bool',null,null],['chat','enabled','field','bool','Enable or disable chat displaying',''],['chat','add','method','void',null,null],
 ['config','save','method','void','Save the current config to config.cfg',''],['config','load','method','void','Load the current config from config.cfg',''],
 ['deathscreen','reason','field','string',null,null],['deathscreen','show','method','void',null,null],
 ['footsteps','quality','field','int','Footstep Quality, 0 = default sound, 1 = dynamic for local, 2 = dynamic for all. 0-2 (default 2)',''],
 ['gametip','scale','field','float',null,null],['gameui','hide','method','void',null,null],['gameui','show','method','void',null,null],
 ...['ssaa','bloom','grain','ssao','tonemap','shafts','damage','all'].map(n=>['gfx',n,'property','bool',null,null]),['gizmos','carrier','field','bool',null,null],
 ['global','logprint','field','bool','When set to True, all console printing will go through Debug.Log',''],['global','fpslog','field','float','Prints fps at said interval','interval (seconds)'],
 ['global','create_error','method','void','Creates an error',''],['global','find','method','void','Search for a command','string Name'],
 ['global','echo','method','void','Prints something to the debug output','string output'],['global','quit','method','void','Quits the game',''],
 ['grass','on','field','bool',null,null],['grass','forceredraw','field','bool',null,null],['grass','displacement','field','bool',null,null],['grass','disp_trail_seconds','field','float',null,null],
 ['grass','shadowcast','property','bool',null,null],['grass','shadowreceive','property','bool',null,null],
 ['gui','hide','method','void','Hides all GUI (useful for taking screenshots)',''],['gui','show','method','void','The opposite of gui.hide',''],
 ['gui','hide_branding','method','void','Hides the alpha/branding on the top right',''],['gui','show_branding','method','void','The opposite of gui.hide_branding',''],
 ['input','mousespeed','field','float','The mouse sensitivity. Default is 5.0',''],['input','flipy','field','bool','Should we flip the mouse pitch movement? Default is false',''],
 ['input','bind','method','void','Internal use only',''],['input','keys','method','void','Internal use only',''],
 ['lockentry','show','method','void',null,null],['lockentry','hide','method','void',null,null],
 ['net','connect','method','void','connect to a server','string serverurl'],['net','disconnect','method','void','disconnect from server',''],['net','reconnect','method','void','reconnect to last server',''],
 ['notice','popup','method','void',null,null],['notice','inventory','method','void',null,null],['notice','test','method','void',null,null],
 ['render','level','property','float','The render quality level. (0-1)',''],['render','distance','property','float','The relative render distance. (0-1)',''],
 ['render','frames','property','int','The limit for how many frames may be rendered per second. (default -1 for no fps limit)',''],
 ['render','fov','property','int','The field of view. (60-120, default 60)',''],['render','vsync','property','bool','Whether VSync should be enabled or disabled',''],
 ['render','update','method','void',"Makes sure settings match their convar values. You shouldn't need to call this manually.",''],
 ['serverfavourite','add','method','void','Adds a server to favourites',''],['serverfavourite','remove','method','void','Removes a server to favourites',''],
 ['serverfavourite','save','method','void','Save fave list',''],['serverfavourite','load','method','void','Load fave list',''],
 ['sound','music','field','float','Global music volume',''],['sound','volume','property','float','Global sound volume',''],
 ['terrain','manual','field','bool',null,null],
 ['terrain','idleinterval','field','float','The interval (seconds) to force tree redrawing when there is no camera movement. Set to zero if you do not want forced tree drawing',''],
 ...['reassign','reassign_nocopy','mat','flush','flushtrees'].map(n=>['terrain',n,'method','void',null,null]),
 ['water','level','field','int',null,null],['water','reflection','field','bool',null,null]]);

// ConsoleSystem.Arg: Class (lower case), Function (case kept), ArgsStr (trimmed text after the first space), Args.
export function consoleArg(text){const arg=parseConsoleArg(text);let s=removeInvalidCharacters(String(text??''));const dot=s.indexOf('.');if(dot<=0||s.slice(0,dot).includes(' '))s='global.'+s;
 const fn=s.slice(s.indexOf('.')+1),sp=fn.indexOf(' ');return {...arg,argsStr:arg.invalid||sp<=0?'':fn.slice(sp).trim()};}

// C# ToString of console values: Boolean True/False; Single "G" (7 significant digits; E notation unless -5 < exponent < 7).
export const TYPE_NAMES=Object.freeze({bool:'Boolean',float:'Single',int:'Int32',string:'String'});
export function csFloat(v){if(Number.isNaN(v))return 'NaN';if(v===Infinity)return 'Infinity';if(v===-Infinity)return '-Infinity';if(v===0)return '0';
 const p=Number(Math.fround(v).toPrecision(7)),e=Math.floor(Math.log10(Math.abs(p)));
 if(e>=7||e<=-5){const [m,x]=p.toExponential(6).split('e');const mant=m.replace(/\.?0+$/,''),n=Number(x);return mant+'E'+(n<0?'-':'+')+String(Math.abs(n)).padStart(2,'0');}
 return String(p);}
export function csString(value,type){if(type==='bool')return value?'True':'False';if(type==='float')return csFloat(value);return String(value);}
// bool.Parse / int.Parse / float.Parse (invariant-style: whitespace, sign, decimal point, exponent, thousands commas).
export function csParse(text,type){const s=String(text??'').trim();
 if(type==='bool'){if(/^true$/i.test(s))return true;if(/^false$/i.test(s))return false;return null;}
 if(type==='int'){if(!/^[-+]?\d+$/.test(s))return null;const n=Number(s);return n>=-2147483648&&n<=2147483647?n:null;}
 if(type==='float'){if(/^(Infinity|-Infinity|NaN)$/.test(s))return Number(s);const t=s.replace(/(\d),(?=\d)/g,'$1');if(!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t))return null;const n=Math.fround(Number(t));return Number.isFinite(n)?n:null;}
 return s;}
// RunCommand replies for a static field/property: "<class>.<fn>: "<value>" (<Type>)", "changed "<old>" to "<new>"", or the
// parse failure text.
export function valueReply(cls,fn,value,type){return `${cls}.${fn}: ${quoteSafe(csString(value,type))} (${TYPE_NAMES[type]})`;}
export function changedReply(cls,fn,before,after,type){return `${cls}.${fn}: changed ${quoteSafe(csString(before,type))} to ${quoteSafe(csString(after,type))} (${TYPE_NAMES[type]})`;}
export const executedReply=(cls,fn)=>`command ${cls}.${fn} was executed`;

// global.find: every [Client] member whose class or member name contains the text ("*" lists all; case-sensitive), as
// "class.method( args ) : help", "class.field : help" (BuildMethodString / BuildFieldsString / BuildPropertyString). Per
// class: methods, then fields, then properties (Type.GetMethods/GetFields/GetProperties); classes in source file order.
export function findReply(text){let out='';const classes=[...new Set(CLIENT_HELP.map(r=>r[0]))];
 for(const cls of classes){const rows=CLIENT_HELP.filter(r=>r[0]===cls),match=r=>text==='*'||cls.includes(text)||r[1].includes(text);
  for(const kind of ['method','field','property'])for(const r of rows.filter(r=>r[2]===kind&&match(r))){
   if(kind==='method'){const args=r[4]===null?'':' '+(r[5]??'').trim()+' ';out+=`${cls}.${r[1]}(${args}) : ${r[4]??'no help'}\n`;}
   else out+=`${cls}.${r[1]} : ${r[4]??'no help'}\n`;}}
 return 'Finding '+text+':\n'+out;}

// NetPreUpdate.LateUpdate: with global.fpslog >= 0, a changed interval restarts the clock one interval back (so the first
// line prints at once), then a line every interval (every frame for 0): DateTime.Now ": frame #" Time.frameCount ", fps "
// 1 / Time.smoothDeltaTime. DateTime.Now is shown in the en-US default format.
export function usDateTime(d){const h=d.getHours()%12||12,p=n=>String(n).padStart(2,'0');return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()} ${h}:${p(d.getMinutes())}:${p(d.getSeconds())} ${d.getHours()<12?'AM':'PM'}`;}
export class FpsLog{
 constructor(){this.interval=-1;this.last=-1;this.lastTime=0;}
 update(fpslog,time,frameCount,smoothDeltaTime,now=new Date()){if(!(fpslog>=0))return null;
  if(this.last!==fpslog){this.last=fpslog;this.lastTime=time-this.last;}
  if(this.last===0||time-this.lastTime>=this.last){this.lastTime=time;return `${usDateTime(now)}: frame #${frameCount}, fps ${csFloat(1/smoothDeltaTime)}`;}return null;}
}

// BrandingVersion.Start: the linker timestamp (UTC seconds) plus TimeZone.CurrentTimeZone.GetUtcOffset(time).Hours (whole
// hours, truncated), formatted "d MMM yyyy\, h:mmtt" (en-US month names, AM/PM).
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function brandingText(seconds,offsetHours=Math.trunc(-new Date(seconds*1000).getTimezoneOffset()/60)){const d=new Date((seconds+offsetHours*3600)*1000),h=d.getUTCHours();
 return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${h%12||12}:${String(d.getUTCMinutes()).padStart(2,'0')}${h<12?'AM':'PM'}`;}

// config.cs defaultConfig (run by config.load when no saved config exists).
export const DEFAULT_CONFIG_LINES=['echo default config','input.bind Left A None','input.bind Right D None','input.bind Up W None','input.bind Down S None','input.bind Jump Space None',
 'input.bind Duck LeftControl None','input.bind Sprint LeftShift None','input.bind Fire Mouse0 None','input.bind AltFire Mouse1 None','input.bind Reload R None','input.bind Use E None',
 'input.bind Inventory Tab None','input.bind Flashlight F None','input.bind Laser G None','input.bind Voice V None','input.bind Chat Return T','render.update'];

// The client-side commands above. Hooks (all optional): convars (ConVars: footsteps.quality lives there, [Saved]),
// bindings + storage (key-bindings.mjs, config.save/load), gui {setVisible(bool), setBrandingVisible(bool)},
// censor {get(), set(bool)}, gizmos (placement-preview.mjs gizmos: gizmos.carrier), favourites (FavouriteList), net {connecting(), connected(), connect(address), disconnect(),
// lastUrl(), setLastUrl(address)}, renderUpdate(), run(line) (ConsoleSystem.Run for config files), log(text) (Debug.Log ->
// the console's "> text" lines). command(line) returns {ok, text} or null when the line is not one of these.
export function createClientCommands(hooks={}){
 const values={'gametip.scale':1,'global.fpslog':-1},fpsLog=new FpsLog(),log=t=>hooks.log?.(t);
 const fields={'gametip.scale':'float','global.fpslog':'float','footsteps.quality':'int','censor.nudity':'bool','gizmos.carrier':'bool'};
 const get=name=>name==='footsteps.quality'?(hooks.convars?.get('footsteps.quality')??2):name==='censor.nudity'?(hooks.censor?.get()??true):name==='gizmos.carrier'?(hooks.gizmos?.carrier??true):values[name];
 const set=(name,v)=>{if(name==='footsteps.quality')hooks.convars?.set('footsteps.quality',String(v));else if(name==='censor.nudity')hooks.censor?.set(v);else if(name==='gizmos.carrier'){if(hooks.gizmos)hooks.gizmos.carrier=v;}else values[name]=v;};
 const field=(arg,name)=>{const type=fields[name],cls=arg.className,fn=arg.fn;if(!arg.args?.length)return valueReply(cls,fn,get(name),type);
  const v=csParse(arg.args[0],type);if(v===null)return 'error setting value: '+cls+'.'+fn;const before=get(name);set(name,v);return changedReply(cls,fn,before,get(name),type);};
 const net=hooks.net;
 function connect(address){if(net?.connecting?.()){log('Connect already in progress!');return;}if(net?.connected?.()){log('Use net.disconnect before trying to connect to a new server.');return;}
  if(!address){log('Not a valid ip - or port missing');return;}log('Connecting to '+address);net?.setLastUrl?.(address);net?.connect?.(address);}
 function command(line){const arg=consoleArg(line);if(arg.invalid)return null;const cls=arg.className,fn=arg.fn,name=cls+'.'+fn,ok=text=>({ok:true,text});
  if(fields[name])return ok(field(arg,name));
  switch(name){
   case 'gui.hide':hooks.gui?.setVisible?.(false);return ok(executedReply(cls,fn));
   case 'gui.show':hooks.gui?.setVisible?.(true);return ok(executedReply(cls,fn));
   case 'gui.hide_branding':hooks.gui?.setBrandingVisible?.(false);return ok(executedReply(cls,fn));
   case 'gui.show_branding':hooks.gui?.setBrandingVisible?.(true);return ok(executedReply(cls,fn));
   // global.echo: ReplyWith(ArgsStr); an empty reply prints nothing.
   case 'global.echo':return ok(arg.argsStr);
   case 'global.find':return ok(arg.args?.length?findReply(arg.args[0]):executedReply(cls,fn));
   case 'config.save':hooks.convars?.save();hooks.bindings?.save(hooks.storage);return ok('Saved config.cfg');
   case 'config.load':{const saved=Boolean(hooks.convars?.load?.())|Boolean(hooks.bindings?.load?.(hooks.storage));
    if(!saved)for(const l of DEFAULT_CONFIG_LINES)run(l);return ok('Loaded cfg/client.cfg');}
   case 'serverfavourite.add':hooks.favourites?.add(argString(arg,0,''));return ok(executedReply(cls,fn));
   case 'serverfavourite.remove':hooks.favourites?.remove(argString(arg,0,''));return ok(executedReply(cls,fn));
   case 'serverfavourite.save':hooks.favourites?.save();return ok(executedReply(cls,fn));
   case 'serverfavourite.load':hooks.favourites?.load();return ok(executedReply(cls,fn));
   case 'net.connect':connect(argString(arg,0,''));return ok(executedReply(cls,fn));
   case 'net.disconnect':if(!net?.connected?.())log("You're not connected to a server.");else net.disconnect?.();return ok(executedReply(cls,fn));
   case 'net.reconnect':{const last=net?.lastUrl?.();if(last)connect(last);else log("You havn't connected to a server yet");return ok(executedReply(cls,fn));}
  }
  return null;}
 // ConsoleSystem.RunFile line -> Run: client-side only, its reply goes to Debug.Log.
 function run(line){const r=hooks.run?hooks.run(line):command(line);if(r?.text)log(r.text);if(line==='render.update')hooks.renderUpdate?.();}
 return {command,values,get,
  // NetPreUpdate.LateUpdate fps log line (or null) for this frame.
  frame(time,frameCount,smoothDeltaTime,now){const lineOut=fpsLog.update(values['global.fpslog'],time,frameCount,smoothDeltaTime,now);if(lineOut)log(lineOut);return lineOut;}};
}

// Unity Time.smoothDeltaTime: a low-pass filtered deltaTime (the engine's filter is native code; an exponential average
// with the same purpose stands in for it).
export function smoothDelta(previous,dt,k=0.2){return previous>0?previous+(dt-previous)*k:dt;}
