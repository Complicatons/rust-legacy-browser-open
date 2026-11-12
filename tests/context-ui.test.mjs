import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {ContextClient,offlineContextServer,optionsLayout,stringLayout,backgroundRect,calcSize,QUICK_TAP_MS} from '../browser/context-ui.mjs';
import {present} from './helpers/assets.mjs';

// ContextUI GUISkin styles as exported (tools/export_context.py); checked against the manifest when it is present.
const box={padding:{left:0,right:0,top:0,bottom:0},margin:{left:0,right:0,top:0,bottom:0},overflow:{left:6,right:12,top:8,bottom:13},border:{left:6,right:12,top:8,bottom:13},fixedWidth:0,fixedHeight:0};
const button={padding:{left:4,right:4,top:4,bottom:4},margin:{left:0,right:0,top:0,bottom:1},overflow:{left:0,right:0,top:0,bottom:0},border:{left:2,right:2,top:2,bottom:2},fixedWidth:0,fixedHeight:0};
const measure=text=>({width:text.length*6,height:11});
const manifest='browser/assets/recovered/context/manifest.json';

test('context: exported ContextUI styles match the GUISkin values the layout uses', {skip:!present(manifest)}, ()=>{
 const m=JSON.parse(readFileSync(manifest,'utf8'));assert.equal(m.gameObject,'CONTEXT');assert.equal(m.enabled,false,'ContextUI starts disabled (OnGUI only between show and hide)');
 for(const [name,want] of [['ctxbox',box],['ctxbutton',button]]){const s=m.styles[name];for(const k of ['padding','margin','overflow','border'])assert.deepEqual(s[k],want[k],name+' '+k);assert.equal(s.fontSize,9);assert.equal(s.alignment,4,'MiddleCenter');}
 assert.equal(m.fonts[m.styles.ctxbutton.font].name,'ProFontWindows');
 assert.deepEqual(Object.keys(m.styles.ctxbutton.states).filter(k=>m.styles.ctxbutton.states[k].background),['normal','hover','active']);
});

test('context: GUIOptions lays the buttons out like the original OnGUI', ()=>{
 assert.deepEqual(calcSize(button,'Open',measure),{x:32,y:19});
 const l=optionsLayout(['Open','Enter Code'],{box,button},measure,{width:1280,height:720});
 // padding.Add(CeilToInt(CalcSize)) counts the padding twice: 60 + 8 + 8 = 76 wide, 11 + 8 + 8 = 27 high, + margin 1.
 assert.deepEqual(l.box,{x:602,y:332,width:76,height:56});
 assert.deepEqual(l.buttons,[{x:602,y:332,width:76,height:27},{x:602,y:361,width:76,height:27}]);
 // Three options: the next button starts at margin.Add(margin.Add(button)).yMax, 2 px apart, so the stack outgrows the box.
 const three=optionsLayout(['Open','Enter Code','Lock'],{box,button},measure,{width:1280,height:720});
 assert.equal(three.box.height,84);assert.deepEqual(three.buttons.map(b=>b.y-three.box.y),[0,29,58]);
 assert.deepEqual(backgroundRect(l.box,{overflow:box.overflow}),{x:596,y:324,width:94,height:77});
 assert.deepEqual(stringLayout('Enter Code',box,measure,{width:1280,height:720}).box,{x:610,y:354,width:60,height:11});
});

