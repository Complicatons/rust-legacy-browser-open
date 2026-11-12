import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createServer} from './serve.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
import {PerspectiveCamera} from 'three';
import {directionalAngle} from '../browser/combat-feedback.mjs';
const server=createServer();await listenServer(server);
let browser;
try {
 browser=await chromium.launch(launchOptions());
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],external=[];
 // Reproduce loot, wildlife and respawn choices without changing the game's random rules.
 await page.addInitScript(()=>{let state=0x517cc1b7;Math.random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:'))external.push(r.url());});
 await page.goto(`http://127.0.0.1:${server.address().port}/?dev&fresh`,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.explorerState?.frames>5,{},{timeout:60000});
 const initial=await page.evaluate(()=>window.explorerState);assert.ok(initial.triangles>500000);assert.ok(initial.visibleTrees>0);
 const graphics=await readGraphics(page);
 // Render Quality: a fresh profile starts at the original default level (mainData m_CurrentQuality 0, Fastest: no shadows,
 // quarter-resolution textures, no image effects); Good draws the sun shadow (one 100 m cascade) and the sun shafts.
 const qualityDefault=await page.evaluate(()=>window.explorerState.quality);
 assert.equal(qualityDefault.name,'Fastest');assert.equal(qualityDefault.shadows.type,'none');assert.equal(qualityDefault.shadows.enabled,false);assert.equal(qualityDefault.textureLimit,2);assert.equal(qualityDefault.post.active,false);
 const hour0=await page.evaluate(()=>window.explorerDev.tod()?.hour);await page.evaluate(()=>window.explorerDev.setTime(16));await page.evaluate(()=>window.explorerDev.setQuality(0.6));
 const qualityGood=await page.waitForFunction(()=>{const q=window.explorerState.quality;return q.shadows.enabled&&q.shadows.allocated===1&&q.shadows.renders>3&&q.post.frames>3&&q.warmups>0&&q;},{},{timeout:60000}).then(h=>h.jsonValue());
 assert.equal(qualityGood.name,'Good');assert.equal(qualityGood.shadows.type,'soft');assert.equal(qualityGood.shadows.cascades,1);assert.equal(qualityGood.shadows.distance,100);
 assert.ok(qualityGood.flags.casters>100&&qualityGood.flags.receivers>qualityGood.flags.casters,JSON.stringify(qualityGood.flags));assert.deepEqual(qualityGood.post.passes,['TOD_SunShafts']);
 await mkdir('analysis/browser-qa',{recursive:true});await page.screenshot({path:'analysis/browser-qa/quality-good-shadows.png'});
 // The rest of this check (sea reflection pass, etc.) was written against Good: keep it selected explicitly.
 if(hour0!=null)await page.evaluate(h=>window.explorerDev.setTime(h),hour0);
 const quality={default:{name:qualityDefault.name,shadows:qualityDefault.shadows.type},good:{shadows:qualityGood.shadows,flags:qualityGood.flags,passes:qualityGood.post.passes}};
 await page.keyboard.down('KeyW');await page.waitForTimeout(500);await page.keyboard.up('KeyW');
 const moved=await page.evaluate(()=>window.explorerState);assert.ok(Math.hypot(moved.position[0]-initial.position[0],moved.position[2]-initial.position[2])>1);
 await page.mouse.move(800,350);await page.mouse.down();await page.mouse.move(950,430,{steps:10});await page.mouse.up();
 await mkdir('analysis/browser-qa/feedback',{recursive:true});await page.screenshot({path:'analysis/browser-qa/fly.png'});
 // A click on the game captures the mouse; Escape releases it to reach the page controls, as a player would.
 if(await page.evaluate(()=>Boolean(document.pointerLockElement))){await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.pointerLockElement);}
 await page.locator('#mode').click();await page.waitForFunction(()=>window.explorerState.walk);
 await page.keyboard.down('KeyW');await page.waitForTimeout(500);await page.keyboard.up('KeyW');
 const walking=await page.evaluate(()=>window.explorerState);assert.ok(Math.abs(walking.position[1]-walking.player.feet[1]-walking.player.eye)<1e-6);assert.equal(walking.collisionShapes,421-63,`collision shapes: the scene export has 421 colliders, of which the 63 spawn-point marker cubes are left out (SpawnManager.InstallSpawns destroys them), so 358 are solid; got ${walking.collisionShapes}. A different count means a changed scene export (browser/assets/recovered/scene/manifest.json) or a collision.mjs change, not the test machine`);
 // Walking over a slope can leave the motor briefly airborne. Start a jump only after landing.
 await page.waitForFunction(()=>window.explorerState.player.grounded,{},{timeout:5000});const jumpStart=await page.evaluate(()=>window.explorerState.player.feet[1]);
 await page.keyboard.down('Space');await page.waitForFunction(y=>window.explorerState.player.feet[1]>y+0.1,jumpStart,{timeout:2000});await page.keyboard.up('Space');const jumping=await page.evaluate(()=>window.explorerState);assert.ok(jumping.player.feet[1]>jumpStart+0.1);
 await page.waitForTimeout(900);await page.keyboard.down('ControlLeft');await page.waitForFunction(()=>window.explorerState.player.height<1.4,{},{timeout:3000});const crouching=await page.evaluate(()=>window.explorerState);assert.ok(crouching.player.height<1.4);await page.keyboard.up('ControlLeft');await page.waitForTimeout(800);
 await page.screenshot({path:'analysis/browser-qa/walk.png'});
 // Original MovingDoors: aim with the recovered 3 m context probe and quick-tap E (under 300 ms).
 const doorCheck=async(prefix,shot)=>{const index=await page.evaluate(p=>window.explorerState.doors.findIndex(d=>d.name.startsWith(p)&&d.state===3),prefix);assert.ok(index>=0,prefix);
  await page.evaluate(i=>window.explorerDev.approachDoor(i),index);await page.waitForTimeout(300);
  const aimed=await page.evaluate(()=>window.explorerState);assert.equal(aimed.useTarget,index);assert.equal(aimed.useHint,'Open');
  // Every scene door has RunFlags.PointText: the label sits at pointTextPointClosed, not at the panel origin.
  assert.equal(aimed.useHover?.text,'Open',JSON.stringify(aimed.useHover));assert.equal(aimed.useHover.point,true);
  await page.screenshot({path:`analysis/browser-qa/${shot}-closed.png`});
  await page.keyboard.press('KeyE');await page.waitForFunction(i=>window.explorerState.doors[i].fraction!==0,index,{timeout:3000});const moving=await page.evaluate(i=>window.explorerState.doors[i],index);assert.notEqual(moving.fraction,0);
  await page.waitForFunction(i=>window.explorerState.doors[i].state===1,index,{timeout:8000});const opened=await page.evaluate(()=>window.explorerState);
  await page.screenshot({path:`analysis/browser-qa/${shot}-open.png`});return {index,aimed:aimed.useHint,opened:opened.doors[index]};};
 const garageDoor=await doorCheck('GarageDoor_AngleOpen','door-garage'),hingedDoor=await doorCheck('BlueDoor','door-hinged');
 // ContextSprite use-icon on a closed scene door: within 5 m and unblocked it fades in (to 1.2 in .18 s), dims to the 0.15
 // ghost while the door moves (BasicDoor busy -> SpriteFlag0), returns once it stops, and is not drawn past 5 m.
 const iconDoor=await page.evaluate(()=>{const d=window.explorerState.doors;const i=d.findIndex(x=>x.state===3&&x.name.startsWith('BlueDoor'));return i>=0?i:d.findIndex(x=>x.state===3);});assert.ok(iconDoor>=0);
 // (no eval in the page: the server's CSP forbids it) near: faded in; moving: opening and dimmed; open: stopped, left the dim; far: not drawn.
 const iconWait=(mode,timeout=4000)=>page.waitForFunction(([mode,i])=>{const s=window.explorerDev.contextSprites().find(s=>s.id==='door:'+i),d=window.explorerState.doors[i];
  const ok={near:s&&s.visible&&s.fade>=1.2,moving:s&&d.state===0&&Math.abs(s.fade-0.15)<1e-9,open:s&&d.state===1&&s.visible&&s.fade!==0.15,far:s&&!s.visible&&!s.drawn}[mode];return ok?s:null;},[mode,iconDoor],{timeout}).then(h=>h.jsonValue());
 await page.evaluate(i=>window.explorerDev.approachDoor(i),iconDoor);
 const doorIcon=await iconWait('near');
 assert.ok(doorIcon.drawn&&doorIcon.depth>0&&doorIcon.depth<5&&doorIcon.coverage>0.2,JSON.stringify(doorIcon));await page.screenshot({path:'analysis/browser-qa/tags-binds/door-use-icon.png'});
 await page.keyboard.press('KeyE');const movingIcon=await iconWait('moving',3000);
 await page.screenshot({path:'analysis/browser-qa/tags-binds/door-use-icon-moving.png'});
 await page.waitForFunction(i=>window.explorerState.doors[i].state===1,iconDoor,{timeout:8000});const openIcon=await iconWait('open');
 await page.evaluate(i=>window.explorerDev.approachDoor(i,6),iconDoor);
 const farIcon=await iconWait('far',3000);
 await page.screenshot({path:'analysis/browser-qa/tags-binds/door-use-icon-far.png'});const useIcon={door:iconDoor,near:doorIcon,moving:movingIcon,open:openIcon,far:farIcon};
 // Original loot: search a spawned crate with E, take an item into the bag, close, and verify the crate state.
 const crates=await page.evaluate(()=>window.explorerDev.crates());assert.ok(crates.length>=70&&crates.length<=80);
 const crateIndex=crates.findIndex(c=>c.name==='AmmoLootBox'&&c.items>0);assert.ok(crateIndex>=0);
 // Wandering wildlife can block the use ray (as in the original), so retry the approach a few times.
 for(let attempt=0;attempt<4;attempt++){await page.evaluate(i=>window.explorerDev.approachCrate(i),crateIndex);await page.waitForTimeout(700);await page.evaluate(i=>window.explorerDev.aimAtCrate(i),crateIndex);await page.waitForTimeout(150);if(await page.waitForFunction(()=>window.explorerState.useTargetKind==='crate',{},{timeout:1500}).then(()=>true,()=>false))break;}
 const atCrate=await page.evaluate(()=>window.explorerState);assert.equal(atCrate.useTargetKind,'crate');assert.equal(atCrate.useHint,'Search');
 await page.screenshot({path:'analysis/browser-qa/loot-crate.png'});
 await page.keyboard.press('KeyE');await page.waitForFunction(()=>window.explorerState.loot.looting);
 const lootBefore=await page.locator('#loot .item-slot > img').count(),packBefore=await page.locator('#pack .item-slot > img').count();assert.ok(lootBefore>0);
 await page.screenshot({path:'analysis/browser-qa/loot-window.png'});
 // Taken by dragging into an empty bag cell (RPOSInventoryCell.OnClick is empty: no click-to-take).
 {const from=page.locator('#loot .item-slot:has(> img)').first(),to=page.locator('#pack .item-slot:not(:has(> img))').first();await from.click();assert.equal(await page.locator('#loot .item-slot > img').count(),lootBefore,'a click takes nothing');
  const a=await from.boundingBox(),b=await to.boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:8});await page.mouse.up();}
 assert.equal(await page.locator('#loot .item-slot > img').count(),lootBefore-1);assert.ok(await page.locator('#pack .item-slot > img').count()>packBefore||await page.locator('#pack span').count()>0);
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.explorerState.loot.looting);
 const looted={crate:crates[crateIndex],taken:1,remaining:lootBefore-1};
 // Original gathering with the default Rock (belt slot 1): a GenericSpawner resource node, then a terrain tree. A fresh
 // character holds nothing (HeldItem.OnBeltUse is the only activation): key 1 takes the rock out, as a player would.
 if(await page.evaluate(()=>window.explorerDev.viewModel()?.name!=='VM-Rock')){await page.keyboard.press('Digit1');await page.waitForFunction(()=>window.explorerDev.viewModel()?.name==='VM-Rock',{},{timeout:10000});}
 await page.waitForFunction(()=>window.explorerDev.nodes().length>0,{},{timeout:60000});
 const nodes=await page.evaluate(()=>window.explorerDev.nodes()),nodeIndex=Math.max(0,nodes.findIndex(n=>n.name==='res_woodpile'));
 await page.evaluate(i=>window.explorerDev.approachNode(i),nodeIndex);await page.waitForTimeout(700);await page.evaluate(i=>window.explorerDev.aimAtNode(i),nodeIndex);
 const clickGame=async()=>{if(!await page.evaluate(()=>Boolean(document.pointerLockElement)))await page.locator('#world').click({position:{x:720,y:450}});await page.mouse.down();await page.mouse.up();};
 const swing=async()=>{await clickGame();await page.waitForTimeout(2000);return page.evaluate(()=>window.explorerState.resources);};
 // Frame timing in headless Edge can let the player settle off the node before mid-swing; re-approach like a player would.
 let nodeHit=await swing();for(let k=0;k<2&&nodeHit.lastSwing?.kind!=='resource';k++){await page.evaluate(i=>window.explorerDev.approachNode(i),nodeIndex);await page.waitForTimeout(600);nodeHit=await swing();}
 assert.equal(nodeHit.lastSwing?.kind,'resource',JSON.stringify(nodeHit));assert.match(nodeHit.notices.at(-1),/^[0-9]+ x (Wood|Sulfur Ore|Metal Ore|Stones)$/);
 await page.screenshot({path:'analysis/browser-qa/gather-node.png'});
 // ResourceObject.modelindex: a stage change plays the node's clientMeshChangeEffect (Ore_Death / WoodPile_Death) at once
 // and swaps the mesh 0.15 s later (DelayedModelChangeIndex).
 const stage=await page.evaluate(i=>window.explorerDev.depleteNodeStage(i),nodeIndex),stageNow=await page.evaluate(i=>window.explorerDev.nodes()[i],nodeIndex);
 assert.notEqual(stage.to,stage.from,'node changed model stage');assert.equal(stageNow.shownModel,stage.from,'old mesh stays for 0.15 s');
 const stageFx=await page.evaluate(()=>window.explorerState.resources.lastEffect);assert.equal(stageFx?.handle,';'+nodes[nodeIndex].name);assert.equal(stageFx.effect,JSON.parse(await readFile('browser/assets/recovered/deployables/manifest.json','utf8')).resourceEffects[stageFx.handle],JSON.stringify(stageFx));
 await page.waitForTimeout(120);await page.screenshot({path:'analysis/browser-qa/resource-stage-effect.png'});await page.waitForTimeout(300);
 assert.equal((await page.evaluate(i=>window.explorerDev.nodes()[i],nodeIndex)).shownModel,stage.to,'mesh swapped after 0.15 s');
 await page.evaluate(()=>window.explorerDev.approachTree());await page.waitForTimeout(300);
 const tree1=await swing(),tree2=await swing();assert.equal(tree1.lastSwing?.kind,'tree',JSON.stringify(tree1));assert.equal(tree2.lastSwing?.kind,'tree');assert.ok(tree2.notices.includes('1 x Wood'),JSON.stringify(tree2.notices));
 await page.screenshot({path:'analysis/browser-qa/gather-tree.png'});
 const gathered={node:{...nodes[nodeIndex],notice:nodeHit.notices.at(-1)},tree:tree2.notices.slice(-2)};
 // Original wildlife: kill a chicken with two Rock hits and harvest it; a wolf hunts and bites; death and respawn.
 const chicken=await page.evaluate(()=>window.explorerDev.spawnAnimal('chicken_prefab',1.6));
 // Rock mid-swing lands 1.25 s after the click; close the distance again just before it, as a player would.
 const hitAnimal=async()=>{await page.evaluate(i=>window.explorerDev.approachAnimal(i),chicken);await clickGame();await page.waitForTimeout(900);for(let k=0;k<9;k++){await page.evaluate(i=>window.explorerDev.approachAnimal(i),chicken);await page.waitForTimeout(120);}return page.evaluate(i=>window.explorerDev.animalAt(i),chicken);};
 let hen=await hitAnimal();for(let k=0;k<5&&!hen?.dead;k++)hen=await hitAnimal();assert.equal(hen?.dead,true,JSON.stringify(hen));
 // MeleeWeaponDataBlock.Local_MidSwing -> PlayHitNotification while the chicken is alive (TakeDamage.ShouldPlayHitNotification).
 const fb=()=>page.evaluate(()=>window.explorerDev.feedback()),fbHen=await fb();assert.ok(fbHen.loaded&&fbHen.hitsCreated>=1&&fbHen.hitSounds===fbHen.hitsCreated,JSON.stringify(fbHen));assert.equal(fbHen.lastHit.follow,true);
 // content/shared/sfx/hitnotification is fetched and decodes (PlayLocal on the camera).
 await page.waitForFunction(()=>window.explorerDev.audio().loaded.some(u=>/feedback\/sound-/.test(u)),{},{timeout:5000});assert.ok((await page.evaluate(()=>window.explorerDev.audioDecoded())).some(a=>/feedback\/sound-/.test(a.file)&&a.seconds>0&&a.channels>0),'hit notification decodes');
 const harvest=await hitAnimal(),harvestNotice=await page.evaluate(()=>window.explorerState.resources.notices.at(-1));assert.equal((await fb()).hitsCreated,fbHen.hitsCreated,'a dead animal plays no hit notification');assert.match(harvestNotice,/^1 x (Raw Chicken Breast|Cloth)$/);
 await page.screenshot({path:'analysis/browser-qa/wildlife-harvest.png'});
 // Earlier steps can leave damage/bleeding (roaming wildlife under slow GPU frames); the bite below must be measured exactly.
 {const v=await page.evaluate(()=>window.explorerState.vitals);if(v.health<100||v.bleeding>0)console.log('vitals before the wolf bite step',JSON.stringify({vitals:v,last:(await fb()).lastHealth}));await page.evaluate(()=>window.explorerDev.restoreVitals());await page.waitForTimeout(100);}
 // The gathering spot can sit in a hollow below the wildlife navmesh (a wolf spawned there climbs out of reach): bite on open, flat ground.
 await page.evaluate(()=>{const d=window.explorerDev;d.teleport([5211,369.6,4808]);d.clearHostiles(400);});await page.waitForTimeout(800);await page.evaluate(()=>window.explorerDev.restoreVitals());
 const healthBefore=await page.evaluate(()=>window.explorerState.vitals.health);await page.evaluate(()=>{const d=window.explorerDev,feet=window.explorerState.player.feet;let w=-1;for(let k=0;k<8;k++){if(k){const e=d.aim().eye,h=k*Math.PI/4;d.aimPoint([e[0]+Math.sin(h)*10,e[1],e[2]-Math.cos(h)*10]);}w=d.spawnAnimal('wolf_prefab',6);if(w>=0&&Math.abs(d.animalAt(w).position[1]-feet[1])<2)break;if(w>=0)d.clearHostiles(30);w=-1;}return w;}); // the wolf must land on the player's level: off the navmesh (-1) or up a slope it cannot climb, try other headings
 await page.waitForFunction(h=>window.explorerState.vitals.health<h,healthBefore,{timeout:20000});const bitten=await page.evaluate(()=>window.explorerState.vitals);assert.equal(healthBefore-bitten.health,15);
 // ClientHealthChange from a wildlife attacker: meleeBob and a HUDDirectionalDamage arc at the attacker's bearing.
 const angleOf=f=>{const cam=new PerspectiveCamera();cam.quaternion.fromArray(f.camera);cam.updateMatrixWorld();return directionalAngle(f.arcs.at(-1).direction,cam.matrixWorldInverse);};
 const bite=await fb();assert.equal(bite.lastHealth.attacker,'wildlife');assert.equal(bite.lastHealth.bob,'meleeBob');assert.ok(bite.arcsCreated>=1);
 const feedback={hitsOnChicken:fbHen.hitsCreated,bite:bite.lastHealth,arcs:{}};
 await page.evaluate(()=>window.explorerDev.hurtPlayer(500));await page.waitForFunction(()=>window.explorerState.vitals.dead);assert.equal(await page.locator('#death').isVisible(),true);
 await page.waitForFunction(()=>!window.explorerDev.feedback().overlay.drawn,{},{timeout:3000});
 await page.locator('#respawn').click();await page.waitForFunction(()=>!window.explorerState.vitals.dead);const respawned=await page.evaluate(()=>window.explorerState.vitals);assert.equal(respawned.health,100);await page.waitForFunction(()=>window.explorerDev.feedback().overlay.flags===0&&window.explorerDev.feedback().clientHealth===100,{},{timeout:3000});
 // Original Metabolism/HumanBodyTakeDamage: eat through the right-click item menu, bleed from a heavy hit, bandage.
 const food=await page.evaluate(()=>window.explorerDev.giveItem('Cooked Chicken Breast',1)),caloriesBefore=await page.evaluate(()=>window.explorerState.vitals.calories);
 await page.locator('#inventory-toggle').click();await page.locator(`#pack [data-slot="${food.slot}"]`).click({button:'right'});
 assert.equal(await page.locator('#item-menu button').textContent(),'Eat');await page.screenshot({path:'analysis/browser-qa/survival-eat-menu.png'});
 await page.locator('#item-menu button').click();await page.locator('#inventory-close').click();
 await page.waitForFunction(c=>window.explorerState.vitals.calories>c+400,caloriesBefore);const fed=await page.evaluate(()=>window.explorerState.vitals);assert.ok(fed.calories>=caloriesBefore+499-1e-6&&fed.calories<=Math.min(3000,caloriesBefore+500)+1e-6,JSON.stringify([caloriesBefore,fed.calories]));
 await page.evaluate(()=>window.explorerDev.hurtPlayer(30));// explorerState refreshes once per frame, so wait for the frame that reflects each action.
 await page.waitForFunction(()=>window.explorerState.vitals.bleeding>0);const hurt=await page.evaluate(()=>window.explorerState.vitals);assert.equal(hurt.bleeding,4.5);
 await page.waitForTimeout(300);assert.match(await page.locator('#vitals').textContent(),/Bleeding/);await page.screenshot({path:'analysis/browser-qa/survival-bleeding.png'});
 const bandage=await page.evaluate(()=>window.explorerDev.giveItem('Bandage',1)),used=await page.evaluate(i=>window.explorerDev.useSlot(i),bandage.slot);
 assert.deepEqual(used,{label:'Use',used:true});const usedEvent=(await fb()).itemEvent;assert.deepEqual([usedEvent.event,usedEvent.item],['Used','Bandage']);assert.ok(usedEvent.file);
 await page.waitForFunction(f=>window.explorerDev.audio().loaded.some(u=>u.endsWith(f)),usedEvent.file,{timeout:5000});feedback.used=usedEvent;await page.waitForFunction(()=>window.explorerState.vitals.bleeding===0,{},{timeout:3000});
 // Bearings clockwise from the view: front 90 deg (top), right 0, behind -90 (bottom), left 180.
 for(const [bearing,want,shot] of [[0,90,'front'],[90,0,'right'],[180,-90,'behind'],[270,180,'left']]){const n=(await fb()).arcsCreated;await page.evaluate(b=>window.explorerDev.hurtFrom(b,5),bearing);
  // Metabolism HurtSelf ticks also draw (zero-direction) arcs, as in the original; pick the wildlife one.
  const mine=f=>f.arcs.filter(a=>Math.hypot(...a.direction)>1&&a.age<0.6).at(-1);
  await page.waitForFunction(n=>window.explorerDev.feedback().arcsCreated>n&&window.explorerDev.feedback().arcs.some(a=>Math.hypot(...a.direction)>1&&a.age>0&&a.age<0.6),n,{timeout:3000});/* age>0: a frame has run HUDDirectionalDamage.Continue (angle set) */const f=await fb(),arc=mine(f),got=arc.angle;
  assert.ok(Math.abs(((got-want+540)%360)-180)<3,JSON.stringify({bearing,got,want}));assert.ok(Math.abs(got-angleOf({...f,arcs:[arc]}))<1,'angle follows the live camera');feedback.arcs[shot]=got;
  if(shot==='front'||shot==='right'){await page.waitForTimeout(200);await page.screenshot({path:`analysis/browser-qa/feedback/offline-directional-${shot}.png`});}
  await page.waitForTimeout(1700);}
 // LocalDamageDisplay: below 40 % health the damage_overlay_large pass pulses (alpha = (1 - hp - 0.6) * 2.5 * |sin(6t)|).
 await page.evaluate(()=>window.explorerDev.hurtFrom(0,25));await page.waitForFunction(()=>window.explorerDev.feedback().overlay.damage>0.25,{},{timeout:5000});const low=await fb();
 assert.ok(low.overlay.flags&1);assert.ok(Math.abs(low.overlay.damage-(1-low.overlay.lastHealthPercent-0.6)*2.5*low.overlay.pulse)<1e-6,JSON.stringify(low.overlay));assert.ok(low.overlayFrames>0);
 await page.screenshot({path:'analysis/browser-qa/feedback/offline-overlay-low.png'});feedback.overlay=low.overlay;
 // Damage without a network view (spikes, explosions, the dev hurt) draws no arc; healing (OnRepair) clears the overlay.
 {const n=(await fb()).arcsCreated;await page.evaluate(()=>window.explorerDev.hurtPlayer(1.5));await page.waitForTimeout(300);assert.equal((await fb()).arcsCreated,n);}
 await page.evaluate(()=>window.explorerDev.setHealth(100));await page.waitForFunction(()=>window.explorerDev.feedback().clientHealth===100&&!window.explorerDev.feedback().overlay.drawn,{},{timeout:5000});
 const survival={fed:fed.calories-caloriesBefore,bleeding:hurt.bleeding,bandaged:true,hud:await page.locator('#vitals').textContent()};
 const wildlife={feedback,survival,chicken:hen,harvest:harvestNotice,bite:healthBefore-bitten.health,respawned,population:await page.evaluate(()=>window.explorerState.wildlife)};
 // Original deployables: place a camp fire at the respawn point, fuel it, ignite it from the held-E menu and cook raw chicken.
 // The respawn point is random; some original spawns sit where a fire can't legally go (slope, rocks, structures),
 // so after three tries move to open ground near the warehouse compound that the startup check also builds on.
 let placedFire=null;for(let attempt=0;attempt<8&&!placedFire?.placed;attempt++){if(attempt===3)await page.evaluate(()=>window.explorerDev.teleport([5242.8,369,4837.5]));await page.waitForTimeout(attempt===3?700:0);
  await page.evaluate(()=>window.explorerDev.giveItem('Camp Fire',1));placedFire=await page.evaluate(()=>window.explorerDev.placeHeld('Camp Fire',2.5));if(!placedFire.placed)await page.evaluate(()=>window.explorerDev.walkAway(5));}
 assert.ok(placedFire.placed,JSON.stringify(placedFire));const fireIndex=(await page.evaluate(()=>window.explorerDev.deployables())).findIndex(o=>o.kind==='campfire');
 await page.evaluate(i=>{window.explorerDev.fillDeployed(i,6,'Wood',3);window.explorerDev.fillDeployed(i,3,'Raw Chicken Breast',2);},fireIndex);
 // Approach its actual mesh bounds; placement's maximum range can exceed the 3 m use ray.
 assert.equal(await page.evaluate(i=>window.explorerDev.approachDeployable(i),fireIndex),true);
 await page.waitForTimeout(700);await page.evaluate(i=>window.explorerDev.aimAtDeployable(i),fireIndex);
 await page.waitForFunction(()=>window.explorerState.useTargetKind==='deployable',{},{timeout:5000});assert.equal(await page.evaluate(()=>window.explorerState.useHint),'Use');
 // RPOS use-hover label: FireBarrel.ContextText "Use" drawn at the fire's ContextSprite (IContextRequestablePointText).
 {const hover=await page.evaluate(()=>window.explorerState.useHover);assert.equal(hover?.text,'Use',JSON.stringify(hover));assert.equal(hover.point,true,JSON.stringify(hover));assert.equal(hover.height,24);
  const box=await page.evaluate(()=>document.querySelector('#use-hover').getBoundingClientRect().toJSON());assert.ok(box.width>=hover.width&&box.height>=24&&box.top>100&&Math.abs(box.left+hover.width/2-hover.x)<1,JSON.stringify({box,hover}));
  await page.screenshot({path:'analysis/browser-qa/use-hover-campfire.png'});}
 // Original ContextUI: hold E, the ctxbutton menu shows while it is held, click the option, then release.
 await page.keyboard.down('KeyE');await page.waitForSelector('#context-ui:not([hidden]) .ctx-button[data-option="Ignite"]');await page.locator('#context-ui .ctx-button[data-option="Ignite"]').click();await page.keyboard.up('KeyE');
 assert.equal((await page.evaluate(()=>window.explorerDev.deployables()))[fireIndex].lit,true);await page.waitForTimeout(700);await page.screenshot({path:'analysis/browser-qa/deployables-campfire.png'});
