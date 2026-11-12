import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,readFileSync} from 'node:fs';
import {removeInvalidCharacters,quoteSafe,splitQuotesStrings,parseConsoleArg,argString,chatInputText,chatSayCommand,serverChatSay,serverSay,chatAddLine,createLocalChatServer,
 tokenizeMarkup,markupRuns,markupColor,stackLines,hudLayout,chatPrefab,CHAT_SERVER_MAX,MAX_DOM_LINES} from '../browser/chat.mjs';
import {present} from './helpers/assets.mjs';

// Client SendChat -> server chat.say -> broadcast -> client chat.add, as the original assemblies do it.
const roundTrip=(text,name='Pilot')=>{const say=chatSayCommand(text);if(!say)return null;const {broadcast}=serverChatSay(say,{name,time:10});return broadcast?chatAddLine(broadcast):null;};

test('String.QuoteSafe escapes quotes then trims trailing backslashes; SplitQuotesStrings undoes it',()=>{
 assert.equal(quoteSafe('hello "world"'),'"hello \\"world\\""');assert.equal(quoteSafe('abc\\\\'),'"abc"');assert.equal(quoteSafe('a\\"'),'"a\\\\""');assert.equal(quoteSafe(''),'""');
 assert.deepEqual(splitQuotesStrings('"Name" "hello \\"world\\""'),['Name','hello "world"']);
 assert.deepEqual(splitQuotesStrings("'single quoted' x"),["'single quoted'",'x'],'single-quoted groups keep their quotes (only spaces and " are trimmed)');
 assert.deepEqual(splitQuotesStrings('"" b'),['','b']);assert.deepEqual(splitQuotesStrings('"  padded  "'),['padded']);assert.deepEqual(splitQuotesStrings('a &qute; b'),['a','"','b']);
});

test('ConsoleSystem.Arg strips invalid characters, lower-cases only the class and splits quoted arguments',()=>{
 assert.equal(removeInvalidCharacters('a\tb\nc\u0000d'),'abcd');assert.equal(removeInvalidCharacters('héllo 中文 €5 ½'),'héllo 中文 €5 ','No (½) is not a decimal digit');
 assert.equal(removeInvalidCharacters('hi 😀!'),'hi !','surrogate halves are dropped');assert.equal(removeInvalidCharacters('é'),'e','combining marks are dropped');
 const a=parseConsoleArg('CHAT.add "a b" "c"');assert.equal(a.invalid,false);assert.equal(a.className,'chat');assert.equal(a.fn,'add');assert.deepEqual(a.args,['a b','c']);
 assert.equal(parseConsoleArg('say hi').className,'global');assert.equal(parseConsoleArg('say hi').fn,'say');assert.equal(parseConsoleArg('chat.x').invalid,true,'one-letter function');assert.equal(parseConsoleArg('c.add').invalid,true,'one-letter class');
 assert.equal(parseConsoleArg('chat.Add "a" "b"').fn,'Add');assert.equal(argString(parseConsoleArg('chat.add'),0,'def'),'def');assert.equal(argString(parseConsoleArg('chat.add ""'),0,'def'),'def');
});

test('chat.say round trip keeps the message and reproduces the original quirks',()=>{
 for(const text of ['hello','say "hi" now','it\'s fine','a\\b','"','\\"quoted\\"','[color red]x[/color]','中文 é €'])assert.deepEqual(roundTrip(text),{name:'Pilot',text},text);
 assert.deepEqual(roundTrip('ends with backslash\\\\'),{name:'Pilot',text:'ends with backslash'});
 assert.deepEqual(roundTrip('  padded  '),{name:'Pilot',text:'padded'});
 assert.deepEqual(roundTrip('   '),{name:'Pilot',text:'text'},'a blank line parses to "" and GetString(0, "text") falls back to its default');
 assert.deepEqual(roundTrip('smile 😀'),{name:'Pilot',text:'smile'});
 assert.equal(chatSayCommand(''),null);assert.equal(chatSayCommand('a\nb\tc'),'chat.say "abc"');assert.equal(chatInputText('x'.repeat(200)).length,CHAT_SERVER_MAX);
 assert.deepEqual(roundTrip('hi',' "Quote" Name\\'),{name:'"Quote" Name',text:'hi'},'display names are QuoteSafe-d by the server');
});

test('server chat.say: one line per second, 128 characters, bare chat.say says "text", global.say is SERVER CONSOLE',()=>{
 const first=serverChatSay('chat.say "one"',{name:'P',time:5});assert.equal(first.broadcast,'chat.add "P" "one"');assert.equal(first.lastChat,5);
 assert.equal(serverChatSay('chat.say "two"',{name:'P',time:6,lastChat:5}).broadcast,null,'exactly 1 s is not > 1 s');
 assert.equal(serverChatSay('chat.say "two"',{name:'P',time:6.01,lastChat:5}).broadcast,'chat.add "P" "two"');
 assert.equal(serverChatSay('chat.say "x"',{name:'P',time:9,enabled:false}).broadcast,null);
 assert.equal(serverChatSay('chat.say',{name:'P',time:9}).broadcast,'chat.add "P" "text"');
 assert.equal(serverChatSay(`chat.say "${'y'.repeat(300)}"`,{name:'P',time:9}).broadcast,`chat.add "P" "${'y'.repeat(128)}"`);
 assert.equal(serverChatSay('chat.add "P" "x"',{name:'P',time:9}).broadcast,null);assert.equal(serverChatSay('global.quit',{name:'P',time:9}).broadcast,null);
 assert.deepEqual(chatAddLine(serverSay('Restart in 5 minutes')),{name:'SERVER CONSOLE',text:'Restart in 5 minutes'});
 let t=0;const local=createLocalChatServer({name:()=>'Me',time:()=>t});assert.equal(local('chat.say "a"'),'chat.add "Me" "a"');t=0.5;assert.equal(local('chat.say "b"'),null);t=1.6;assert.equal(local('chat.say "c"'),'chat.add "Me" "c"');
});