test('context: press, Invoke delay, quick tap, hold, choice and cancel follow ContextUI/Context', ()=>{
 const sent=[],log=[];const c=new ContextClient({send:(k,a)=>sent.push([k,a]),unlock:()=>log.push('unlock'),tryLock:()=>{log.push('lock');return true;},onWorking:w=>log.push(w?'working':'idle')});
 assert.equal(QUICK_TAP_MS,300);
 c.press('door',0);assert.equal(c.state,'polling');assert.deepEqual(sent,[['query','door']]);
 c.reply('E',[[{name:0,text:'Open'}]],100);assert.equal(c.showAt,250,'Invoke(OnClientShowMenu, elapsed + 50 ms)');
 c.frame(249,true);assert.equal(c.enabled,false);c.frame(250,true);assert.equal(c.enabled,true);
 c.release(300);assert.deepEqual(sent.at(-1),['quick',undefined],'a release at exactly 300 ms is still a quick tap');assert.equal(c.enabled,false);
 c.reply('K',[],320);assert.equal(c.state,'off');assert.deepEqual(log,['working','unlock','lock','idle']);
 // The menu that arrives after a quick tap is ignored (Validating); the server's answer to B ends the prompt.
 sent.length=0;c.press('door',1000);c.release(1100);c.reply('E',[[{name:0,text:'Open'}]],1120);assert.equal(c.state,'validating');assert.equal(c.enabled,false);c.reply('J',[],1130);assert.equal(c.state,'off');
 // Held past 300 ms: OnGUI ends the query once the key is up (cancel, D).
 sent.length=0;c.press('door',2000);c.reply('E',[[{name:3,text:'Close'},{name:4,text:'Enter Code'}]],2350);assert.equal(c.enabled,true);
 c.frame(2400,true);assert.equal(c.state,'options');c.frame(2500,false);assert.deepEqual(sent.map(s=>s[0]),['query','cancel']);c.reply('F',[],2510);assert.equal(c.state,'off');
 // A choice: C(option name), validatingString set, the box shows ContextUI.temp (the last option's text) until K.
 sent.length=0;c.press('door',3000);c.reply('E',[[{name:3,text:'Close'},{name:4,text:'Enter Code'}]],3400);assert.equal(c.select(0),true);assert.deepEqual(sent.at(-1),['menu',3]);
 assert.equal(c.validatingString,'Close..');assert.equal(c.lastText,'Enter Code');assert.equal(c.enabled,true);c.reply('K',[],3450);assert.equal(c.state,'off');assert.equal(c.enabled,false);
 // Restart polling (M) clears the options and shows the (empty) menu again.
 c.press('door',4000);c.reply('E',[[{name:3,text:'Close'}]],4400);c.reply('M',[],4500);assert.equal(c.state,'options');assert.deepEqual(c.options,[]);c.reply('G',[],4600);assert.equal(c.state,'off');
});

test('context: the offline island answers like the server Context (Quick vs Quick|Menu)', async()=>{
 const replies=[];let client;const flush=()=>new Promise(r=>setTimeout(r,0));
 const send=offlineContextServer({reply:(name,values)=>{replies.push(name);client.reply(name,values,0);}});client=new ContextClient({send});
 // Quick only (a lootable): the query itself runs it.
 let used=0;client.press({use:()=>{used++;}},0);await flush();assert.equal(used,1);assert.deepEqual(replies,['I']);assert.equal(client.state,'off');
 client.press({use:()=>false},0);await flush();assert.equal(replies.at(-1),'H');
 // Quick|Menu (a door): the query answers the menu; B runs the quick action, C the chosen option, D is a NoOp.
 const actions=[];const door={use:()=>{actions.push('use');},menu:()=>['Open','Enter Code'],menuAction:a=>{actions.push(a);}};
 client.press(door,0);await flush();assert.equal(replies.at(-1),'E');assert.deepEqual(client.options,[{name:0,text:'Open'},{name:1,text:'Enter Code'}]);
 client.release(100);await flush();assert.deepEqual(actions,['use']);assert.equal(replies.at(-1),'K');assert.equal(client.state,'off');
 client.press(door,1000);await flush();client.frame(1400,true);client.select(1);await flush();assert.deepEqual(actions,['use','Enter Code']);assert.equal(replies.at(-1),'K');
 client.press(door,2000);await flush();client.release(2500);await flush();assert.equal(replies.at(-1),'F');assert.deepEqual(actions,['use','Enter Code']);
 // An empty menu is a NoOp (no MenuQuickRouter in the shipped classes).
 client.press({use:()=>{},menu:()=>[]},0);await flush();assert.equal(replies.at(-1),'F');assert.equal(client.state,'off');
});

test('context: offline quick use gets the eyes origin and timestamp (BasicDoor opens away from the user)', async()=>{
 const calls=[];let client;const send=offlineContextServer({reply:(n,v)=>client.reply(n,v,0),eyes:()=>({x:1,y:2,z:3}),now:()=>42});client=new ContextClient({send});
 client.press({use:(eyes,ms)=>{calls.push(['quick-only',eyes,ms]);}},0);await new Promise(r=>setTimeout(r,0));
 client.press({use:(eyes,ms)=>{calls.push(['door',eyes,ms]);},menu:()=>['Open']},0);await new Promise(r=>setTimeout(r,0));client.release(100);await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(calls,[['quick-only',{x:1,y:2,z:3},42],['door',{x:1,y:2,z:3},42]]);
});
