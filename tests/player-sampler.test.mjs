import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PlayerSampler} from '../browser/player-sampler.mjs';
import {STATE} from '../browser/net-client.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const config=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/players/manifest.json',import.meta.url))).movement):null;
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const settled=input=>{const s=new PlayerSampler(config);s.update(input,2,0);return s;};

test('equipment and crouch use separate inherited group and state transition durations',needsAssets,()=>{
 const s=settled({});s.update({group:'rifle'},0.05,1);
 const groups=s.debug().groups;near(groups.find(g=>g.name==='noitem').weight,0.75);near(groups.find(g=>g.name==='rifle').weight,0.25);
 s.update({group:'rifle',flags:STATE.crouch},0.1,1.1);
 const rifle=s.debug().groups.find(g=>g.name==='rifle');
 near(rifle.states.find(s=>s.state==='stand').weight,2/3);near(rifle.states.find(s=>s.state==='crouch').weight,0.125);
 assert.ok(rifle.states.every(s=>Number.isFinite(s.normalized)));
 const pose=s.update({group:'rifle',flags:STATE.crouch},1,2.1);
 assert.ok(pose.some(p=>p.name==='idle_crouch_compositing'));assert.ok(!pose.some(p=>p.name==='idle_stand'));
});

test('movement fades independently, retains heading on stop and samples one shared gait phase',needsAssets,()=>{
 // settled() with a velocity primes PlayerAnimation's previous-frame localVelocity (movement flag still off).
 const s=settled({z:2.1});let p=s.update({z:2.1,flags:STATE.movement},0.075,1);
 near(s.moveWeight,0.5);assert.ok(p.some(p=>p.name==='idle_stand'));assert.ok(p.some(p=>p.name==='walk_n'));
 s.update({z:2.1,flags:STATE.movement},0.075,1.075);const before=s.phase;
 p=s.update({x:2.1,flags:STATE.movement},0.1,1.175);near(s.phase,(before+0.1)%1);
 // CalculateVelocity still reads last frame's northward velocity, so the heading turns one frame later.
 assert.ok(p.some(p=>p.name==='walk_n'));assert.ok(!p.some(p=>p.name==='walk_e'));
 p=s.update({x:2.1,flags:STATE.movement},0.1,1.275);near(s.angle,54);
 near(p.find(p=>p.name==='walk_e').normalizedTime,(s.phase+0.25)%1);
 p=s.update({},0.1,1.375);near(s.moveWeight,0.5);assert.ok(p.some(p=>p.name==='walk_e'));
 near(s.phase,(before+0.2)%1);
 s.update({},0.1,1.475);near(s.moveWeight,0);
});

test('the movement normal is last frame velocity over this frame speed and only the turn cap makes it unit length',needsAssets,()=>{
 const s=new PlayerSampler(config);s.update({z:1},1,0);
 // Speeding up 1 -> 2 m/s straight ahead: normal (0, 1/2), no smoothing because the angle is unchanged.
 s.update({z:2,flags:STATE.movement},0.05,1);near(s.heading.north,0.5);near(s.heading.east,0);
 // A capped turn replaces the normal by the unit vector of the clamped angle.
 s.update({x:2,flags:STATE.movement},0.05,1.05);near(s.heading.north,1);
 s.update({x:2,flags:STATE.movement},0.05,1.1);near(s.angle,27);near(Math.hypot(s.heading.north,s.heading.east),1);
});

test('jump fades use original durations, force stand state and sample elapsed time without looping',needsAssets,()=>{
 const s=settled({flags:STATE.crouch});
 let p=s.update({flags:STATE.airborne|STATE.crouch},0.3,10);near(s.jumpWeight,0.5);
 assert.ok(p.some(p=>p.name==='idle_stand'));assert.ok(p.some(p=>p.clamp&&p.time===0));
 p=s.update({flags:STATE.airborne},2,12);near(s.jumpWeight,1);
 assert.ok(p.filter(p=>p.clamp).every(p=>p.time===2));assert.ok(!p.some(p=>p.name==='idle_stand'));
 s.update({},0.05,12.05);near(s.jumpWeight,0.5);s.update({},0.05,12.1);near(s.jumpWeight,0);
 p=s.update({flags:STATE.airborne},0.1,15);assert.ok(p.filter(p=>p.clamp).every(p=>p.time===0));
});

test('native gait units are shared across directions and negative offsets reverse sample time',needsAssets,()=>{
 const c=structuredClone(config);c.eastOffset=-0.25;
 const s=new PlayerSampler(c);s.update({x:2.1},2,0);near(s.phase%1,0);const p=s.update({x:2.1,flags:STATE.movement},0.2,1);
 near(s.phase,0.2);near(p.find(p=>p.name==='walk_e').normalizedTime,0.55);
});

test('slipping freezes state weights and uses the previous gait scale; zero delta does not corrupt state',needsAssets,()=>{
 const s=settled({z:2.1,flags:STATE.movement}),before=s.debug();
 s.update({x:2.1,group:'rifle',flags:STATE.slipping|STATE.crouch},0.1,1);
 assert.deepEqual(s.debug().groups,before.groups);near(s.phase,(before.phase+0.1)%1);near(s.moveWeight,1);
 s.update({flags:STATE.airborne},0,1);assert.ok(s.update({},0,1).every(p=>Number.isFinite(p.weight)));
});

test('duplicate inherited clips merge and additive channels stay separate from locomotion',needsAssets,()=>{
 const s=settled({group:'rifle'});const p=s.update({group:'pistol',pitch:Math.PI/4},0.1,1);
 assert.equal(new Set(p.map(p=>(p.additive?'+':'')+p.name)).size,p.length);
 const idle=p.find(p=>p.name==='idle_stand_compositing');near(idle.weight,1);
 assert.ok(p.some(p=>p.name==='aim_rifle_upper'));assert.ok(p.some(p=>p.name==='aim_pistol_upper'));
 near(p.filter(p=>p.additive&&p.name.endsWith('_upper')).reduce((n,p)=>n+p.weight,0),1);
 assert.ok(p.every(p=>Number.isFinite(p.weight)&&(p.normalizedTime==null||Number.isFinite(p.normalizedTime))));
});

test('instant and negative transition durations follow DurationToRateSafe without NaN',needsAssets,()=>{
 const c=structuredClone(config);c.moveFadeInDuration=0;c.jumpFadeInDuration=-0.6;
 const s=new PlayerSampler(c);s.update({},1,0);s.update({z:2,flags:STATE.movement|STATE.airborne},0,1);near(s.moveWeight,0);
 s.update({z:2,flags:STATE.movement|STATE.airborne},0.3,1.3);near(s.moveWeight,1);near(s.jumpWeight,0.5);
});
