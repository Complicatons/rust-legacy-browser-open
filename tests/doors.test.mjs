import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {Matrix4,Vector3} from 'three';
import {createDoors,DoorState} from '../browser/doors.mjs';
import {CollisionWorld,MovingBody} from '../browser/collision.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const base=new URL('../browser/assets/recovered/scene/',import.meta.url);
const manifest=hasRecovered?(JSON.parse(await readFile(new URL('manifest.json',base)))):null;
const close=(a,b,eps=1e-3)=>a.every((v,i)=>Math.abs(v-b[i])<eps);
const garageIndex=hasRecovered?(manifest.doors.findIndex(d=>d.name.startsWith('GarageDoor_AngleOpen')&&!(d.settings.startConfig&1))):null;
const hingedIndex=hasRecovered?(manifest.doors.findIndex(d=>d.name.startsWith('BlueDoor'))):null;

test('all 32 original MovingDoors export with their own mesh, solid collider and original sounds',needsAssets,async()=>{
 assert.equal(manifest.doors.length,32);assert.deepEqual(manifest.doorOmissions,[]);
 manifest.doors.forEach((d,i)=>{// Visuals come from the client scene and link by name + world position (clientGameObjectPathID).
  assert.ok(manifest.instances.some(x=>x.door===i&&x.gameObjectPathID===d.clientGameObjectPathID),d.name);assert.ok(manifest.colliders.some(c=>c.door===i),d.name);});
 const garage=manifest.doors[garageIndex];
 for(const kind of ['open','close']){const file=garage.sounds[kind];assert.match(file,/\.ogg$/);assert.ok((await stat(new URL(file,base))).size>50000);}
 assert.equal(manifest.sounds[Object.keys(manifest.sounds).find(k=>manifest.sounds[k].file===garage.sounds.open)].name,'garage_door_open');
});

test('door closed pose reproduces the exported source transform of its own collider',needsAssets,()=>{
 for(const door of createDoors(manifest)){
  const collider=manifest.colliders.find(c=>c.door===door.index&&c.gameObjectPathID===door.record.gameObjectPathID);
  assert.ok(close(door.closedWorld.toArray(),collider.matrix),door.name);
  if(door.startsOpened){assert.equal(door.state,DoorState.Opened);assert.equal(door.fraction,1);}
  else {assert.equal(door.state,DoorState.Closed);assert.ok(close(door.motion.toArray(),new Matrix4().toArray(),1e-9));}
 }
});

test('BasicDoor timing: open/close durations, events and continuous mid-motion reversal',needsAssets,()=>{
 const door=createDoors(manifest)[garageIndex],events=[];door.onEvent(t=>events.push(t));const t0=1_700_000_000_000;
 assert.equal(door.contextText(),'Open');assert.equal(door.use(new Vector3(),t0),true);
 door.update(t0+2200);assert.equal(door.state,DoorState.Opening);assert.ok(Math.abs(door.fraction-0.5)<1e-6);assert.equal(door.contextText(),null);
 door.update(t0+Math.ceil(door.durationOpen*1000));assert.equal(door.state,DoorState.Opened);assert.equal(door.fraction,1);assert.equal(door.contextText(),'Close');
 assert.deepEqual(events,['open','opened']);
 const t1=t0+10000;assert.equal(door.use(null,t1),true);door.update(t1+1800);assert.ok(Math.abs(door.fraction-0.5)<1e-6);
 // Reversing mid-close resumes from the same opening fraction (StartOpeningOrClosing remaining-time maths).
 assert.equal(door.use(null,t1+1800),true);door.update(t1+1800);assert.ok(Math.abs(door.fraction-0.5)<1e-3);
 door.update(t1+1800+Math.ceil(door.durationOpen*500)+5);assert.equal(door.state,DoorState.Opened);
 // Original quick-toggle guard compares milliseconds with minimumTimeBetweenOpenClose (1).
 assert.equal(door.use(null,t1+5000),true);assert.equal(door.use(null,t1+5001),false);
});

test('MovingDoor roll-up maths rotates about the recovered pivot and slerps its travel',needsAssets,()=>{
 const door=createDoors(manifest)[garageIndex],p=door.closedPositionPivot;
 const pose=f=>{const m=door.updateMovement(f);return p.clone().applyQuaternion(m.rotation).add(m.position);};
 // Rotation is about the pivot, so the pivot itself only travels along openMovement (rotated into the parent frame).
 const travel=f=>pose(f).sub(pose(0)),axis=door.openMovement.clone().applyQuaternion(door.originalLocalRotation);
 assert.ok(travel(1).distanceTo(axis)<1e-5);
 // slerpMovementByDegrees with -90 degrees: travel fraction is sin(0.5θ)/sin(θ) = 0.7071 at half-open, not 0.5.
 assert.ok(travel(0.5).distanceTo(axis.clone().multiplyScalar(Math.SQRT1_2))<1e-5);
 assert.ok(Math.abs(door.updateMovement(1).rotation.angleTo(door.originalLocalRotation)-Math.PI/2)<1e-6);
});

test('reversible hinged doors open away from the opener side',needsAssets,()=>{
 const [a,b]=[createDoors(manifest)[hingedIndex],createDoors(manifest)[hingedIndex]];assert.equal(a.canOpenReverse,true);
 const axis=new Vector3().crossVectors(a.rotationCross,a.rotationAxis),forward=new Vector3(axis.x,axis.y,-axis.z).transformDirection(a.closedWorld);
 const center=new Vector3().setFromMatrixPosition(a.closedWorld);
 a.use(center.clone().addScaledVector(forward,1.5),1e12);b.use(center.clone().addScaledVector(forward,-1.5),1e12);
 assert.notEqual(a.openingInReverse,b.openingInReverse);a.update(1e12+1000);b.update(1e12+1000);assert.ok(a.fraction*b.fraction<0);
});

test('door collision body moves with the door and stops blocking once opened',needsAssets,()=>{
 const door=createDoors(manifest)[garageIndex],collider=manifest.colliders.find(c=>c.door===garageIndex);
 const world=new CollisionWorld(null),body=world.addBody(new MovingBody(door.name));body.addBox(collider.size,collider.center,new Matrix4().fromArray(collider.matrix));world.build();
 // Stand against the closed door's face (the capsule test only sees faces whose plane is in front of its axis).
 const matrix=new Matrix4().fromArray(collider.matrix),center=new Vector3(...collider.center).applyMatrix4(matrix),normal=new Vector3(0,0,1).transformDirection(matrix);
 const feet=center.clone().addScaledVector(normal,collider.size[2]/2+0.3);feet.y=center.y-1;
 assert.equal(world.overlaps(feet,1.8,0.405),true);
 door.use(null,1e12);door.update(1e12+door.durationOpen*1000);body.setMotion(door.motion);
 assert.equal(world.overlaps(feet,1.8,0.405),false);
});
