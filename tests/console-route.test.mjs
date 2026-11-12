import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {CLIENT_COMMANDS,CONSOLE_MAX_LENGTH,consoleRoute,forwardableConsoleText,serverConsoleLines} from '../browser/console-route.mjs';
import {present} from './helpers/assets.mjs';

test('F1 console: client [Client] commands stay local, everything else goes to the server as typed',()=>{
 for(const c of ['render.fov 90','input.mousespeed 3','chat.enabled false','quit','global.echo hi','net.disconnect','CHAT.add "a" "b"','water.reflection true'])assert.equal(consoleRoute(c),'client',c);
 for(const c of ['status','kick "Bob"','env.time 12','airdrop.drop','teleport.toplayer "a" "b"','render.FOV 90','oxide.version','chat.say "hi"','falldamage.enabled false','a.b'])assert.equal(consoleRoute(c),'server',c);
 assert.equal(forwardableConsoleText('status',{trusted:true}),'status');assert.equal(forwardableConsoleText(' env.time 12 ',{trusted:true}),' env.time 12 ','sent as typed');
 assert.equal(forwardableConsoleText('status'),null,'untrusted (script) input is never forwarded');assert.equal(forwardableConsoleText('quit',{trusted:true}),null,'client quit never reaches the server (admin global.quit)');
 assert.equal(forwardableConsoleText('   ',{trusted:true}),'   ','blank lines go to the server as typed');assert.equal(forwardableConsoleText('',{trusted:true}),'');assert.equal(forwardableConsoleText('x'.repeat(CONSOLE_MAX_LENGTH+1),{trusted:true}),null);assert.equal(forwardableConsoleText(42,{trusted:true}),null);
 assert.deepEqual(serverConsoleLines('a\nb'),['a','b',''],'AddText(bFromServer) appends "\\n" twice');
});

const SOURCE=new URL('../analysis/decompiled/client/Assembly-CSharp/',import.meta.url);
test('client command table matches the decompiled ConsoleSystem classes',{skip:!present(SOURCE)&&'decompiled client source not present'},()=>{
 const found={};
 for(const f of readdirSync(SOURCE).filter(f=>f.endsWith('.cs'))){const src=readFileSync(new URL(f,SOURCE),'utf8');if(!src.includes(': ConsoleSystem'))continue;
  for(const m of src.matchAll(/^(\t*)(?:public |internal )?class (\w+) : ConsoleSystem\r?\n\1\{/gm)){const indent=m[1],end=src.indexOf('\n'+indent+'}',m.index+m[0].length),body=src.slice(m.index+m[0].length,end);let attrs=[];
   for(const line of body.split('\n')){const depth=line.length-line.replace(/^\t+/,'').length,s=line.trim();if(depth!==indent.length+1)continue;
    if(s.startsWith('[')){attrs.push(...[...s.matchAll(/\[(\w+)/g)].map(x=>x[1]));continue;}
    const member=/^public static (?:readonly )?[\w<>\[\],. ]+? (\w+)\s*(?:\(ref Arg|\{|=|;|$)/.exec(s);if(member&&attrs.includes('Client'))(found[m[2]]??=[]).push(member[1]);if(s)attrs=[];}}}
 assert.deepEqual(Object.fromEntries(Object.entries(found).sort()),Object.fromEntries(Object.entries(CLIENT_COMMANDS).sort()));
});
