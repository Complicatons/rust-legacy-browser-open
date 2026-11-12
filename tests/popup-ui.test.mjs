import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {color32,evaluateCurve,tweenAt,inventoryPrefab,setupInventoryPopup,popupPosition} from '../browser/popup-ui.mjs';
import {clientUICommand} from '../browser/lock-entry.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const manifest=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/popup/manifest.json',import.meta.url)))):null,p=hasRecovered?(inventoryPrefab(manifest.inventory)):null;
const close=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);

test('notice.inventory console command (Rust.Notice.Inventory + QuoteSafe) becomes an inventory popup only',()=>{
 assert.deepEqual(clientUICommand('notice.inventory "10 x Wood"'),{type:'inventory',message:'10 x Wood'});
 assert.deepEqual(clientUICommand('notice.inventory "3 x \\"Odd\\" Ore"'),{type:'inventory',message:'3 x "Odd" Ore'});
 assert.deepEqual(clientUICommand('notice.inventory Wood'),{type:'inventory',message:'Wood'});
 assert.equal(clientUICommand('notice.inventory "1 x Wood"; quit'),null);assert.equal(clientUICommand('notice.inventory'),null);
 assert.deepEqual(clientUICommand('notice.popup 4 "!" "Inventory full, can\'t gather."'),{type:'notice',message:"Inventory full, can't gather.",seconds:4,icon:'!'});
});

test('packed dfControl Color32 values decode with red in the low byte',()=>{
 assert.deepEqual(color32(4281216558),{r:46,g:46,b:46,a:1});assert.deepEqual(color32(3053453311),{r:255,g:255,b:255,a:181/255});assert.deepEqual(color32(2432761840),{r:240,g:255,b:0,a:145/255});
});

test('original PopupInventory prefab: 32px panel, label at x40, MoveIn/MoveOut 0.3s tweens and 1.5s hold',needsAssets,()=>{
 assert.equal(p.seconds,1.5);assert.equal(p.height,32);assert.equal(p.label.x,40);assert.equal(p.label.fontSize,16);assert.equal(p.icon.text,'');assert.equal(p.background.sprite,'BLANK_TEXTURE');
 assert.equal(p.moveIn.tweenName,'MoveIn');assert.equal(p.moveOut.tweenName,'MoveOut');assert.equal(p.moveIn.endValue.x,-200);assert.equal(p.moveOut.endValue.x,200);close(p.moveIn.length,0.3);close(p.moveOut.length,0.3);
});

test('AnimationCurve evaluation is Hermite through keys and clamps outside them',needsAssets,()=>{
 const keys=p.moveIn.animCurve.m_Curve;for(const k of keys)close(evaluateCurve(keys,k.time),k.value,1e-6);
 assert.equal(evaluateCurve(keys,-1),keys[0].value);assert.equal(evaluateCurve(keys,2),keys.at(-1).value);
 const line=[{time:0,value:0,inSlope:1,outSlope:1},{time:1,value:1,inSlope:1,outSlope:1}];for(const t of [0.1,0.25,0.5,0.9])close(evaluateCurve(line,t),t);
});

test('dfTweenVector3 offsets from the bound RelativePosition and lands exactly on the end value',needsAssets,()=>{
 const base={x:1280,y:500,z:0};close(tweenAt(p.moveIn,base,0).x,1280+(-200)*evaluateCurve(p.moveIn.animCurve.m_Curve,0),1e-6);
 assert.deepEqual(tweenAt(p.moveIn,base,0.31),{x:1080,y:500,z:0});assert.deepEqual(tweenAt(p.moveIn,base,5),{x:1080,y:500,z:0});
 const mid=tweenAt(p.moveIn,base,0.15);assert.ok(mid.x<1280&&mid.x>1080);
});

test('PopupInventory.Setup: measured width, right-edge entry, six cycling rows and random calls in source order',needsAssets,()=>{
 const calls=[],values=[0.5,0.5,0.75];const range=(min,max)=>{calls.push([min,max]);return min+values[calls.length-1]*(max-min);};
 const s=setupInventoryPopup(p,{parentWidth:1280,parentHeight:720,textWidth:60,row:0,range});
 assert.deepEqual(calls,[[-16,16],[-16,16],[-100,100]]);assert.equal(s.labelWidth,76);assert.equal(s.width,40+76+8);assert.equal(s.x,1280);close(s.y,720*0.7+(0/6-0.5)*720*0.2);assert.equal(s.moveOut.endValue.y,50);assert.equal(s.nextRow,1);
 const zero=()=>0;assert.equal(setupInventoryPopup(p,{parentWidth:1280,parentHeight:720,textWidth:10,row:5,range:zero}).nextRow,0);
 const rows=[0,1,2,3,4,5].map(row=>setupInventoryPopup(p,{parentWidth:1280,parentHeight:720,textWidth:10,row,range:zero}).y);for(let i=1;i<6;i++)close(rows[i]-rows[i-1],720*0.2/6);
 assert.ok(p.moveOut.endValue.y===0,'Setup does not mutate the exported prefab (source stores -0)');
});

test('popup lifetime: slides in 200px, holds until 1.5s, exits right with its random vertical offset, then is destroyed',needsAssets,()=>{
 const s=setupInventoryPopup(p,{parentWidth:1280,parentHeight:720,textWidth:60,row:2,range:(min,max)=>max});
 assert.equal(popupPosition(p,s,0.31).x,s.x-200);assert.equal(popupPosition(p,s,1.4).x,s.x-200);assert.equal(popupPosition(p,s,1.4).done,false);
 const leaving=popupPosition(p,s,1.5+0.15);assert.equal(leaving.done,false);const end=popupPosition(p,s,1.5+0.31);assert.equal(end.done,true);assert.equal(end.x,s.x);assert.equal(end.y,s.y+100);
});
