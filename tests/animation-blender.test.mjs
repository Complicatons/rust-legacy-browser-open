import test from 'node:test';
import assert from 'node:assert/strict';
import {Channel,LegacyAnimation,Mixer,idleSolo,weightOf} from '../browser/animation-blender.mjs';

const linear=(a,b,d)=>({m_Curve:[{time:0,value:a,inSlope:(b-a)/d,outSlope:(b-a)/d},{time:d,value:b,inSlope:(b-a)/d,outSlope:(b-a)/d}]});
const field=(name,clipName,o={})=>({name,clipName,startFrame:0,playbackRate:1,inDelay:0,outDelay:0,residualBlend:0,blockedByAnimation:0,inCurve:linear(0,1,1),outCurve:linear(1,0,1),...o});
// VM-Revolver's shipped idle mixer (ViewModel.idleFrame and the nine channels, in ChannelConfig index order).
const revolver={residual:{clipName:'idle_frame',startFrame:0,playbackRate:1,introCurve:{m_Curve:[{time:0,value:0,inSlope:0,outSlope:0},{time:0.2,value:1,inSlope:0,outSlope:0}]},residualBlend:0,channelBlend:0,animLayer:1,changeAnimLayer:1},
 channels:[field('idle','idle',{playbackRate:0.5,inDelay:8,residualBlend:0.8,blockedByAnimation:1,inCurve:linear(0,1,2),outCurve:linear(1,0,0.5)}),field('move','idle',{playbackRate:2.5}),field('dcki',''),
  field('dckm','idle',{playbackRate:1.5,residualBlend:0.6}),field('bowi','idle',{playbackRate:0.5,residualBlend:0.3}),field('bowm','idle',{playbackRate:1.5}),
  field('fall','idle',{playbackRate:-8,inCurve:linear(0,1,0.45),outCurve:linear(1,0,0.25)}),field('slip','idle',{playbackRate:3}),field('zoom','')]};
const clips=[{name:'deploy',length:2.3333,wrapMode:0},{name:'fire_1',length:0.8333,wrapMode:0},{name:'idle',length:2.0333,wrapMode:2},{name:'idle_frame',length:0.0033,wrapMode:2}];
const dt=1/60;
function rig(){const animation=new LegacyAnimation(clips),mixer=new Mixer(animation,revolver.residual,revolver.channels.map(f=>({name:f.name,field:f})));return {animation,mixer,look:[0,0]};}
// One frame in ViewModel order: Update (mixer), animation sample, LateUpdate (solo).
function frame(r,flags={},look=r.look){r.mixer.update(1,dt);const samples=r.animation.advance(dt);r.look=idleSolo(r.mixer,{grounded:true,...flags},look,r.look,dt);return Object.fromEntries(samples.filter(x=>x.weight>0).map(x=>[x.state.name,x.weight]));}
const run=(r,seconds,flags,look)=>{let w;for(let i=0;i<Math.round(seconds/dt);i++)w=frame(r,flags,look);return w;};

test('weightOf: zero weights swap to the end, the rest scale by the largest and normalise', () => {
 const items=[0.5,0,0.25].map(raw=>({weight:{raw,scaled:0,normalized:0}})),index=[0,1,2],{any,result}=weightOf(items,index);
 assert.equal(any,true);assert.equal(result.count,2);assert.deepEqual(index,[0,2,1]);assert.ok(Math.abs(items[0].weight.normalized-2/3)<1e-9&&Math.abs(items[2].weight.normalized-1/3)<1e-9);assert.equal(result.sum.raw,0.75);
});

test('Channel: the in curve raises the weight after its delay (eased by the out curve it leaves); the out curve lowers it from where it was', () => {
 const c=new Channel(0,0,'idle',field('idle','idle',{inDelay:0.5}));c.active=true;let v=0;
 for(let i=0;i<30;i++)v=c.update(dt);assert.equal(v,0,'still in the 0.5 s delay');
 // The induce influence carries the finished out curve's value 0 over the same second, so the ramp is t*t.
 for(let i=0;i<30;i++)v=c.update(dt);assert.ok(v>0.2&&v<0.3,String(v));for(let i=0;i<30;i++)v=c.update(dt);assert.ok(Math.abs(v-1)<1e-9,String(v));
 c.active=false;v=c.update(dt);assert.ok(v<1&&v>0.95,String(v));for(let i=0;i<60;i++)v=c.update(dt);assert.equal(v,0);
});

test('Channel: dropped mid-ramp, it keeps rising until the in-delay has passed again (from.state.delay = to.delayDuration)', () => {
 const c=new Channel(0,0,'idle',field('idle','idle',{inDelay:0.5}));c.active=true;let v=0;for(let i=0;i<60;i++)v=c.update(dt);
 c.active=false;const before=v;for(let i=0;i<20;i++)v=c.update(dt);assert.ok(v>before,'still inducing');for(let i=0;i<40;i++)v=c.update(dt);assert.ok(v<1,String(v));
});

test('revolver: a one-shot plays alone; after it the static idle frame holds until the idle sway fades in 8 s later at 20 %', () => {
 const r=rig();r.mixer.play('deploy');
 let w=frame(r);assert.deepEqual(Object.keys(w),['deploy']);assert.equal(w.deploy,1);
 w=run(r,2.2);assert.deepEqual(Object.keys(w),['deploy'],'idle stays out while the one-shot runs');
 w=run(r,0.5);assert.deepEqual(Object.keys(w),['idle_frame'],JSON.stringify(w));
 w=run(r,7);assert.deepEqual(Object.keys(w),['idle_frame'],'idle channel waits out its 8 s in-delay');
 w=run(r,3.5);assert.ok(Math.abs(w.idle-0.2)<1e-6&&Math.abs(w.idle_frame-0.8)<1e-6,JSON.stringify(w));
 assert.equal(r.animation.state('idle').speed,0.5);assert.equal(r.animation.state('idle_frame').layer,1);
});

test('revolver: walking plays the idle clip fully at 2.5x; aiming or crouching still settles on the idle frame', () => {
 const r=rig();r.mixer.play('fire_1');run(r,1);
 let w=run(r,1.5,{movement:true});assert.ok(Math.abs((w.idle??0)-1)<1e-6,JSON.stringify(w));assert.equal(r.animation.state('idle').speed,2.5);
 w=run(r,1.5,{aim:true});assert.deepEqual(Object.keys(w),['idle_frame']);
 w=run(r,1.5,{movement:true});w=run(r,1.5,{crouch:true});assert.deepEqual(Object.keys(w),['idle_frame']);
});

test('revolver: turning faster than 2 degrees a second drops the idle channel', () => {
 const r=rig();r.mixer.play('fire_1');run(r,13);assert.ok(r.mixer.channels[0].value.active);
 frame(r,{},[0,1]);assert.equal(r.mixer.channels[0].value.active,false);
});
