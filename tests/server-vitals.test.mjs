import test from 'node:test';
import assert from 'node:assert/strict';
import {ServerVitals} from '../browser/server-vitals.mjs';
const emit=(s,type,detail)=>s.dispatchEvent(Object.assign(new Event(type),{detail}));
function session(calls=[]){const s=new EventTarget();s.state='in-game';s.vitalsCalls=new Map(calls.map(c=>[c.name,c]));return s;}
test('native vitals arriving before world load replay as absolute health, bleeding and all six metabolism fields',()=>{
 const s=session([{name:'Local_HealthChange',args:[72,0]},{name:'Local_BleedChange',args:[3]},{name:'RecieveNetwork',args:[987,12,75,20,-0.5,2],receivedAt:4}]),seen=[];
 const v=new ServerVitals(s,{now:()=>10,onChange:x=>seen.push(x)});assert.equal(v.health,72);assert.equal(v.bleeding,3);
 assert.deepEqual(v.metabolism,{caloricLevel:987,waterLevelLitre:12,radiationLevel:75,antiRads:20,coreTemperature:-0.5,poisonLevel:2,receivedAt:4});
 emit(s,'vitals-call',{name:'Local_HealthChange',args:[80,0]});assert.equal(v.health,80,'health is an absolute value, not damage');
 emit(s,'vitals-call',{name:'RecieveNetwork',args:[1,2,3,4,5,NaN]});assert.equal(v.metabolism.caloricLevel,987);assert.ok(seen.length>0);
});
test('native health/kill/destruction produce one death, no stale resurrection, and a new character resets state',()=>{
 const s=session();let deaths=0,spawns=0;const v=new ServerVitals(s,{onDeath:()=>deaths++,onSpawn:()=>spawns++});
 emit(s,'vitals-call',{name:'Local_HealthChange',args:[0,0]});emit(s,'vitals-call',{name:'Client_OnKilledBy',args:[30]});emit(s,'character-lost',{});
 assert.equal(deaths,1);assert.equal(s.state,'dead');emit(s,'vitals-call',{name:'Local_HealthChange',args:[100,0]});assert.equal(v.health,0);
 s.state='in-game';emit(s,'character',{viewId:21});assert.equal(spawns,1);assert.equal(v.health,100);assert.equal(v.bleeding,0);assert.equal(v.metabolism,null);
 emit(s,'vitals-call',{name:'Local_HealthChange',args:[62,0]});assert.equal(v.health,62);
});
test('transient vomit is not replayed after a long loading pause',()=>{
 const s=session([{name:'Vomit',args:[],receivedAt:0}]);let vomit=0;new ServerVitals(s,{now:()=>10,onVomit:()=>vomit++});assert.equal(vomit,0);
 emit(s,'vitals-call',{name:'Vomit',args:[],receivedAt:9.5});assert.equal(vomit,1);
});
