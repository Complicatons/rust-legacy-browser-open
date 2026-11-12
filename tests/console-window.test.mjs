import test from 'node:test';
import assert from 'node:assert/strict';
import {appendConsoleText,echoLine,outputLine,layoutConsoleText,consoleScroll,thumbRect,plainLine,CONSOLE_TRIM_LENGTH} from '../browser/console-window.mjs';
import {setupNoticePopup,noticePosition} from '../browser/popup-ui.mjs';
import {noticeStyle,INFORMATION_NOTICE,DEFAULT_NOTICE_SECONDS} from '../browser/notices.mjs';

// A fixed 6 px font standing in for the exported Small Fonts dfFont.
const face={font:{lineHeight:11},glyphs:new Map([...' abcdefghijklmnopqrstuvwxyz>.:0123456789'].map(c=>[c.codePointAt(0),{xadvance:6}])),kerning:new Map()};

test('console: ConsoleWindow.AddText / RunCommand text and trimming', ()=>{
 let t='rust.\n';t=appendConsoleText(t,echoLine('status'));t=appendConsoleText(t,'hostname: x\nplayers : 1',true);t=appendConsoleText(t,outputLine('render.fov: 90'));
 assert.equal(t,'rust.\n[color #00ff00]> status[/color]\n[color #00ffff]hostname: x\nplayers : 1[/color]\n\n[color #ffff00]render.fov: 90[/color]\n');
 // Once the buffer reaches 5000 characters only its first line goes, once per AddText.
 const long='x'.repeat(CONSOLE_TRIM_LENGTH);assert.equal(appendConsoleText('a\nb\n',long),'b\n'+long+'\n');
 assert.equal(plainLine('[color #00ff00]> status[/color]'),'> status');
});

test('console: dfFont word wrap and markup colours across lines', ()=>{
 const rows=layoutConsoleText('[color #00ffff]aaaa bbbb cccc\ndd[/color] ee\n',face,60);
 // 'aaaa bbbb' is 54 px; 'cccc' would reach 60: break at the last space (dropped), 'cccc' starts the next row.
 assert.deepEqual(rows.map(r=>[r.line,r.runs.map(x=>x.text).join('')]),[[0,'aaaa bbbb'],[0,'cccc'],[1,'dd ee']]);
 assert.deepEqual(rows[1].runs[0].color,{r:0,g:255,b:255,a:1});assert.deepEqual(rows[2].runs.at(-1).color,{r:255,g:255,b:255,a:1});
 // A trailing newline adds no row (the exported 'rust.\n' label is one 11 px line high); a word without spaces overflows.
 assert.equal(layoutConsoleText('rust.\n',face,578).length,1);assert.equal(layoutConsoleText('abcdefghijklmnop',face,30).length,1);
});

test('console: dfScrollPanel / dfScrollbar values', ()=>{
 // Exported state: one 11 px line in the 520 px panel with 8 px scroll padding -> MaxValue 496, ScrollSize 504, no thumb.
 const s=consoleScroll({contentHeight:11,panelHeight:520});assert.deepEqual(s,{scroll:0,maxScroll:0,maxValue:496,scrollSize:504,value:0});
 assert.equal(thumbRect(s,{x:592,y:8,width:8,height:504}),null);
 const b=consoleScroll({contentHeight:1008,panelHeight:520,scroll:Infinity});assert.equal(b.scroll,504);assert.equal(b.maxValue,1008);
 assert.deepEqual(thumbRect(b,{x:592,y:8,width:8,height:504}),{x:588,y:261,width:16,height:250});
});

test('notices: PopupNotice setup and the original Notice.Popup icons', ()=>{
 const rolls=[0.5,0.25],range=(a,b)=>a+rolls.shift()*(b-a);
 assert.deepEqual(setupNoticePopup({labelX:48,height:56},{parentWidth:1280,textWidth:100,range}),{x:(1280-172)/2,y:-56-16,width:172,labelWidth:116});
 const moveIn={length:0.5,startValue:{x:0,y:0,z:0},endValue:{x:0,y:200,z:0},startValueIsOffset:1,endValueIsOffset:1,animCurve:{m_Curve:[{time:0,value:0,inSlope:1,outSlope:1},{time:1,value:1,inSlope:1,outSlope:1}]}};
 const moveOut={...moveIn,endValue:{x:0,y:-300,z:0}};const setup={x:10,y:-50};
 assert.deepEqual(noticePosition({moveIn,moveOut},setup,4,1),{x:10,y:150,z:0,done:false});
 assert.equal(noticePosition({moveIn,moveOut},setup,4,4.5).done,true);
 assert.deepEqual(noticeStyle('Door is now locked.'),{icon:'',seconds:4,source:true});
 assert.deepEqual(noticeStyle('You will not be able to spawn near here for 4 Minutes.'),{icon:'',seconds:7,source:true});
 assert.equal(noticeStyle('Password is now : 1234').icon,'');assert.equal(noticeStyle('You can now craft: M4').icon,'');assert.equal(noticeStyle('You can now craft Research Kit 1').icon,'');
 assert.equal(noticeStyle('Wait 12 seconds').icon,'');assert.equal(noticeStyle("There's no wood left here").seconds,2);
 assert.deepEqual(noticeStyle('Something else'),{icon:'',seconds:DEFAULT_NOTICE_SECONDS,source:false});
 assert.deepEqual(INFORMATION_NOTICE,{icon:'',seconds:5});
});
