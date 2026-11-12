// Start-up failure panel (browser/webgl-support.mjs): WebGL 2 probe, messages, and the panel itself, on a fake document.
import test from 'node:test';
import assert from 'node:assert/strict';
import {webgl2Problem,startupMessage,showStartupError} from '../browser/webgl-support.mjs';

function fakeDoc(available){
 const lost=[];
 const make=tag=>{const e={tag,children:[],attrs:{},textContent:'',remove(){doc.body.children=doc.body.children.filter(c=>c!==e);},append(...c){e.children.push(...c.filter(x=>x!==''));},
  setAttribute(k,v){e.attrs[k]=v;},focus(){doc.focused=e;},querySelector:sel=>sel==='button'?find(e,c=>c.tag==='button'):null,
  getContext:type=>available.includes(type)?{getExtension:n=>n==='WEBGL_lose_context'?{loseContext:()=>lost.push(type)}:null}:null};return e;};
 const find=(root,f)=>{for(const c of root.children??[]){if(typeof c!=='object')continue;if(f(c))return c;const r=find(c,f);if(r)return r;}return null;};
 const doc={lost,focused:null,body:{children:[],append(e){this.children.push(e);}},createElement:make,defaultView:{location:{reload(){doc.reloaded=true;}}},
  querySelector:sel=>sel==='#startup-error'?doc.body.children.find(c=>c.id==='startup-error')??null:null};
 return doc;
}

test('WebGL 2 probe: ok, WebGL 1 only, none, throwing; probe contexts are released',()=>{
 const ok=fakeDoc(['webgl2','webgl']);assert.equal(webgl2Problem(ok),null);assert.deepEqual(ok.lost,['webgl2']);
 assert.equal(webgl2Problem(fakeDoc(['webgl'])),'no-webgl2');
 assert.equal(webgl2Problem(fakeDoc([])),'no-webgl');
 assert.equal(webgl2Problem({createElement:()=>{throw Error('blocked');}}),'no-webgl');
});

test('messages tell the player what to change',()=>{
 const m=startupMessage('no-webgl2');assert.match(m.text,/WebGL 2/);assert.ok(m.fixes.some(f=>/hardware acceleration/.test(f)));assert.equal(m.reload,false);
 assert.equal(startupMessage('context-lost').reload,true);
 const e=startupMessage('error','Missing manifest.json');assert.match(e.text,/Missing manifest\.json/);assert.equal(e.reload,true);
});

test('one panel at a time, labelled, with a focused Reload button when it helps',()=>{
 const doc=fakeDoc(['webgl2']);
 showStartupError(doc,startupMessage('no-webgl'));
 const first=doc.body.children[0];assert.equal(first.id,'startup-error');assert.equal(first.role,'alertdialog');assert.equal(first.attrs['aria-labelledby'],'startup-error-title');
 assert.equal(first.children.filter(c=>c.tag==='button').length,0,'no reload: reloading does not bring WebGL back');
 showStartupError(doc,startupMessage('error','boom'));
 assert.equal(doc.body.children.length,1,'replaced, not stacked');
 const button=doc.body.children[0].children.find(c=>c.tag==='button');assert.equal(doc.focused,button);button.onclick();assert.equal(doc.reloaded,true);
});
