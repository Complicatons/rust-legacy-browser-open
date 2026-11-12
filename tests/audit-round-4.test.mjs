// GAP-AUDIT "Audit round 4, 2026-10-23": offline world rules re-read in the decompiled server (static only).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3,Quaternion,Ray,Euler} from 'three';
import {DeployableDecay,StructureDecay,DECAY,DECAY_DELAY} from '../browser/decay.mjs';
import {WorldRules} from '../browser/world-rules.mjs';
import {StructureSystem} from '../browser/structures.mjs';
import {DeployableSystem} from '../browser/deployables.mjs';
import {LegacyInventory} from '../browser/inventory.mjs';
import {HumanBody,Metabolism,useItem} from '../browser/survival.mjs';
import {saveWorld,loadWorld} from '../browser/persistence.mjs';
import {isTorch,torchActivated,torchServerFrame,torchState,consumeUses} from '../browser/torch-fuel.mjs';
import {spawnLook,toBrowserQuaternion} from '../browser/net-client.mjs';
import {MeleeGather} from '../browser/resources.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';

const catalogue=hasRecovered?JSON.parse(await readFile(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url))):null;
const manifest=hasRecovered?JSON.parse(await readFile(new URL('../browser/assets/recovered/deployables/manifest.json',import.meta.url))):null;
const items=catalogue?.items??null;
const skey=n=>Object.keys(manifest.structures).find(k=>manifest.structures[k].item===n),dkey=n=>Object.keys(manifest.deployables).find(k=>manifest.deployables[k].item===n);
const ikey=n=>Object.keys(items).find(k=>items[k].data.m_Name===n);
const close=(a,b,e=1e-9)=>Math.abs(a-b)<=e;

// A4-1: EnvDecay is not saved; a load is Awake again (StartDecay + Random(0.2..2) x tickrate).
test('A4-1 a loaded deployable restarts its decay stagger instead of the old session\'s absolute think time',()=>{
 const d=new DeployableDecay({maxHealth:1000,now:7200,random:()=>0});assert.equal(d.save(),null);
 // An older save's absolute lastDecayThink (7260 from a 2 h session) loaded into a session at t = 5.
 const fresh=new DeployableDecay({maxHealth:1000,now:5,random:()=>0}).load({lastDecayThink:7260,enabled:true});
 assert.equal(fresh.lastDecayThink,5+DECAY.decaytickrate*0.2);
 assert.ok(fresh.think(5+60+DECAY.decaytickrate)>0,'decays on the first full tick after the load');
});

// A4-2/A4-3: StructureComponent.OnOwnedByMasterStructure skips Touched while ServerSaveManager.IsLoading; the master
// saves only _decayDelayRemaining.
test('A4-2 loading a base keeps its saved decay delay; A4-3 pent-up decay is not saved',()=>{
 const rules=new WorldRules({structures:{components:new Set(),masters:new Set()},deployables:{objects:new Set()},random:()=>0});
 const m={materialType:1,decayState:{delayRemaining:100,pentUp:500}},piece={type:5,master:m};
 rules.load(()=>rules.onPlaced(piece,'local',0));
 assert.equal(m.decay.delayRemaining,100);assert.equal(m.decay.pentUp,0);assert.equal(rules.loading,false);
 const built={type:1,master:m};rules.onPlaced(built,'local',10);assert.equal(m.decay.delayRemaining,DECAY_DELAY[1],'building a piece still touches');
 const s=new StructureDecay({materialType:1});s.touched();s.pentUp=900;assert.deepEqual(s.save(),{delayRemaining:DECAY_DELAY[1]});
 assert.throws(()=>rules.load(()=>{throw Error('bad save');}),/bad save/);assert.equal(rules.loading,false);
});

function world(){const w={zones:[],system:null,raycast:()=>null,groundTerrainOnly:()=>true},s=new StructureSystem(manifest,items,w);w.system=s;
 const d=new DeployableSystem(manifest,items,{rng:()=>0.5}),rules=new WorldRules({structures:s,deployables:d,random:()=>0});
 for(const sys of [d,s]){const add=sys.onAdd;sys.onAdd=o=>{add?.(o);rules.onPlaced(o,'local',sys.clock??0);};}
 return {s,d,rules,player:{inventory:new LegacyInventory(catalogue,undefined,{rng:()=>0.5}),body:new HumanBody({rng:()=>0.5}),metabolism:new Metabolism({rng:()=>0.5})}};}