// P3-17: the Campfire's LightStylist has no lights, so FireBarrel's flicker drives its light (initial 1 * Random.Range(.75,1.25), lerp dt*10).
{const fireFx=[];for(let i=0;i<8;i++){fireFx.push(await page.evaluate(()=>window.explorerDev.fxState()));await page.waitForTimeout(80);}
 const camp=fireFx.map(f=>f.fires.find(o=>o.name==='Campfire'&&o.on));assert.ok(camp.every(c=>c&&c.kind==='fireBarrel'&&c.intensity>0.2&&c.intensity<=1.25),JSON.stringify(camp));
 assert.ok(new Set(camp.map(c=>c.intensity.toFixed(4))).size>2,'campfire flicker varies');assert.ok(fireFx.at(-1).fireLights.some(v=>v>0));
 await page.evaluate(()=>window.explorerDev.setTime(22.5));await page.waitForTimeout(900);await mkdir('analysis/browser-qa/fx',{recursive:true});await page.screenshot({path:'analysis/browser-qa/fx/campfire-night.png'});
 await page.evaluate(()=>window.explorerDev.setTime(12));await page.waitForTimeout(300);await page.screenshot({path:'analysis/browser-qa/fx/campfire-day.png'});}
 await page.evaluate(()=>window.explorerDev.fastForwardFires(61));const cooked=(await page.evaluate(()=>window.explorerDev.deployables()))[fireIndex];
 assert.equal(cooked.slots[0]?.item,'Cooked Chicken Breast');assert.equal(cooked.slots[7]?.item,'Charcoal');
 const deployed={campfire:cooked.slots,placement:placedFire.placement.results};
 // Original building: foundation on terrain, corner pillars, wall, doorway, a door on its hardpoint and a ceiling; then open the door with E.
 const built=await page.evaluate(async()=>{const d=window.explorerDev,wait=ms=>new Promise(r=>setTimeout(r,ms));
  for(const [n,c] of [['Wood Foundation',2],['Wood Pillar',4],['Wood Wall',1],['Wood Doorway',1],['Wooden Door',1],['Wood Ceiling',1]])d.giveItem(n,c);
  // Build on fixed flat ground (0.54 m relief over 16 m, outside every original no-placement zone, clear of structures and
  // trees; found with tools/find-build-site.mjs) rather than at the random respawn point, which varies with frame-timed AI randomness.
  d.teleport([5688,316.5,5148]);await wait(900);
  let foundation=null;for(let i=0;i<6&&!foundation?.placed;i++){if(i)d.walkAway(12);await wait(300);const e=d.aim().eye;d.aimPoint([e[0],e[1]-2.2,e[2]-5]);foundation=d.placeAim('Wood Foundation');}
  if(!foundation.placed)return {foundation};await wait(400);const f=d.structures()[0].position,top=f[1]+4.02,cz=-f[2],out={foundation:foundation.placed};
  // The foundation faces the camera's yaw (straight down -Z in browser space), so its local axes are the world axes here.
  const put=async(name,p)=>{d.aimPoint(p);await wait(30);const r=d.placeAim(name);await wait(400);return r.placed;};
  out.pillars=[];for(const [dx,dz] of [[2.3,2.3],[-2.3,2.3],[2.3,-2.3],[-2.3,-2.3]])out.pillars.push(await put('Wood Pillar',[f[0]+dx,top,cz+dz]));
  out.wall=await put('Wood Wall',[f[0],top,cz-2.3]);out.doorway=await put('Wood Doorway',[f[0],top,cz+2.3]);out.door=await put('Wooden Door',[f[0]+1.6,top+1.3,cz+2.5]);
  // Stand inside near the doorway and look up past the pillar tops (ceiling range 4 m, 3.5 m drop, 4 m snap).
  d.teleport([f[0],top-0.02,cz+2.0]);await wait(700);out.ceiling=false;
  for(const dz of [-2.5,-2,-1.5,-1,-0.5]){const eye=d.aim().eye,dy=Math.sqrt(16-dz*dz);out.ceiling=await put('Wood Ceiling',[f[0],eye[1]+dy,eye[2]+dz]);if(out.ceiling)break;}
  out.ceilingPreview=d.placement();
  out.pieces=d.structures().map(c=>c.item);out.deployed=d.deployables().filter(o=>o.kind==='door').length;return out;});
 assert.ok(built.foundation&&built.pillars.every(Boolean)&&built.wall&&built.doorway&&built.door&&built.ceiling,JSON.stringify(built));
 const doorIndex=(await page.evaluate(()=>window.explorerDev.deployables())).findIndex(o=>o.kind==='door');
 // Stand outside the doorway; aim once landed (the terrain outside can sit below the foundation top).
 await page.evaluate(()=>{const s=window.explorerDev.structures()[0].position;window.explorerDev.teleport([s[0]+0.3,s[1]+4,-s[2]+4.6]);});await page.waitForTimeout(700);
 await page.evaluate(()=>{const s=window.explorerDev.structures()[0].position;window.explorerDev.aimPoint([s[0]+0.3,s[1]+5.3,-s[2]+2.5]);});
 await page.waitForFunction(()=>window.explorerState.useTargetKind==='deployable'&&window.explorerState.useHint==='Open',{},{timeout:6000});
 // Original LockEntry panel (lock-entry.mjs): Change Lock opens it as "New Password:"; DigitEntryRestrictions eats typed
 // letters; a short code raises LockEntry's own notice.popup and keeps the panel open; Return enters a good code.
 await mkdir('analysis/browser-qa/lock-flare',{recursive:true});const lockPanel='#lock-entry:not([hidden]) [data-df-name="LockEntry"]';
 await page.keyboard.down('KeyE');await page.waitForSelector('#context-ui:not([hidden]) .ctx-button[data-option="Change Lock"]');await page.locator('#context-ui .ctx-button[data-option="Change Lock"]').click();await page.keyboard.up('KeyE');await page.waitForSelector(lockPanel);assert.equal(await page.locator('#lock-label').textContent(),'New Password:');
 await page.locator('#lock-code').pressSequentially('1a2');assert.equal(await page.locator('#lock-code').inputValue(),'12');await page.locator('#lock-code').press('Enter');await page.waitForFunction(()=>window.explorerDev.popupNotices().includes('Password must be 4 digits.'),{},{timeout:5000});assert.ok(await page.locator(lockPanel).isVisible(),'a bad code keeps the panel open');
 await page.locator('#lock-code').fill('0012');await page.waitForTimeout(150);await page.screenshot({path:'analysis/browser-qa/lock-flare/lock-entry-change.png'});await page.locator('#lock-code').press('Enter');await page.waitForFunction(()=>window.explorerDev.popupNotices().includes('Password is now : 0012'),{},{timeout:5000});
 await page.waitForFunction(()=>document.querySelector('#lock-entry').hidden&&window.explorerState.useTargetKind==='deployable'&&window.explorerState.useHint==='Open');
 // Another owner's view of the locked door offers "Enter Code" ("Password:"). Escape (dfTextbox.OnCancel) only restores the text
 // it had when focused; Cancel closes without sending; Okay with the right code grants access (lockentry.passwordentry).
 const openEnterCode=async()=>{await page.keyboard.down('KeyE');await page.waitForSelector('#context-ui:not([hidden]) .ctx-button[data-option="Enter Code"]');await page.locator('#context-ui .ctx-button[data-option="Enter Code"]').click();await page.keyboard.up('KeyE');await page.waitForSelector(lockPanel);};
 await page.evaluate(i=>window.explorerDev.setDeployableOwner(i,'someone-else'),doorIndex);await openEnterCode();assert.equal(await page.locator('#lock-label').textContent(),'Password:');
 await page.locator('#lock-code').pressSequentially('99');await page.keyboard.press('Escape');assert.equal(await page.locator('#lock-code').inputValue(),'');assert.ok(await page.locator(lockPanel).isVisible(),'Escape keeps the panel open');
 await page.locator('#lock-entry [data-df-name="CancelButton"]').click();await page.waitForFunction(()=>document.querySelector('#lock-entry').hidden);
 await openEnterCode();await page.locator('#lock-code').fill('0012');await page.waitForTimeout(150);await page.screenshot({path:'analysis/browser-qa/lock-flare/lock-entry-enter.png'});await page.locator('#lock-entry [data-df-name="OkayButton"]').click();
 await page.waitForFunction(()=>window.explorerDev.popupNotices().includes('You can now access this door!')&&document.querySelector('#lock-entry').hidden,{},{timeout:5000});
 await page.evaluate(i=>window.explorerDev.setDeployableOwner(i,'local'),doorIndex);await page.waitForFunction(()=>window.explorerState.useTargetKind==='deployable'&&window.explorerState.useHint==='Open');
 await page.keyboard.press('KeyE');await page.waitForFunction(i=>window.explorerDev.doorAt(i)?.state===1,doorIndex,{timeout:3000});
 await page.evaluate(()=>{const s=window.explorerDev.structures()[0].position;window.explorerDev.flyTo([s[0]+8,s[1]+9,-s[2]+10],[s[0],s[1]+5,-s[2]]);});await page.waitForTimeout(800);await page.screenshot({path:'analysis/browser-qa/structures-hut.png'});
 deployed.building=built;
 // Original combat: an M4 against a wolf (bullet damage, recoil, clip), then two explosive charges breach the hut's wood wall.
 const combat=await page.evaluate(async()=>{const d=window.explorerDev,wait=ms=>new Promise(r=>setTimeout(r,ms)),out={};
  const s=d.structures()[0].position;d.teleport([s[0]+12,s[1]+4,-s[2]+12]);await wait(500);
  out.hitsBefore=d.feedback().hitsCreated;d.giveItem('M4',1);d.giveItem('556 Ammo',60);d.hold('M4');await wait(1600);let wolf=d.spawnAnimal('wolf_prefab',9);for(let k=1;k<8&&wolf<0;k++){const e=d.aim().eye,h=k*Math.PI/4;d.aimPoint([e[0]+Math.sin(h)*10,e[1],e[2]-Math.cos(h)*10]);wolf=d.spawnAnimal('wolf_prefab',9);} // no navmesh within 30 m of a spawn point drops the wolf (-1): try other headings
  // Navmesh sampling can put the wolf behind the hut or terrain. Approach its actual collider before firing.
  out.visibleApproach=d.approachAnimalForShot(wolf);await wait(400);
  for(let i=0;i<60&&!d.animalAt(wolf)?.dead;i++){d.aimAtAnimal(wolf);d.trigger(120);await wait(100);}
  out.wolf=d.animalAt(wolf);out.weapon=d.weapon();out.shot=d.combat().lastShot;out.feedback={hits:d.feedback().hitsCreated-out.hitsBefore,follow:d.feedback().lastHit?.follow,headshots:d.feedback().localHeadshots};
  // Charges on the far wall (placeRange 2 m); stand clear of the 3 m blast before each fuse ends.
  d.giveItem('Explosive Charge',2);const wallIndex=d.structures().findIndex(c=>c.item==='WoodWall'),wall=()=>d.structures().find(c=>c.item==='WoodWall');out.wallBefore=wall()?.health;
  for(let n=0;n<2;n++){d.teleport([s[0],s[1]+4.02,-s[2]-1.0]);await wait(400);d.aimPoint([s[0]+0.4*n,s[1]+5.4,-s[2]-2.5]);await wait(50);out['charge'+n]=d.placeAim('Explosive Charge');
   d.teleport([s[0]+12,s[1]+4,-s[2]+12]);await wait(5600);out['wallAfter'+n]=wall()?.health??0;}
  out.explosion=d.combat().lastExplosion;out.health=window.explorerState.vitals.health;return out;});
 assert.ok(combat.wolf.dead||combat.wolf.health<125,JSON.stringify(combat));assert.ok(combat.feedback.hits>=1&&combat.feedback.follow===true&&combat.feedback.headshots===0,JSON.stringify(combat.feedback));assert.ok(combat.weapon.clip<24);
 assert.ok(combat.charge0.placed&&combat.charge1.placed,JSON.stringify(combat));assert.equal(combat.wallAfter0,400);assert.equal(combat.wallAfter1,0);
 await page.evaluate(()=>{const s=window.explorerDev.structures()[0].position;window.explorerDev.flyTo([s[0]+2,s[1]+8,-s[2]-9],[s[0],s[1]+5,-s[2]]);});await page.waitForTimeout(800);await page.screenshot({path:'analysis/browser-qa/combat-breached-wall.png'});
 deployed.combat=combat;
 // HandCannon (StrikeGunDataBlock): a short press strikes and cancels with no shot; holding past the strike fires 12 pellets.
 const handCannon=await page.evaluate(async()=>{const d=window.explorerDev,wait=ms=>new Promise(r=>setTimeout(r,ms)),out={};
  const s=d.structures()[0].position;d.teleport([s[0]+12,s[1]+4,-s[2]+12]);await wait(500); // walk mode again after the fly-mode capture
  out.give=d.giveItem('HandCannon',1);d.giveItem('Handmade Shell',3);out.held=d.hold('HandCannon');await wait(1200);for(let i=0;i<40&&!d.viewModel();i++)await wait(250); /* viewmodel assets can load slower than 1.2 s on a busy machine */out.vm=d.viewModel()?.name;out.before=d.weapon();out.state={walk:window.explorerState.walk,dead:window.explorerState.vitals.dead,vm:d.viewModel()};
  const shotAt=d.combat().lastShot?.time??null;d.trigger(60);await wait(400);out.cancel=d.strike();out.afterCancel=d.weapon();out.cancelShot=(d.combat().lastShot?.time??null)!==shotAt;
  await wait(1100);d.trigger(2700);await wait(150);out.strike=d.strike();out.clip=d.viewModel()?.clip;await wait(2800);out.fired=d.weapon();out.shot=d.combat().lastShot;
  await wait(1100);d.reload(100);await wait(300);out.reloaded=d.weapon();d.takeItem('HandCannon');d.takeItem('Handmade Shell');return out;}); // reload waits for fireRate (canReload); later belt counts exclude these
 assert.equal(handCannon.vm,'VM-HandCannon',JSON.stringify(handCannon));assert.equal(handCannon.before.clip,1);assert.equal(handCannon.cancel?.cancelled,true,JSON.stringify(handCannon));assert.equal(handCannon.afterCancel.clip,1);assert.equal(handCannon.cancelShot,false);
 assert.ok(handCannon.strike?.strikes>=1&&handCannon.strike.strikes<=3,JSON.stringify(handCannon));assert.ok(/^strike[123]$/.test(handCannon.clip),handCannon.clip);assert.equal(handCannon.fired.clip,0);assert.ok(handCannon.shot.time>handCannon.strike.time);assert.equal(handCannon.reloaded.clip,1);
 deployed.handCannon=handCannon;
 // Original time of day: night cold, fire warmth, radiation exposure and worn protection.
 const environment=await page.evaluate(async()=>{const d=window.explorerDev,wait=ms=>new Promise(r=>setTimeout(r,ms)),out={};
  const s=d.structures()[0]?.position;if(s)d.teleport([s[0]+30,s[1]+4,-s[2]+30]);out.noon=d.setTime(12);out.night=d.setTime(22.5);await wait(2600);out.cold=d.tod();
  const fire=d.deployables().find(o=>o.kind==='campfire'&&o.lit),p=fire.position;d.teleport([p[0]+0.6,p[1]+0.2,-p[2]]);await wait(2600);out.warm=d.tod();
  const z=d.zones().sort((a,b)=>b.exposurePerMin-a.exposurePerMin)[0];d.teleport([z.position[0],z.position[1]+2,-z.position[2]]);await wait(1500);out.rads=d.tod().rads;out.exposure=d.radiationAt(z.position);
  d.giveItem('Rad Suit Helmet',1);out.equipped=d.equip('Rad Suit Helmet',36);await wait(300);out.equipEvent=d.feedback().itemEvent;out.armoredExposure=d.radiationAt(z.position);out.armor=d.combat().armor[4];
  d.flyTo([s[0]+2,s[1]+8,-s[2]-9],[s[0],s[1]+5,-s[2]]);await wait(3000);out.pausedRads=d.tod().rads;
  d.teleport([z.position[0],z.position[1]+2,-z.position[2]]);await wait(300);out.resumedRads=d.tod().rads;return out;});
 assert.equal(environment.night.night,true);assert.equal(environment.cold.core,-1);assert.equal(environment.warm.core,1);assert.ok(environment.rads>0,JSON.stringify(environment));
 assert.equal(environment.equipped,true);assert.deepEqual([environment.equipEvent.event,environment.equipEvent.item],['Equipped','Rad Suit Helmet']);assert.ok(environment.equipEvent.file);assert.ok(environment.armoredExposure<environment.exposure);assert.ok(Math.abs(environment.armoredExposure/environment.exposure-(1-environment.armor/200))<1e-6);
 assert.ok(environment.resumedRads-environment.pausedRads<environment.armoredExposure*0.6/60+1,JSON.stringify(environment));
 await page.evaluate(()=>{const d=window.explorerDev,s=d.structures()[0].position;d.flyTo([s[0]+8,s[1]+9,-s[2]+10],[s[0],s[1]+5,-s[2]]);});
 await page.waitForTimeout(300);await page.screenshot({path:'analysis/browser-qa/night.png'});const nightSky=await page.evaluate(()=>({sky:window.explorerDev.sky(),sea:window.explorerDev.sea()}));
 await page.evaluate(()=>window.explorerDev.setTime(12));await page.waitForTimeout(300);await page.screenshot({path:'analysis/browser-qa/day.png'});const daySky=await page.evaluate(()=>({sky:window.explorerDev.sky(),sea:window.explorerDev.sea()}));
 // Original TOD_Sky dome and FX/Water4 sea (sky.mjs / water4.mjs): renderer switches, TOD fog colour and RenderSettings range,
 // WaterColor-driven sea colours and the half-resolution PlanarReflection pass (sky only with water.reflection off).
 assert.ok(daySky.sky&&daySky.sea,'original sky/sea loaded');assert.ok(daySky.sky.sunVisible&&!daySky.sky.spaceVisible&&nightSky.sky.spaceVisible&&nightSky.sky.moonVisible,JSON.stringify({daySky,nightSky}));
 assert.deepEqual([daySky.sky.fogSettings.start,daySky.sky.fogSettings.end,Math.round(daySky.sky.radius)],[0,4000,5700]);
 assert.ok(daySky.sky.fog.slice(0,3).reduce((a,b)=>a+b)>5*nightSky.sky.fog.slice(0,3).reduce((a,b)=>a+b),JSON.stringify([daySky.sky.fog,nightSky.sky.fog]));
 assert.equal(daySky.sea.reflections,false);assert.ok(daySky.sea.rendered>nightSky.sea.rendered&&daySky.sea.reflectionSize[0]>0);assert.equal(daySky.sea.baseColor[3],0.75);assert.ok(daySky.sea.baseColor[2]>nightSky.sea.baseColor[2]);
 deployed.environment={...environment,daySky,nightSky};
 // Original airdrop, offline (the page runs the server half; last, so its smoke/RNG use cannot change the scenarios above): throw a Supply Signal; SignalGrenade.OnDone calls the C130 75 m
 // above it; the plane flies 5 km to the drop point, drops 1-3 SupplyCrates whose parachutes open; they land, then loot one.
 // airdropAdvance fast-forwards the offline server (presentation follows); the descent itself is also watched in real time.
 await mkdir('analysis/browser-qa/airdrop',{recursive:true});
 // Roaming bears/wolves near the warehouse can kill the player during the walk-mode steps (a dead player cannot loot),
 // so hostile wildlife around each walk-mode position is removed first.
 await page.evaluate(()=>{window.explorerDev.teleport([5242.8,369,4837.5]);window.explorerDev.clearHostiles();});await page.waitForTimeout(800);
 const airdrop={};airdrop.throw=await page.evaluate(async()=>{const d=window.explorerDev,wait=ms=>new Promise(r=>setTimeout(r,ms));d.giveItem('Supply Signal',1);d.hold('Supply Signal');await wait(1500);
  const e=d.aim().eye;d.aimPoint([e[0],e[1]+1,e[2]-8]);d.trigger(1600);await wait(2000);return {grenades:d.combat().grenades};});assert.equal(airdrop.throw.grenades,1,'Supply Signal thrown');
 await page.waitForFunction(()=>window.explorerDev.airdrops().offline?.planes.length===1,{},{timeout:8000});
 airdrop.signal=await page.evaluate(()=>window.explorerDev.combat().lastExplosion);const at=airdrop.signal.at,call=airdrop.signal.signal;
 assert.equal(call.target[1],at[1]+75);assert.ok(Math.abs(call.target[0]-at[0])<=20&&Math.abs(call.target[2]-at[2])<=20);assert.equal(call.dropTarget[1],call.target[1]+300);
 assert.ok(Math.abs(Math.hypot(call.start[0]-call.target[0],call.start[2]-call.target[2])-5000)<1e-3,'C130 starts 20 * maxSpeed away');
 await page.evaluate(p=>window.explorerDev.aimPoint([p[0],p[1]+1.5,-p[2]]),at);await page.waitForTimeout(1500);await page.screenshot({path:'analysis/browser-qa/airdrop/offline-signal-smoke.png'});
 await page.evaluate(()=>{window.explorerDev.walkAway(-70);window.explorerDev.clearHostiles();});await page.waitForTimeout(500); // KillZone: stay clear of the landing crates
 airdrop.plane=await page.evaluate(async()=>{const d=window.explorerDev,wait=ms=>new Promise(r=>setTimeout(r,ms)),tgt=d.combat().lastExplosion.signal.dropTarget;
  for(let i=0;i<80;i++){const p=d.airdrops().offline.planes[0];if(!p||p.dropped||Math.hypot(p.position[0]-tgt[0],p.position[2]-tgt[2])<450)break;d.airdropAdvance(0.5);}
  await wait(600);const a=d.airdrops().actors.find(a=>a.kind==='plane');d.aimPoint([a.position[0],a.position[1],-a.position[2]]);await wait(300);const r=d.airdrops().render.views.find(v=>v.kind==='plane');return {actor:d.airdrops().actors.find(a=>a.kind==='plane'),view:r};});
 assert.ok(airdrop.plane.actor&&airdrop.plane.view&&airdrop.plane.actor.samples>10&&airdrop.plane.actor.propAngle>0,JSON.stringify(airdrop.plane));assert.ok(Math.abs(airdrop.plane.actor.position[1]-call.dropTarget[1])<20,'flies at the drop height');
 assert.ok(airdrop.plane.view.pitch>1&&airdrop.plane.view.pitch<=1.75&&airdrop.plane.view.volume>0,'NetDoppler pitch and custom rolloff '+JSON.stringify(airdrop.plane.view));
 await page.screenshot({path:'analysis/browser-qa/airdrop/offline-plane.png'});
 airdrop.descent=await page.evaluate(async()=>{const d=window.explorerDev,wait=ms=>new Promise(r=>setTimeout(r,ms));for(let i=0;i<20&&!d.airdrops().offline.crates.length;i++)d.airdropAdvance(0.5);
  const c=d.airdrops().offline.crates[0],out={crates:d.airdrops().offline.crates.length,dropY:c.position[1],items:c.items};for(let i=0;i<400&&d.airdrops().offline.crates[0].position[1]-d.aim().eye[1]>40;i++)d.airdropAdvance(1);
  await wait(500);const a=d.airdrops().actors.find(a=>a.id===c.id),cb=[a.position[0],a.position[1]+2,-a.position[2]];d.flyTo([cb[0]+9,cb[1]-3,cb[2]+9],cb);await wait(200);out.y0=d.airdrops().actors.find(a=>a.id===c.id).position[1];
  await wait(1500);const a1=d.airdrops().actors.find(a=>a.id===c.id);out.y1=a1.position[1];out.chuteScale=a1.chuteScale;out.chute=d.airdrops().render.views.find(v=>v.id===c.id).chuteVisible;
  d.flyTo([a1.position[0]+9,a1.position[1]-1,-a1.position[2]+9],[a1.position[0],a1.position[1]+3,-a1.position[2]]);await wait(150);out.id=c.id;return out;});
 assert.ok(airdrop.descent.crates>=1&&airdrop.descent.crates<=3&&airdrop.descent.items>0,JSON.stringify(airdrop.descent));assert.ok(airdrop.descent.y1<airdrop.descent.y0-2,'crate descends in real time: '+JSON.stringify(airdrop.descent));
 assert.equal(airdrop.descent.chuteScale,1);assert.equal(airdrop.descent.chute,true);
 await page.screenshot({path:'analysis/browser-qa/airdrop/offline-descent.png'});
 airdrop.landed=await page.evaluate(async id=>{const d=window.explorerDev,wait=ms=>new Promise(r=>setTimeout(r,ms));for(let i=0;i<120&&!d.airdrops().offline.crates.find(c=>c.id===id)?.landed;i++)d.airdropAdvance(1);
  await wait(450);const r=d.airdrops().render,v=r.views.find(v=>v.id===id),cc=v.center;d.flyTo([cc[0]+5,cc[1]+2.5,cc[2]+6],cc);await wait(400);
  return {crate:d.airdrops().offline.crates.find(c=>c.id===id),actor:d.airdrops().actors.find(a=>a.id===id),chute:v.chuteVisible,particles:r.particles,effects:r.effects,planes:d.airdrops().offline.planes.length};},airdrop.descent.id);
 assert.equal(airdrop.landed.crate.landed,true);assert.equal(airdrop.landed.actor.landed,true);assert.equal(airdrop.landed.chute,false,'parachute removed on LAND');assert.ok(airdrop.landed.effects>0,'SupplyImpactSmoke landedEffect');
 assert.equal(airdrop.landed.planes,0,'C130 destroyed 20 s after the drop');
 await page.screenshot({path:'analysis/browser-qa/airdrop/offline-landed.png'});
 airdrop.approach=await page.evaluate(id=>{const r=window.explorerDev.approachAirdrop(id);window.explorerDev.clearHostiles();return r;},airdrop.descent.id);await page.waitForTimeout(500);
 await page.waitForFunction(()=>window.explorerState.useTargetKind==='crate'&&window.explorerState.useHint==='Search',{},{timeout:5000});
 // Under GPU load a tap can fall between frames; press again like a player would.
 for(let k=0;k<3;k++){await page.keyboard.press('KeyE');if(await page.waitForFunction(()=>window.explorerState.loot.looting,{},{timeout:3000}).then(()=>true,()=>false))break;}{const st=await page.evaluate(()=>({looting:window.explorerState.loot.looting,dead:window.explorerState.vitals.dead,kind:window.explorerState.useTargetKind}));assert.equal(st.looting,true,'airdrop crate loot window '+JSON.stringify(st));}
 const airLoot=await page.locator('#loot .item-slot > img').count();assert.equal(airLoot,airdrop.landed.crate.items,'SupplyDropSpawnListMaster loot');await page.screenshot({path:'analysis/browser-qa/airdrop/offline-loot.png'});
 const owned=await page.evaluate(()=>[...document.querySelectorAll('#pack .item-slot > img,#belt .item-slot > img')].map(i=>i.alt)),lootNames=await page.locator('#loot .item-slot > img').evaluateAll(l=>l.map(i=>i.alt));
 const pick=Math.max(0,lootNames.findIndex(n=>!owned.includes(n)));
 {const a=await page.locator('#loot .item-slot:has(> img)').nth(pick).boundingBox(),b=await page.locator('#pack .item-slot:not(:has(> img))').first().boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:8});await page.mouse.up();} // drag only
 assert.equal(await page.locator('#loot .item-slot > img').count(),airLoot-1);airdrop.taken=lootNames[pick];
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.explorerState.loot.looting);
 await page.evaluate(n=>{const d=window.explorerDev;d.airdropClear();if(n)d.takeItem(n);d.hold('Rock');},owned.includes(airdrop.taken)?null:airdrop.taken); // leave the inventory as the final checks expect
 // Raiding (after the airdrop, so its extra minutes and random draws cannot change the wildlife/airdrop scenarios above).
 // Raiding, exact per source (take-damage.mjs, combat.mjs ExplosionHelper/TimedGrenade/TimedExplosive, deployables.mjs OnKilled,
 // structures.mjs DelayedKill + weight links): an F1 grenade inside the hut beside the doorway, an Explosive Charge on the wooden
 // door, charges on the doorway frame, a rebuilt doorway whose Metal Door takes two charges, then TakeDamage.Kill of a pillar under
 // the ceiling. Every blast is checked surface by surface: (1 - Clamp01(dist/r)) * damage, x0.1 when blocked, the carrier at full
 // damage, and each piece's armour (pillars/foundations/ceilings 200 = immune; walls, doorways and doors 0 = full).
 await mkdir('analysis/browser-qa/raid',{recursive:true});
 const raidShot=async(name,from,to)=>{await page.evaluate(([f,t])=>window.explorerDev.flyTo(f,t),[from,to]);await page.waitForTimeout(900);await page.screenshot({path:`analysis/browser-qa/raid/${name}.png`});};
 const EXPLOSION_ARMOR={WoodPillar:200,WoodFoundation:200,WoodCeiling:200,WoodDoorFrame:0,WoodWall:0,WoodenDoor:0,MetalDoor:0};
 const checkBlast=(x,label)=>{assert.ok(x&&x.hits.length,label+': no blast');for(const h of x.hits){if(h.id==='player')continue;
  if(h.carrier)assert.equal(h.damage,x.damage,label+': carrier takes the full damage');
  else{const dist=Math.hypot(h.center[0]-x.at[0],h.center[1]-x.at[1],h.center[2]-x.at[2]);assert.ok(Math.abs(dist-h.distance)<1e-6,label+' distance '+h.id);
   assert.ok(Math.abs(h.damage-(1-Math.min(1,dist/x.radius))*x.damage*(h.blocked?0.1:1))<1e-6,label+' falloff '+h.id+' '+JSON.stringify(h));}
  const armor=EXPLOSION_ARMOR[h.id];if(armor===undefined||h.healthBefore==null)continue;const want=h.healthBefore-h.damage*Math.min(1,Math.max(0,1-armor/200));
  if(want<=0)assert.ok(h.destroyed||h.healthAfter===0,label+': killed '+h.id);else assert.ok(Math.abs(h.healthAfter-want)<1e-6,label+' health '+h.id+' '+JSON.stringify(h));}};
 const raid={};await page.evaluate(()=>window.explorerDev.setHealth(100));
 raid.grenade=await page.evaluate(async()=>{const d=window.explorerDev,wait=ms=>new Promise(r=>setTimeout(r,ms)),s=d.structures()[0].position,top=s[1]+4;
  d.teleport([s[0]+12,s[1]+4,-s[2]+12]);await wait(500);const n=d.raid().explosions.length,before=d.structures();
  d.spawnGrenade([s[0]+0.6,top+0.4,-s[2]+1.2]); // TimedGrenade: 3 s fuse, blast 0.3 m above the body
  for(let i=0;i<80&&d.raid().explosions.length===n;i++)await wait(100);
  return {blast:d.raid().explosions.at(-1),before,after:d.structures(),door:d.deployables().find(o=>o.item==='Wooden Door')};});
 checkBlast(raid.grenade.blast,'F1 grenade');assert.equal(raid.grenade.blast.radius,6);assert.equal(raid.grenade.blast.damage,120);
 {const dw=raid.grenade.blast.hits.find(h=>h.id==='WoodDoorFrame');assert.ok(dw&&dw.damage>0,'grenade reaches the doorway: '+JSON.stringify(raid.grenade.blast.hits));
  const doorway=raid.grenade.after.find(c=>c.item==='WoodDoorFrame');assert.ok(Math.abs(doorway.health-(1000-dw.damage))<1e-6);
  assert.ok(Math.abs(doorway.dimmer-(0.35+(doorway.dimmerAverage-0.35)*doorway.health/1000))<1e-6,'HealthDimmer structure grey');
  for(const c of raid.grenade.after.filter(c=>['WoodPillar','WoodFoundation','WoodCeiling'].includes(c.item)))assert.equal(c.health,c.maxHealth,c.item+' immune to explosions');
  const doorHit=raid.grenade.blast.hits.find(h=>h.id==='WoodenDoor');if(doorHit)assert.ok(Math.abs(raid.grenade.door.health-(500-doorHit.damage))<1e-6);}
 {const dw=raid.grenade.after.find(c=>c.item==='WoodDoorFrame').center;await raidShot('grenade-doorway',[dw[0]-3,dw[1]+1,dw[2]-4.5],dw);}
 // An Explosive Charge on the closed wooden door: the door is its TransCarrier and takes the full 600 (500 hp: killed ->
 // Client_OnKilled debris effect + WoodDoor_Corpse for 300 s); the doorway behind takes the falloff.
 const plant=async(target,aim)=>page.evaluate(async([target,aim])=>{const d=window.explorerDev,wait=ms=>new Promise(r=>setTimeout(r,ms)),s=d.structures()[0].position,top=s[1]+4.02;
  d.teleport([aim[0]-(aim[0]-s[0])*0.15,top,target[2]-1.1]);await wait(500);d.aimPoint(aim);await wait(60);const r=d.placeAim('Explosive Charge'),charge=d.deployables().at(-1);
  const n=d.raid().explosions.length;d.teleport([s[0]+12,s[1]+4,-s[2]+12]);for(let i=0;i<90&&d.raid().explosions.length===n;i++)await wait(100);await wait(200);
  return {placed:r?.placed,placement:r?.placement,carrier:charge?.item==='Explosive Charge'?charge.carrier:null,blast:d.raid().explosions.at(-1),structures:d.structures(),deployables:d.deployables(),raid:d.raid()};},[target,aim]);
 raid.doorCharge=await page.evaluate(async()=>{const d=window.explorerDev,wait=ms=>new Promise(r=>setTimeout(r,ms)),i=d.deployables().findIndex(o=>o.item==='Wooden Door');d.giveItem('Explosive Charge',5);
  if(d.doorAt(i).state===1){d.useDeployed(i);for(let k=0;k<30&&d.doorAt(i).fraction!==0;k++)await wait(100);}await wait(200);return {door:d.doorAt(i),center:d.deployables()[i].center};});
 assert.equal(raid.doorCharge.door.fraction,0,'door closed');
 Object.assign(raid.doorCharge,await plant(raid.doorCharge.center,raid.doorCharge.center));
 assert.ok(raid.doorCharge.placed,JSON.stringify(raid.doorCharge));assert.equal(raid.doorCharge.carrier,'WoodenDoor');checkBlast(raid.doorCharge.blast,'charge on door');
 assert.equal(raid.doorCharge.blast.hits.find(h=>h.carrier).id,'WoodenDoor');assert.ok(!raid.doorCharge.deployables.some(o=>o.item==='Wooden Door'),'wooden door destroyed');
 {const k=raid.doorCharge.raid.killed.find(x=>x.name==='WoodenDoor');assert.ok(k?.deathEffect,'Client_OnKilled effect');assert.ok(raid.doorCharge.raid.corpses.some(c=>c.name==='WoodDoor_Corpse'&&c.body),'WoodDoor_Corpse');}
 assert.ok(raid.doorCharge.blast.hits.find(h=>h.id==='WoodDoorFrame')?.damage>0,'the doorway takes the falloff');
 {const dw=raid.doorCharge.structures.find(c=>c.item==='WoodDoorFrame')?.center??raid.doorCharge.center;await raidShot('door-destroyed-corpse',[dw[0]+2.5,dw[1]+0.5,dw[2]+4],[dw[0],dw[1]-1,dw[2]]);}
 // Charges on the doorway frame (carrier = WoodDoorFrame, 1000 hp, explosion armour 0) until it falls; nothing else falls.
 raid.frame=[];for(let n=0;n<2&&(await page.evaluate(()=>window.explorerDev.structures().some(c=>c.item==='WoodDoorFrame')));n++){
  const c=await page.evaluate(()=>window.explorerDev.structures().find(c=>c.item==='WoodDoorFrame').center);const r=await plant(c,[c[0]+1.55,c[1]-0.6,c[2]]);
  assert.ok(r.placed,JSON.stringify(r));assert.equal(r.carrier,'WoodDoorFrame');checkBlast(r.blast,'charge on doorway');raid.frame.push(r);}
 {const last=raid.frame.at(-1);assert.ok(!last.structures.some(c=>c.item==='WoodDoorFrame'),'doorway destroyed');const k=last.raid.killed.find(x=>x.name==='WoodDoorFrame');assert.ok(k?.deathEffect,'ClientKilled wood_wall_debris');
  assert.deepEqual(last.structures.filter(c=>c.item==='WoodPillar').length,4);assert.ok(last.structures.some(c=>c.item==='WoodCeiling'&&c.health===c.maxHealth),'the ceiling stays');assert.equal(last.raid.masters,1);
  const s=last.structures[0].position;await raidShot('doorway-destroyed',[s[0]+1,s[1]+6.5,-s[2]+9],[s[0],s[1]+5,-s[2]+2.5]);}
 // Rebuilt doorway + Metal Door (1000 hp): two charges, 600 then dead -> MetalDoor_Corpse, no client death effect (none on the prefab).
 raid.metal=await page.evaluate(async()=>{const d=window.explorerDev,wait=ms=>new Promise(r=>setTimeout(r,ms)),s=d.structures()[0].position,top=s[1]+4.02,cz=-s[2],out={};
  d.giveItem('Wood Doorway',1);d.giveItem('Metal Door',1);d.teleport([s[0],top,cz-0.5]);await wait(600);
  const put=async(name,p)=>{d.aimPoint(p);await wait(40);const r=d.placeAim(name);await wait(400);return r?.placed;};
  out.doorway=await put('Wood Doorway',[s[0],top,cz+2.3]);out.door=await put('Metal Door',[s[0]+1.6,top+1.3,cz+2.5]);
  const m=d.deployables().find(o=>o.item==='Metal Door');out.center=m?.center;out.carrier=m?.carrier;return out;});
 assert.ok(raid.metal.doorway&&raid.metal.door,JSON.stringify(raid.metal));assert.equal(raid.metal.carrier,'WoodDoorFrame');
 raid.metal.charges=[];for(let n=0;n<2;n++){const r=await plant(raid.metal.center,raid.metal.center);assert.ok(r.placed,JSON.stringify(r));assert.equal(r.carrier,'MetalDoor');checkBlast(r.blast,'charge on metal door '+n);raid.metal.charges.push(r);}
 {const [a,b]=raid.metal.charges;assert.equal(a.deployables.find(o=>o.item==='Metal Door')?.health,400,'first charge: 1000 -> 400');
  assert.ok(!b.deployables.some(o=>o.item==='Metal Door'),'second charge kills the metal door');const k=b.raid.killed.find(x=>x.name==='MetalDoor');assert.ok(k);assert.equal(k.deathEffect,null);
  assert.ok(b.raid.corpses.some(c=>c.name==='MetalDoor_Corpse'),'MetalDoor_Corpse even when the same blast kills its doorway (DelayedKill)');
  const c=raid.metal.center;await raidShot('metal-door-destroyed',[c[0]+2.5,c[1]+0.8,c[2]+4],[c[0],c[1]-0.8,c[2]]);}
 // TakeDamage.Kill of a pillar under the ceiling: StructureMaster has no support check, so nothing else falls; the ceiling only loses
 // that weight link (decay then treats the remaining pillars as still carrying it).
 raid.collapse=await page.evaluate(()=>{const d=window.explorerDev,before=d.structures(),i=before.findIndex(c=>c.item==='WoodPillar'&&c.carryingWeight&&c.weightOn.length===1);const pillar=before[i];
  const killed=d.killStructure(i),after=d.structures();return {pillar,killed,before,after,masters:d.raid().masters,lastKilled:d.raid().lastKilled};});
 {const {before,after,pillar}=raid.collapse;assert.equal(raid.collapse.killed,true);assert.equal(after.length,before.length-1);assert.equal(raid.collapse.masters,1);
  for(const c of after){const b=before.find(x=>x.item===c.item&&x.position.every((v,k)=>v===c.position[k]));assert.ok(b&&b.health===c.health,'unchanged '+c.item);}
  const ceil=after.find(c=>c.item==='WoodCeiling');assert.equal(ceil.weightOn.length,before.find(c=>c.item==='WoodCeiling').weightOn.length-1);assert.ok(pillar.carryingWeight);
  assert.equal(raid.collapse.lastKilled.name,'WoodPillar');const p=pillar.position,s=after[0].position,ox=Math.sign(p[0]-s[0])||1,oz=Math.sign(-p[2]+s[2])||1;await raidShot('pillar-killed-no-collapse',[p[0]+ox*5,p[1]+6,-p[2]+oz*6],[p[0],p[1]+2.5,-p[2]]);}
 deployed.raid={grenade:raid.grenade.blast,door:raid.doorCharge.blast,frame:raid.frame.map(r=>r.blast),metal:raid.metal.charges.map(r=>r.blast),collapse:{pillar:raid.collapse.pillar,after:raid.collapse.after.length}};
 await page.evaluate(()=>{const d=window.explorerDev;for(const n of ['Explosive Charge','Wood Doorway','Metal Door'])while(d.takeItem(n));d.hold('Rock');}); // leave the inventory as the final checks expect
 // Offline NavMeshAgent (nav-crowd.mjs, P2-10): a wolf north of the warehouse at (5211, 4768) hunts the player standing south of
 // it at (5211, 4808). The straight line crosses the warehouse's navmesh hole, so the agent must follow the path corners around
 // it, stay on the original navmesh and arrive in attack range. Last in the run so its random draws change no earlier scenario.
 await mkdir('analysis/browser-qa/motor2',{recursive:true});
 const navRun=await page.evaluate(async()=>{const d=window.explorerDev,wait=ms=>new Promise(r=>setTimeout(r,ms));d.setHealth(100);d.restoreVitals?.();
  d.teleport([5211,369.6,4808]);d.clearHostiles(400);await wait(800);const player=window.explorerState.player.feet;
  const i=d.spawnAnimalAt('wolf_prefab',[5211,368.6,4768]);if(i<0)return {spawned:false};const start=d.animalNav(i);const hunting=d.huntPlayer(i);
  const samples=[];const t0=performance.now();
  while(performance.now()-t0<25000){await new Promise(r=>requestAnimationFrame(r));const s=d.animalNav(i);samples.push({t:(performance.now()-t0)/1000,...s});if(s.state===10)break;}
  const polygons=d.navPolygons([5211,368,4788],42);return {spawned:true,index:i,hunting,start,player,samples,polygons};});
 assert.ok(navRun.spawned&&navRun.hunting,'wolf spawned on the navmesh and hunting');
 {const s=navRun.samples,last=s.at(-1);assert.equal(last.state,10,'reached attack range: '+JSON.stringify(last));assert.ok(last.t<20,`took ${last.t} s`);
  const off=s.filter(x=>!x.onMesh);assert.ok(off.length<=2,`left the navmesh ${off.length} times: ${JSON.stringify(off.slice(0,3))}`);
  // Around, not through: the route bends well away from the straight x = 5211 line while crossing the warehouse's latitude.
  const across=s.filter(x=>x.position[2]>4776&&x.position[2]<4800),detour=Math.max(...across.map(x=>Math.abs(x.position[0]-5211)));assert.ok(detour>6,`detour ${detour} m`);
  let path=0;for(let k=1;k<s.length;k++)path+=Math.hypot(s[k].position[0]-s[k-1].position[0],s[k].position[2]-s[k-1].position[2]);assert.ok(path>40*1.15,`path ${path} m`);
  assert.ok(Math.max(...s.map(x=>x.velocity??0))<=Math.max(...s.map(x=>x.speed??0))+0.01,'never faster than the agent speed (runSpeed while chasing)');
  navRun.summary={seconds:+last.t.toFixed(2),path:+path.toFixed(1),detour:+detour.toFixed(1),samples:s.length,offMesh:off.length,end:last.position.map(v=>+v.toFixed(2)),obstacles:last.obstacles};}
 // Top-down plot: navmesh polygons (grey), the wolf's samples (red), start (blue) and player (green); reviewed with Read.
 await page.evaluate(r=>{const c=document.createElement('canvas');c.id='nav-plot';c.width=900;c.height=900;Object.assign(c.style,{position:'fixed',left:'0',top:'0',zIndex:99999,background:'#fff'});document.body.appendChild(c);
  const g=c.getContext('2d'),cx=5211,cz=4788,k=900/84,X=x=>(x-cx)*k+450,Z=z=>(z-cz)*k+450;g.fillStyle='#fff';g.fillRect(0,0,900,900);
  g.fillStyle='#ddd';g.strokeStyle='#aaa';for(const poly of r.polygons){g.beginPath();poly.forEach((p,i)=>i?g.lineTo(X(p[0]),Z(p[2])):g.moveTo(X(p[0]),Z(p[2])));g.closePath();g.fill();g.stroke();}
  g.strokeStyle='#d00';g.lineWidth=3;g.beginPath();r.samples.forEach((s,i)=>i?g.lineTo(X(s.position[0]),Z(s.position[2])):g.moveTo(X(s.position[0]),Z(s.position[2])));g.stroke();
  g.strokeStyle='#888';g.setLineDash([8,6]);g.beginPath();g.moveTo(X(r.start.position[0]),Z(r.start.position[2]));g.lineTo(X(r.player[0]),Z(r.player[2]));g.stroke();g.setLineDash([]);
  const dot=(p,col)=>{g.fillStyle=col;g.beginPath();g.arc(X(p[0]),Z(p[2]),8,0,7);g.fill();};dot(r.start.position,'#06c');dot(r.player,'#0a0');
  g.fillStyle='#000';g.font='18px sans-serif';g.fillText(`wolf NavMeshAgent around the warehouse: ${r.summary.path} m in ${r.summary.seconds} s (straight 40 m, dashed)`,12,24);g.fillText('grey: original navmesh polygons; red: agent; blue: wolf start; green: player (browser x right, z down)',12,48);},navRun);
 await page.locator('#nav-plot').screenshot({path:'analysis/browser-qa/motor2/wolf-navmesh-path.png'});await page.evaluate(()=>document.getElementById('nav-plot').remove());
 await page.evaluate(i=>window.explorerDev.aimAtAnimal(i),navRun.index);await page.waitForTimeout(300);await page.screenshot({path:'analysis/browser-qa/motor2/wolf-arrived.png'});
 await page.evaluate(()=>{const d=window.explorerDev;d.clearHostiles(400);d.restoreVitals?.();});
 console.log('navigation',JSON.stringify(navRun.summary));
 // Offline Flare (TorchItemDataBlock / TorchItem / FlareObj, offline-flare.mjs): a left click strikes it ("ignite", lit 0.8 s
 // later with StrikeSound and the first-person FlareLightLegacy1P); a right click throws the lit flare (one consumed,
 // WorldFlare_New 1 m ahead at 20 m/s with its FlareLight3p particles, light and burn loop); holstering a lit flare burns it out.
 const flare={};await page.evaluate(()=>{const d=window.explorerDev;d.teleport([5211,369.6,4808]);d.clearHostiles(400);d.restoreVitals?.();d.setTime(22);d.giveItem('Flare',2);d.hold('Flare');});
 await page.waitForFunction(()=>window.explorerDev.flare().held?.uses===2&&window.explorerDev.viewModel(),{},{timeout:15000});await page.waitForTimeout(800);
 await page.evaluate(()=>{const d=window.explorerDev,e=d.aim().eye;d.aimPoint([e[0],e[1]+0.6,e[2]-8]);});
 flare.struck=Date.now();await clickGame();await page.waitForFunction(()=>window.explorerDev.flare().held?.igniting||window.explorerDev.flare().held?.lit,{},{timeout:3000});
 await page.waitForFunction(()=>window.explorerDev.flare().held?.lit&&window.explorerDev.torch().worldLight>0,{},{timeout:5000});flare.litAfter=(Date.now()-flare.struck)/1000;assert.ok(flare.litAfter>=0.75,`lit ${flare.litAfter} s after the strike`);
 await page.waitForFunction(()=>window.explorerDev.fxState().held?.name==='FlareLightLegacy1P',{},{timeout:5000});await page.waitForTimeout(600);await page.screenshot({path:'analysis/browser-qa/lock-flare/flare-lit.png'});
 await page.mouse.down({button:'right'});await page.waitForTimeout(80);await page.mouse.up({button:'right'});
 await page.waitForFunction(()=>window.explorerDev.flare().world.length===1,{},{timeout:5000});
 flare.thrown=await page.evaluate(()=>window.explorerDev.flare());assert.equal(flare.thrown.held?.uses,1,'one flare consumed by the throw');assert.equal(flare.thrown.held.lit,false);
 await page.waitForFunction(()=>{const w=window.explorerDev.flare().world[0];return w&&w.landed&&w.particles>0&&w.lit;},{},{timeout:8000});await page.waitForTimeout(1500);
 flare.world=(await page.evaluate(()=>window.explorerDev.flare())).world[0];assert.equal(await page.evaluate(()=>window.explorerDev.torch().lit),false,'the held light went with the throw');
 {const p=flare.world.position,s=await page.evaluate(()=>window.explorerState.player.feet);flare.distance=Math.hypot(p[0]-s[0],p[2]-s[2]);assert.ok(flare.distance>3,`thrown ${flare.distance} m`);
  await page.evaluate(p=>window.explorerDev.aimPoint(p),p);await page.waitForTimeout(400);await page.screenshot({path:'analysis/browser-qa/lock-flare/flare-thrown.png'});}
 // TorchItem.OnHolstered: strike the last flare, then put it away -> extinguished and consumed.
 await clickGame();await page.waitForFunction(()=>window.explorerDev.flare().held?.lit,{},{timeout:5000});
 flare.holster=await page.evaluate(async()=>{const d=window.explorerDev;d.hold('Rock');await new Promise(r=>setTimeout(r,500));return {held:d.flare().held,left:d.takeItem('Flare'),world:d.flare().world.length};});
 assert.deepEqual([flare.holster.held,flare.holster.left,flare.holster.world],[null,0,1],'the lit flare burnt out when put away');
 await page.evaluate(()=>window.explorerDev.setTime(12));console.log('flare',JSON.stringify({litAfter:flare.litAfter,distance:+flare.distance.toFixed(2),world:flare.world}));deployed.flare=flare;
 // Sky/sea round 2 (P3-10/11/12; after the gameplay scenarios so its camera/time/water changes alter none of them; screenshots in analysis/browser-qa/sky2/): the moon keeps rolling from RustSky/Moon's own up
 // vector; the Scene Camera's layer cull distances (CULL500 600 + render.distance * 1000, Sprite 5 m); the High sea's
 // GrabPass refraction + depth edge blend from the HDR camera image; the reflection with water.reflection's layers (terrain
 // trees included, CULL500 not distance-culled there); Tree Creator wind from the scene WindZone.
 await mkdir('analysis/browser-qa/sky2',{recursive:true});
 assert.equal(nightSky.sky.moonRollSource,'RustSky/Moon');{const m=nightSky.sky.moon,u=nightSky.sky.moonUp;assert.ok(Math.abs(Math.hypot(...u)-1)<1e-6&&Math.abs(m[0]*u[0]+m[1]*u[1]+m[2]*u[2])<1e-6,JSON.stringify(nightSky.sky));}
 const sky2={};sky2.cull=await page.evaluate(()=>window.explorerDev.layerCulling());
 assert.deepEqual([sky2.cull.distances[11],sky2.cull.distances[12],sky2.cull.far,sky2.cull.spherical],[5,800,6000,true]);assert.ok(sky2.cull.instances>8000&&sky2.cull.culled>0&&sky2.cull.visible>0,JSON.stringify(sky2.cull));
 sky2.far=await page.evaluate(async()=>{const d=window.explorerDev;d.gfx('render.distance',1);await new Promise(r=>setTimeout(r,300));const s=d.layerCulling();d.gfx('render.distance',0.2);await new Promise(r=>setTimeout(r,300));return {wide:s,back:d.layerCulling()};});
 assert.equal(sky2.far.wide.distances[12],1600);assert.ok(sky2.far.wide.visible>sky2.cull.visible||sky2.far.wide.culled<sky2.cull.culled,JSON.stringify(sky2.far.wide));assert.equal(sky2.far.back.distances[12],800);
 await page.evaluate(()=>{const d=window.explorerDev;d.setTime(12);d.flyTo([906,262,6281],[300,250,6281]);d.setWaterQuality({waterQuality:2,edgeBlend:true});d.setWaterReflections(true);});
 sky2.sea=await page.waitForFunction(()=>{const s=window.explorerDev.sea();return s.refraction==='grab'&&s.grabs>3&&s.reflections&&s;},{},{timeout:15000}).then(h=>h.jsonValue());
 assert.deepEqual([sky2.sea.quality,sky2.sea.edgeBlend,sky2.sea.reflectionLDR],[2,1,true]);assert.ok(sky2.sea.grabSize[0]>0&&sky2.sea.reflectionSize[0]===Math.floor(sky2.sea.grabSize[0]/2),JSON.stringify(sky2.sea));
 assert.ok((await page.evaluate(()=>window.explorerState.quality.post.targetRequests)).includes('Water4'));
 sky2.trees=await page.evaluate(()=>window.explorerDev.treesReflected());assert.ok(sky2.trees.meshes>0&&sky2.trees.reflected===sky2.trees.meshes,JSON.stringify(sky2.trees));
 await page.waitForTimeout(500);await page.screenshot({path:'analysis/browser-qa/sky2/sea-high-reflections.png'});
 await page.evaluate(()=>window.explorerDev.flyTo([906,256,6281],[700,252,6100]));await page.waitForTimeout(500);await page.screenshot({path:'analysis/browser-qa/sky2/sea-shore-refraction.png'});
 sky2.wind=await page.evaluate(async()=>{const d=window.explorerDev,a=d.treeWind();await new Promise(r=>setTimeout(r,400));return {a,b:d.treeWind()};});
 assert.ok(sky2.wind.a.active&&sky2.wind.b.time>sky2.wind.a.time&&sky2.wind.a.force[2]>0.1&&sky2.wind.a.force[3]>0.1,JSON.stringify(sky2.wind));
 await page.evaluate(()=>{const d=window.explorerDev;d.setWaterReflections(false);d.setWaterQuality({waterQuality:1,edgeBlend:false});d.setTime(0);});
 sky2.moon=await page.evaluate(async()=>{const d=window.explorerDev;await new Promise(r=>setTimeout(r,300));const s=d.sky(),m=s.moon;d.flyTo([906,300,6281],[906+m[0]*100,300+m[1]*100,6281-m[2]*100]);await new Promise(r=>setTimeout(r,500));return d.sky();});
 assert.ok(sky2.moon.moonVisible);await page.screenshot({path:'analysis/browser-qa/sky2/moon-night.png'});await page.evaluate(()=>window.explorerDev.setTime(12));
 deployed.sky2=sky2;
 await page.locator('#reset').click();await page.waitForFunction(()=>!window.explorerState.walk);
 assert.ok(initial.sceneObjects>=400);
 await page.locator('#location').selectOption('0');await page.waitForTimeout(500);
 const atBuilding=await page.evaluate(()=>window.explorerState);assert.ok(atBuilding.drawCalls>10);
 await page.screenshot({path:'analysis/browser-qa/original-building.png'});
 await page.locator('#location').selectOption('1');await page.waitForTimeout(300);await page.screenshot({path:'analysis/browser-qa/original-building-2.png'});
 await page.locator('#inventory-toggle').click();assert.equal(await page.locator('#pack .item-slot').count(),30);assert.ok(await page.locator('#belt .item-slot > img').count()>=3,'starting belt items present'); // cells never swap (RPOS.ItemCellClicked), so earlier steps' held items stay on the beltassert.equal(await page.locator('#equipment .item-slot').count(),4);
 {const a=await page.locator('#belt [data-slot="30"]').boundingBox(),b=await page.locator('#pack [data-slot="0"]').boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:8});await page.mouse.up();} // drag only (RPOSInventoryCell.OnClick is empty)
 assert.equal(await page.locator('#pack [data-slot="0"] img').getAttribute('alt'),'Rock');
 await page.screenshot({path:'analysis/browser-qa/original-inventory.png'});await page.locator('#inventory-close').click();
 await page.setViewportSize({width:1280,height:720});await page.screenshot({path:'analysis/browser-qa/desktop.png'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.locator('#inventory-toggle').click();await page.screenshot({path:'analysis/browser-qa/inventory-desktop.png'});assert.equal(await page.evaluate(()=>document.querySelector('#inventory').scrollWidth>document.querySelector('#inventory').clientWidth),false);
 // After a loot window the crafting window stays hidden until its bumper (OpenLootWindow's ExternalClose, 37565d7).
 if(!(await page.locator('#craft').isVisible()))await page.locator('.rpos-bumper-button',{hasText:'Crafting'}).click();await page.locator('#craft').scrollIntoViewIfNeeded();const craftBox=await page.locator('#craft').boundingBox();assert.ok(craftBox&&craftBox.y>=0&&craftBox.y+craftBox.height<720);await page.screenshot({path:'analysis/browser-qa/inventory-desktop-crafting.png'});await page.locator('#inventory-close').click();
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const result={graphics,quality,initial,moved,walking,jumping,crouching,garageDoor,hingedDoor,useIcon,looted,airdrop,gathered,wildlife,deployed,navigation:navRun.summary,atBuilding,errors,external};await writeFile('analysis/browser-qa/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){
 const page=browser?.contexts()[0]?.pages()[0];if(page){await mkdir('analysis/browser-qa',{recursive:true});await page.screenshot({path:'analysis/browser-qa/failure.png'}).catch(()=>{});await writeFile('analysis/browser-qa/failure.json',JSON.stringify({error:String(error),state:await page.evaluate(()=>window.explorerState).catch(()=>null)},null,2));}throw error;
}finally{await browser?.close();await new Promise(r=>server.close(r));}