test('client chat.add only accepts chat lines and never treats other console text as one',()=>{
 assert.deepEqual(chatAddLine('chat.add "Bob" "hi there"'),{name:'Bob',text:'hi there'});assert.deepEqual(chatAddLine('chat.add Bob hi'),{name:'Bob',text:'hi'});
 assert.deepEqual(chatAddLine('chat.add "" "x"'),{ignored:true});assert.deepEqual(chatAddLine('chat.add "Bob"'),{ignored:true});assert.deepEqual(chatAddLine('chat.add "Bob" "x"',{enabled:false}),{ignored:true});
 assert.deepEqual(chatAddLine('chat.add "a" "b"; quit'),{name:'a',text:'b'},'extra words are just extra arguments, never another command');
 for(const other of ['chat.say "x"','chat.Add "a" "b"','notice.popup 5 key "x"','lockentry.show true','global.quit',null,42])assert.equal(chatAddLine(other),null,String(other));
});

test('dfMarkupTokenizer: color/sprite tags, the 4-letter tag test and colour stack',()=>{
 const runs=markupRuns('[color #ff0000]red[/color] white');assert.deepEqual(runs.map(r=>[r.kind,r.text,r.color&&[r.color.r,r.color.g,r.color.b]]),[['text','red',[255,0,0]],['whitespace',' ',[255,255,255]],['text','white',[255,255,255]]]);
 assert.deepEqual(markupRuns('[c]x').map(r=>r.text),['x'],'"[c" passes isValidTag (loop ends at "]") and is swallowed');
 assert.deepEqual(markupRuns('[colorful]x').map(r=>r.text),['x'],'only "colo" is compared');
 assert.deepEqual(markupRuns('[a] b').map(r=>r.text),['[a]',' ','b']);assert.deepEqual(markupRuns('a[b').map(r=>r.text),['a'],'a final "[x" is too short to be compared, so it is a tag');assert.deepEqual(markupRuns('a[bc d').map(r=>r.text),['a[bc',' ','d']);
 assert.deepEqual(markupRuns('[color red]a[/color][/color]b').map(r=>[r.text,r.color.r,r.color.g]),[['a',255,0],['b',255,255]],'the base white is never popped');
 assert.deepEqual(markupRuns('[color "blue"]q').map(r=>[r.color.r,r.color.g,r.color.b]),[[0,0,255]]);
 assert.deepEqual(markupRuns('[sprite icon_x]!').map(r=>[r.kind,r.name??r.text]),[['sprite','icon_x'],['text','!']]);
 assert.deepEqual(markupRuns('[color #00ff00').map(r=>r.text),[],'an unterminated tag still parses as a tag');
 assert.deepEqual(tokenizeMarkup('ab cd').map(t=>[t.type,t.value]),[['text','ab'],['whitespace',' '],['text','cd']]);
 const c=(...a)=>{const x=markupColor(a);return [x.r,x.g,x.b];};
 assert.deepEqual(c('#zzzzzz'),[0,0,0],'7-char form: failed parse gives black');assert.deepEqual(c('#FFF'),[0,15,255]);assert.deepEqual(c('#xyz'),[255,0,0]);
 assert.deepEqual(c('Yellow'),[255,235,4]);assert.deepEqual(c('gray'),[127,127,127]);assert.deepEqual(c('nope'),[255,255,255]);assert.deepEqual(c(),[255,255,255]);
});

test('ChatUI.ReLayout stacks lines bottom-up in the container',()=>{assert.deepEqual(stackLines([20,20,20],864),[804,824,844]);assert.deepEqual(stackLines([],864),[]);assert.ok(MAX_DOM_LINES>1080/20);});

const MANIFEST=new URL('../browser/assets/recovered/chat/manifest.json',import.meta.url);
test('exported HUD chat layout matches the original prefab',{skip:!present(MANIFEST)&&'run tools/export_chat.py'},()=>{
 const m=JSON.parse(readFileSync(MANIFEST,'utf8')),p=chatPrefab(m);
 assert.equal(p.line.timeOut,16);assert.deepEqual(p.line.panel.size,{x:768,y:20});assert.equal(p.maxLength,128);assert.deepEqual(p.keys,{13:'SendChat',27:'CancelChatting'});
 assert.ok(p.events.some(e=>e.event==='LostFocus'&&e.target==='CancelChatting'));assert.ok(p.events.filter(e=>e.target==='ReLayout').length===2);
 assert.equal(p.line.name.data.align,2);assert.equal(p.line.name.data.processMarkup,0);assert.equal(p.line.text.data.processMarkup,1);
 assert.ok(Math.abs(p.line.name.rect.x+256)<0.01&&p.line.name.rect.width===408);assert.ok(Math.abs(p.line.text.rect.x-163)<0.01);
 const v=p.line.name.data.color.rgba>>>0;assert.deepEqual([v&255,(v>>>8)&255,(v>>>16)&255],[182,205,43]);
 const at=(w,h)=>{const r=hudLayout(m.hud.nodes,{width:w,height:h});return {chat:r[p.pnlChat],box:r[p.textboxIndex],container:r[p.containerIndex]};};
 const big=at(1920,1080);assert.deepEqual([big.chat.x,big.chat.width,big.chat.height],[48,768,996]);assert.equal(big.container.height,864);assert.deepEqual([big.box.x,big.box.y,big.box.width,big.box.height],[48,968,720,28]);
 const small=at(1280,720);assert.equal(small.chat.height,636);assert.equal(small.container.height,504);assert.equal(small.box.y,608);
});