test('A4-1..3 an offline save loads like a server start: decay runs, fires and bag cooldowns restart',needsAssets,()=>{
 const a=world(),q=new Quaternion();
 const f=a.s.place(skey('Wood Foundation'),new Ray(new Vector3(0,10,0),new Vector3(0,-1,0)),new Vector3(0,-3.5,0),q,null);
 const decay=a.rules.masterDecay(f.master);decay.delayRemaining=5;decay.pentUp=1000;
 const box=a.d.place(dkey('Wood Storage Box'),new Vector3(50,0,50),q,0);
 const fire=a.d.place(dkey('Camp Fire'),new Vector3(-50,0,-50),q,0);fire.slots[6]={item:ikey('Wood'),uses:5,condition:1,maxCondition:1};fire.fire.setOn(true,7000);
 const bag=a.d.place(dkey('Sleeping Bag'),new Vector3(80,0,80),q,0);bag.lastSpawnTime=7100;
 const saved=JSON.parse(JSON.stringify(saveWorld({now:7200,structures:a.s,deployables:a.d,player:a.player})));
 for(const d of saved.deployables){assert.equal('decay' in d,false);assert.equal('lastSpawnTime' in d,false);if(d.fire)assert.deepEqual(d.fire,{isOn:true});}
 assert.deepEqual(saved.structures[0].decay,{delayRemaining:5});

 const b=world();b.d.clock=b.s.clock=3;
 b.rules.load(()=>loadWorld(saved,{now:3,structures:b.s,deployables:b.d,player:b.player}));
 const [m2]=b.s.masters,[box2,fire2,bag2]=b.d.objects;
 assert.equal(m2.decay.delayRemaining,5,'not reset to the full 48 h');assert.equal(m2.decay.pentUp,0);
 assert.ok(box2.decay.lastDecayThink>=3+60&&box2.decay.lastDecayThink<=3+600,String(box2.decay.lastDecayThink));
 const before=box2.health;b.rules.tick(box2.decay.lastDecayThink+DECAY.decaytickrate);assert.ok(box2.health<before,'the box decays in the new session');
 // FireBarrel.ReadObjectSave -> SetOn(true): ConsumeFuel again after Random.Range(30, 60) from the load (rng 0.5: 45 s).
 assert.equal(fire2.fire.isOn,true);assert.equal(fire2.fire.nextFuel,3+45);
 assert.equal(bag2.lastSpawnTime,-Infinity);assert.equal(bag2.canSpawn(4),true);
});

// A4-4: BasicTorchItem.ServerFrame (server only).
test('A4-4 a held torch burns one use per second plus one per draw and is used up',()=>{
 const torch={item:'torch',uses:250};torchActivated(torch,10);
 assert.equal(torchServerFrame(torch,10.25),false);assert.equal(torch.uses,249,'consumeAmount 1 + 0.25: one use');
 for(let i=2;i<=40;i++)torchServerFrame(torch,10+i*0.25);
 assert.equal(torch.uses,239);assert.equal(torchState(torch).consumeAmount,0);
 // Holstered time does not burn (no ServerFrame), but the next draw adds a use and lastTickTime restarts.
 torchActivated(torch,100);torchServerFrame(torch,100.25);assert.equal(torch.uses,238);
 const last={item:'torch',uses:1};torchActivated(last,0);assert.equal(torchServerFrame(last,0.1),true);assert.equal(last.uses,0);
 assert.equal(consumeUses({uses:0},1),true);assert.equal(consumeUses({uses:3},0),false);
 assert.deepEqual(Object.keys(torch).sort(),['item','uses'],'nothing extra on the saved slot object');
});
test('A4-4 the shipped Torch is the BasicTorchItem with 250 uses',needsAssets,()=>{
 const t=items[ikey('Torch')];assert.equal(isTorch(t),true);assert.equal(t.data._maxUses,250);assert.equal(isTorch(items[ikey('Flare')]),false);
});

