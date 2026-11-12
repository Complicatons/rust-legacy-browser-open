import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3} from 'three';
import {TimeOfDay,radiationExposure} from '../browser/tod.mjs';
import {Metabolism,HumanBody} from '../browser/survival.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const scene=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/scene/manifest.json',import.meta.url)))):null;
const tod=hasRecovered?(scene.world.tod):null,zones=hasRecovered?(scene.world.radiationZones.map(z=>({...z,position:new Vector3(z.position[0],z.position[1],-z.position[2])}))):null;

test('recovered TOD_Sky starts at noon on 18 Feb 2013 at latitude/longitude 0; 45 min days, 15 min nights',needsAssets,()=>{
 assert.deepEqual([tod.Cycle.Hour,tod.Cycle.Day,tod.Cycle.Month,tod.Cycle.Year,tod.Cycle.Latitude,tod.Cycle.Longitude],[12,18,2,2013,0,0]);
 const t=new TimeOfDay(tod);assert.ok(!t.isNight);assert.ok(t.sunZenith<15);t.hour=0;assert.ok(t.isNight);assert.ok(t.sunZenith>160);
 // env lengths scale the full 24 h, selected by IsNight, rather than each naming a half-cycle.
 t.hour=12;let secs=0;while(!(t.cycle.Day===19&&t.hour>=12)&&secs<3000){t.update(1);secs++;}assert.ok(Math.abs(secs-2044)<=2,secs);assert.equal(t.cycle.Day,19);
});

test('twilight uses Mathf float underflow for IsNight; dates and moon phase wrap like EnvironmentControlCenter',needsAssets,()=>{
 const t=new TimeOfDay(tod);t.hour=19.7;assert.equal(t.isNight,false);t.hour=19.8;assert.equal(t.isNight,true);
 t.cycle.Year=2016;t.cycle.Month=2;t.cycle.Day=28;t.hour=23.99;t.cycle.MoonPhase=0.99999;t.update(1);
 assert.deepEqual([t.cycle.Year,t.cycle.Month,t.cycle.Day,t.hour],[2016,2,29,0]);assert.ok(t.cycle.MoonPhase<0);
 t.cycle.Month=12;t.cycle.Day=31;t.hour=23.99;t.update(1);assert.deepEqual([t.cycle.Year,t.cycle.Month,t.cycle.Day,t.hour],[2017,1,1,0]);
 t.hour=-1;assert.equal(t.hour,23);t.hour=25;assert.equal(t.hour,1);
});

test('sun and light directions follow the recovered dome rotation without inheriting its scale',needsAssets,()=>{
 const a=new TimeOfDay({...tod,domeRotation:[1,0,0,0,1,0,0,0,1]});
 const b=new TimeOfDay({...tod,domeRotation:[0,0,-5700,0,5700,0,5700,0,0]});
 for(const key of ['sunDirection','lightDirection']){const p=a[key],q=b[key];assert.ok(q.distanceTo(new Vector3(p.z,p.y,-p.x))<1e-9);assert.ok(Math.abs(q.length()-1)<1e-9);}
});

test('night: LerpValue reaches 0 after sunset and the light switches to the dim moon',needsAssets,()=>{
 const t=new TimeOfDay(tod);t.hour=21;assert.equal(t.lerpValue,0);assert.ok(t.lightIntensity<=tod.Night.MoonLightIntensity+1e-9);assert.ok(t.ambientColor.r<0.06);
 t.hour=12;assert.equal(t.lerpValue,1);assert.equal(t.lightIntensity,tod.Day.SunLightIntensity);assert.ok(t.lightDirection.y>0.9);
});

test('night cold: an unwarmed player burns 1,500 extra calories an hour; a lit fire keeps them warm',()=>{
 const run=(night,warm)=>{const m=new Metabolism({tickRate:2}),b=new HumanBody();m.night=night;for(let s=0;s<=600;s+=0.5){if(warm)m.markWarm(s);m.update(s,b,{});}return m;};
 const day=run(false,false),cold=run(true,false),fire=run(true,true);assert.equal(cold.coreTemperature,-1);assert.equal(fire.coreTemperature,1);
 assert.ok(Math.abs((day.caloricLevel-cold.caloricLevel)-1500/6)<5,`${day.caloricLevel} ${cold.caloricLevel}`);
 const m=new Metabolism(),b=new HumanBody();m.night=true;b.armor[5]=20;m.update(0,b);m.update(2,b);assert.equal(m.coreTemperature,0);
});

test('radiation zones: 12 recovered zones, exposure strongest at the centre, reduced by radiation armour',needsAssets,()=>{
 assert.equal(zones.length,12);const z=zones[1];assert.equal(z.exposurePerMin,1000);
 assert.equal(radiationExposure([z],z.position),1000);assert.ok(Math.abs(radiationExposure([z],z.position.clone().add(new Vector3(z.radius/2,0,0)))-500)<1e-6);
 assert.equal(radiationExposure([z],z.position.clone().add(new Vector3(z.radius+1,0,0))),0);assert.equal(radiationExposure([z],z.position,100),500);
 assert.equal(radiationExposure([z],z.position,200),0);assert.equal(radiationExposure([z],z.position,300),0);assert.equal(radiationExposure([z],z.position,-10),1000);
 const flat={...z,strongerAtCenter:false};assert.equal(radiationExposure([z,flat],z.position),2000);assert.equal(radiationExposure([flat],z.position.clone().add(new Vector3(z.radius/2,0,0))),1000);
});

test('zone exposure builds radiation poisoning, leaving lets rads decay, and anti-rads remove exposure',needsAssets,()=>{
 const m=new Metabolism(),body=new HumanBody();m.update(0,body);
 for(let s=2;s<=60;s+=2){m.addRads(radiationExposure([zones[1]],zones[1].position)*2/60);m.update(s,body);}
 assert.ok(m.hasRadiationPoisoning());assert.ok(body.health<100);
 const before=m.radiationLevel;m.update(62,body);assert.ok(m.radiationLevel<before);
 m.addAntiRad(1000);for(let s=64;s<=84;s+=2)m.update(s,body);assert.equal(m.radiationLevel,0);assert.equal(m.hasRadiationPoisoning(),false);
});
