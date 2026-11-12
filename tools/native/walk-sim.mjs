// Walk-to-meet offline: the harness walker (walk-meet.mjs walkMeetCore) driving the port's own player motor
// (browser/motor.mjs LegacyMotor at 60 Hz) on the port's collision world (the gateway's LineOfSight world: scene
// colliders, trees, RockSpawn rocks, heightmap), with the original server's TruthDetector (tools/truth-detector.mjs)
// judging every move sent at the server send rate. Keys map like the page's: W/S forward, A/D strafe, Shift sprint,
// Space jump; aim() turns the yaw. `serverOnly(o, n)` (Unity-space segment, like TruthDetector's trace) adds blocks
// only the server has: a hit rolls the motor back one round trip later, as ReadClientMove does in online.mjs.
// `dieAt` (seconds) kills the walker (wildlife on the way): the motor stops and status() reports the death.
// Node only; needs browser/assets/recovered. Used by tests/walk-meet.test.mjs and for reproducing real-run walks.
import {readFile} from 'node:fs/promises';
import {Vector3,Matrix4} from 'three';
import {LegacyMotor} from '../../browser/motor.mjs';
import {MovingBody} from '../../browser/collision.mjs';
import {TruthDetector,losTrace} from '../truth-detector.mjs';
import {TRUTH_MASK} from '../../bridge/line-of-sight.mjs';
import {loadCollision} from './walk-plan.mjs';

let config=null;
// The motor's world: the walk-plan collision world with the terrain under it (world.rayHit, which the line-of-sight
// checks use, never reads it).
export async function loadSimWorld(){
 const col=await loadCollision();if(!col)throw new Error('no collision world (browser/assets/recovered)');
 col.los.world.ground??=col.los.ground;
 config??=JSON.parse(await readFile(new URL('../../browser/assets/recovered/player.json',import.meta.url),'utf8'));
 return {...col,config,trace:losTrace(col.los,TRUTH_MASK)};
}
// A solid box (browser space) only the port has, e.g. a rock the navmesh was baked through; remove() takes it out.
export function addPortBox(sim,center,size,yaw=0){const b=new MovingBody('sim box');b.layer=0;b.addBox(size,[0,0,0],new Matrix4());
 b.setMotion(new Matrix4().makeRotationY(yaw).setPosition(...center));sim.los.world.addBody(b);return {body:b,remove:()=>sim.los.world.removeBody(b)};}

const toU=p=>[p[0],p[1],-p[2]],toB=toU;
export function simBody(sim,start,{serverOnly=null,rtt=0.15,sendInterval=0.2,dieAt=Infinity,deathReason='TODO: Handle this death condition Wolf(Clone) (Character)'}={}){
 const motor=new LegacyMotor(sim.config,sim.los.world),held=new Set();
 motor.teleport(new Vector3(...start),{settle:true});for(let k=0;k<30;k++)motor.update(1/60,{},0);
 const trace=(o,n)=>sim.trace(o,n)??serverOnly?.(o,n)??null;
 const td=new TruthDetector({trace});td.noteTeleported(toU(motor.feet.toArray()));
 let t=0,yaw=0,nextSend=0,corrections=0,pending=[],kicked=null;
 const stats={moves:0,corrections:0,teleports:0,jumps:0,maxSpeed:0,path:[]};
 const step=()=>{const dt=1/60;t+=dt;
  for(const c of pending.filter(c=>c.at<=t)){motor.teleport(new Vector3(...c.pos));corrections++;stats.corrections++;}pending=pending.filter(c=>c.at>t);
  if(t>=dieAt||kicked)return;
  const input={forward:(held.has('KeyW')?1:0)-(held.has('KeyS')?1:0),right:(held.has('KeyD')?1:0)-(held.has('KeyA')?1:0),sprint:held.has('ShiftLeft'),jump:held.has('Space')};
  if(input.jump)stats.jumps++;
  motor.update(dt,input,yaw);
  if(t>=nextSend){nextSend+=sendInterval;const o=toU(motor.feet.toArray()),r=td.noteMoved(o,1000+t);stats.moves++;
   if(stats.moves%5===0)stats.path.push(motor.feet.toArray().map(v=>Math.round(v*10)/10));
   if(r.action==='kicked')kicked={t,violation:td.violation};else if(r.action==='moved')pending.push({at:t+rtt,pos:toB(r.pos)});}
 };
 const body={
  now:()=>Math.round(t*1000),
  async sleep(ms){const until=t+ms/1000;while(t<until-1e-9)step();},
  async feet(){return kicked?null:motor.feet.toArray();},
  async status(){return t>=dieAt?{dead:true,health:0,reason:deathReason}:{dead:false,health:100};},
  async aim(p){const f=motor.feet,dx=p[0]-f.x,dz=p[2]-f.z;if(dx||dz)yaw=Math.atan2(-dx,-dz);},
  async keys(keys){held.clear();for(const k of keys)held.add(k);},
  async release(){held.clear();},
  async corrections(){return corrections;},
 };
 return {body,motor,td,stats,get kicked(){return kicked;},get time(){return t;}};
}