// A4-5: Character.EyesSetup on a new character.
test('A4-5 a new character looks level along its spawn rotation',()=>{
 const unity=e=>{const q=new Quaternion().setFromEuler(new Euler(e[0]*Math.PI/180,e[1]*Math.PI/180,e[2]*Math.PI/180,'YXZ'));return [q.x,q.y,q.z,q.w];};
 assert.deepEqual(spawnLook([0,0,0,1]),{yaw:-0,pitch:0});
 assert.ok(close(spawnLook(unity([0,90,0])).yaw,-Math.PI/2));
 // Unity yaw 90 faces +X; the browser forward (-sin yaw, 0, -cos yaw) is +X too.
 const yaw=spawnLook(unity([0,90,0])).yaw;assert.ok(close(-Math.sin(yaw),1)&&close(-Math.cos(yaw),0));
 // A tilted rotation keeps only localEulerAngles.y; pitch is the eyes' (0).
 const tilted=spawnLook(unity([-30,40,10]));assert.ok(close(tilted.yaw,-40*Math.PI/180,1e-6));assert.equal(tilted.pitch,0);
 // Online: the Create's browser quaternion converted back to Unity.
 const b=toBrowserQuaternion(unity([0,-120,0]));assert.ok(close(spawnLook([-b[0],-b[1],b[2],b[3]]).yaw,120*Math.PI/180,1e-6));
});

// A4-6: TakeDamage.HurtSelf / Hurt(attacker, victim, float) carry no DamageTypeList: armour does not apply.
test('A4-6 starvation, bleeding and bad food ignore armour',()=>{
 const armored=()=>{const b=new HumanBody({maxHealth:100,bleedInterval:8});b.armor=[200,200,200,200,200,200];return b;};
 const body=armored(),m=new Metabolism({tickRate:2});m.caloricLevel=0;m.update(0,body);m.update(2,body);
 assert.ok(close(body.health,100-2/60*10),String(body.health));
 const bleeder=armored();bleeder.setBleedingLevel(5,0);bleeder.update(8);assert.equal(bleeder.health,95);
 const eater=armored(),m2=new Metabolism();assert.equal(useItem({calories:10,litresOfWater:0,healthToHeal:-7},{},{metabolism:m2,body:eater,now:10}),true);assert.equal(eater.health,93);
});

// A4-7: RPOS.DoMetabolismUpdate only from Metabolism.RecieveNetwork (after each server tick).
test('A4-7 the HUD shows the metabolism values of the last tick',()=>{
 const body=new HumanBody(),m=new Metabolism({tickRate:2});
 assert.equal(m.shown.caloricLevel,1250);assert.equal(m.shown.warm,false);
 m.update(0,body);m.addCalories(500);m.addRads(600);m.markWarm(1);
 assert.equal(m.shown.caloricLevel,1250,'eating shows on the next tick');assert.equal(m.shown.radiationLevel,0);
 m.markWarm(2);m.update(2,body);
 assert.ok(m.shown.caloricLevel>1700&&m.shown.caloricLevel<1750);assert.ok(m.shown.radiationLevel>500);assert.equal(m.shown.warm,true);assert.equal(m.shown.coreTemperature,1);
 m.update(4,body);assert.equal(m.shown.warm,false,'warmth is not held past a tick away from the fire');
 const dead=new HumanBody(),m3=new Metabolism({tickRate:2});m3.update(0,dead);const shown=m3.shown;dead.health=0;m3.update(2,dead);assert.equal(m3.shown,shown);
});

// A4-8: MeleeWeaponDataBlock.DoAction1 returns at the 6 m check before SubtractCalories.
test('A4-8 a swing the server rejects at 6 m is marked far (no calories)',()=>{
 const g=new MeleeGather({rng:()=>0.5}),tool={damageMin:10,damageMax:20,efficiencies:[1,1,1,1,1,1]};
 const deployed=x=>({body:{deployed:{destroyed:false,position:new Vector3(x,0,0),hurt:()=>5}}});
 assert.equal(g.resolve(0,tool,'rock',deployed(7),null,'wood',new Vector3(0,0,0)).far,true);
 assert.equal(g.resolve(0,tool,'rock',deployed(3),null,'wood',new Vector3(0,0,0)).far,undefined);
 assert.equal(g.resolve(0,tool,'rock',null,null,'wood',new Vector3()).far,undefined,'a miss still costs calories');
});
