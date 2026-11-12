import test from 'node:test';
import assert from 'node:assert/strict';
import {HeldItem,smoothDampVector,OFFSET_SPEED} from '../browser/held-item.mjs';
import {smoothDamp} from '../browser/viewmodel.mjs';

const dt=1/60,step=(held,mouse,n)=>{let at=null;for(let i=0;i<n;i++)at=held.update(dt,mouse);return at;};

test('smoothDampVector is Vector3.SmoothDamp: one axis matches Mathf.SmoothDamp', () => {
 const velocity=[0],state={velocity:0};let a=[50],b=50;
 for(let i=0;i<30;i++){a=smoothDampVector(a,[0],velocity,0.06,600,dt);b=smoothDamp(b,0,state,0.06,600,dt);assert.ok(Math.abs(a[0]-b)<1e-9,`${a[0]} ${b}`);}
});

test('picking an item starts the icon on its cell and eases it to the cursor (GUIHeldItem.SetHeldItem(cell))', () => {
 const held=new HeldItem({unitPx:()=>450}),mouse=[100,100];held.set('icon',[140,130],mouse);
 const first=held.update(dt,mouse);assert.deepEqual([first.x,first.y,first.alpha],[140,130,1]);
 let last=first;for(let i=0;i<5;i++){const at=held.update(dt,mouse);assert.ok(Math.hypot(at.x-last.x,at.y-last.y)<=OFFSET_SPEED*dt+1e-9,'offset moves at most 600 px/s');last=at;}
 const settled=step(held,mouse,30);assert.ok(Math.hypot(settled.x-100,settled.y-100)<0.5,JSON.stringify(settled));
});

test('putting it into a cell eases it there while it fades out, then it is gone', () => {
 const held=new HeldItem({unitPx:()=>450}),mouse=[100,100];held.set('icon',null,mouse);held.update(dt,mouse);
 held.clearInto([200,100]);assert.equal(held.hasItem,false);assert.equal(held.fadingOut,true);
 let alpha=1,x=100,frames=0,at;while((at=held.update(dt,mouse))){assert.ok(at.alpha<alpha&&at.x>x&&at.x<=200);alpha=at.alpha;x=at.x;frames++;}
 // Critically damped 0.1 s: the icon is within 1/256 of the cell after about 0.4 s.
 assert.ok(frames>15&&frames<40,String(frames));assert.equal(held.visible,false);
});

test('a drop on the icon\'s own spot fades it where it is (fadeOutPointEnd.z++)', () => {
 const held=new HeldItem({unitPx:()=>450}),mouse=[100,100];held.set('icon',null,mouse);held.update(dt,mouse);held.clearInto([100,100]);
 const at=held.update(dt,mouse);assert.deepEqual([at.x,at.y],[100,100]);assert.ok(at.alpha<1);
});

test('clearing without a cell hides the icon at once; picking again stops a fade', () => {
 const held=new HeldItem({unitPx:()=>450}),mouse=[0,0];held.set('icon',null,mouse);held.clear();assert.equal(held.update(dt,mouse),null);
 held.set('icon',null,mouse);held.clearInto([50,0]);held.update(dt,mouse);held.set('other',[10,0],mouse);const at=held.update(dt,mouse);assert.equal(at.alpha,1);assert.equal(held.fadingOut,false);
});
