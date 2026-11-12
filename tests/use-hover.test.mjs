import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {useHoverPosition,printedWidth,contextKind,lootContextText,fireContextText,doorTextPoint,lootTextPoint,spriteTextPoint} from '../browser/use-hover.mjs';
import {LegacyDoor} from '../browser/doors.mjs';

// The exported layout (tools/export_hud.py useHover): BottomCenterAnchor (side 7), panel 80 px up.
const layout={anchor:{side:7,relativeOffset:{x:0,y:0}},panel:{x:0,y:80}};
const bounds=w=>({minX:-w/2,maxX:w/2,minY:0,maxY:24});

test('RPOS.UseHoverTextMoveRevert: no point puts the label at the panel origin above the bottom centre', () => {
 assert.deepEqual(useHoverPosition({width:1280,height:720,layout,point:null,bounds:bounds(48)}),{x:640,y:80});
});

test('RPOS.UseHoverTextScreen keeps the label bounds on screen, with the original one-sided tests', () => {
 const at=(point,w=100)=>useHoverPosition({width:1280,height:720,layout,point,bounds:bounds(w)});
 assert.deepEqual(at({x:600,y:300}),{x:600,y:300});
 assert.deepEqual(at({x:10,y:300}),{x:50,y:300}); // left edge pushed in
 assert.deepEqual(at({x:1270,y:300}),{x:1230,y:300}); // right edge pulled in
 assert.deepEqual(at({x:600,y:-10}),{x:600,y:0}); // below the screen
 assert.deepEqual(at({x:600,y:710}),{x:600,y:696}); // above the screen
 // Wider than the screen: min.x < 0 but max.x >= width, so the original leaves it alone.
 assert.deepEqual(at({x:640,y:300},1400),{x:640,y:300});
});

test('printedWidth: UIFont advances scaled by label scale / font size', () => {
 const glyphs=new Map([[65,{advance:6}],[66,{advance:7}]]);
 assert.equal(printedWidth({size:12,spacingX:0,glyphs},'AB',24),26);
 assert.equal(printedWidth({size:12,spacingX:1,glyphs},'AB',24),28);
 assert.equal(printedWidth({size:12,spacingX:1,glyphs},'A?',24),12); // unknown glyphs print nothing
});

test('Contextual implementors and their ContextText', () => {
 assert.equal(contextKind({components:{MovingDoor:[{}]}}),'door');
 assert.equal(contextKind({components:{FireBarrel:[{}],LootableObject:[{}]}}),'fire');
 assert.equal(contextKind({components:{Furnace:[{}]}}),'fire');
 assert.equal(contextKind({components:{LootableObject:[{}]}}),'loot');
 assert.equal(contextKind({components:{SleepingBag:[{}]}}),'bag');
 assert.equal(contextKind({components:{Bed:[{}],TakeDamage:[{}]}}),null); // SingleBed has no Contextual
 assert.equal(contextKind({components:{StructureComponent:[{}]}}),null);
 assert.equal(lootContextText(null),'Search');assert.equal(lootContextText(3),'Occupied');assert.equal(lootContextText(3,'Ann'),'Occupied by Ann');
 assert.equal(fireContextText(0),'Use');assert.equal(fireContextText(5,'Bob'),'Occupied by Bob');
});

test('BasicDoor.ContextTextPoint: PointText doors at rest only, through the door transform', () => {
 const record={name:'d',parentMatrix:new THREE.Matrix4().toArray(),localPosition:{x:10,y:0,z:5},localRotation:{x:0,y:0,z:0,w:1},localScale:{x:1,y:1,z:1},
  settings:{startConfig:4,durationOpen:1,durationClose:1,textOpen:'Open',textClose:'Close',pointTextPointOpened:{x:0,y:0,z:0},pointTextPointClosed:{x:0,y:1.6,z:0},minimumTimeBetweenOpenClose:1,
   closedPositionPivot:{x:0,y:0,z:0},openMovement:{x:0,y:0,z:0},rotationAxis:{x:0,y:1,z:0},rotationCross:{x:1,y:0,z:0},degrees:90,rotationFirst:0,smooth:0,movementABS:0,rotationABS:0,slerpMovementByDegrees:0}};
 const door=new LegacyDoor(record,0);
 const p=doorTextPoint(door,THREE.Vector3);assert.ok(p);assert.deepEqual(p.toArray().map(v=>Math.round(v*1000)/1000),[10,1.6,-5]); // Unity z 5 -> browser -5
 door.state=0;assert.equal(doorTextPoint(door,THREE.Vector3),null); // opening: no point, label goes back to its origin
 const plain=new LegacyDoor({...record,settings:{...record.settings,startConfig:0}},1);assert.equal(doorTextPoint(plain,THREE.Vector3),null);
});

test('PointUtil.SpriteOrOrigin and LootableObject 0.15 m lift', () => {
 const group=new THREE.Group();group.position.set(1,2,3);const sprite=new THREE.Object3D();sprite.position.set(0,0.5,0);sprite.userData.contextSprite=true;group.add(sprite);
 assert.deepEqual(spriteTextPoint(group,THREE.Vector3).toArray(),[1,2.5,3]);
 assert.deepEqual(lootTextPoint(group,THREE.Vector3).toArray().map(v=>Math.round(v*100)/100),[1,2.65,3]);
 const bare=new THREE.Group();bare.position.set(4,5,6);
 assert.deepEqual(lootTextPoint(bare,THREE.Vector3).toArray(),[4,5,6]); // no sprite: origin, no lift
});
