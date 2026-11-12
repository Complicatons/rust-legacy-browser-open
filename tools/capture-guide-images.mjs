// Screenshots of our browser port for the wiki guides (site/generated/media/guides/<shot>.jpg). Normal player entry
// (main menu → server browser → offline island) with the HUD visible, then the game's ?dev-free explorerDev helpers
// stage each scene. Runs our own port only; output derives from recovered assets, so it stays in ignored site/generated.
// Needs a GPU (headless Edge via tools/qa-browser.mjs).
//   node tools/capture-guide-images.mjs              every shot
//   node tools/capture-guide-images.mjs gather-ore   some shots
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import {mkdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createServer} from './serve.mjs';
import {launchOptions} from './qa-browser.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),OUT=path.join(root,'site/generated/media/guides');
const R=path.join(root,'browser/assets/recovered'),W=1600,H=900,wait=ms=>new Promise(r=>setTimeout(r,ms));
const meadow=[5700,316.5,5170],yard=[5211,369.6,4808];

export async function captureGuideImages(only=null){
 await mkdir(OUT,{recursive:true});
 const cat=JSON.parse(await readFile(path.join(R,'items/manifest.json'),'utf8'));
 const bpOf=name=>Object.keys(cat.blueprints).find(k=>cat.items[cat.blueprints[k].result]?.data.m_Name===name);
 const heights=new Float32Array((await readFile(path.join(R,'heights.f32'))).buffer.slice(0)),C=16000/2048;
 const ground=(x,z)=>{const c=(x+8000)/C,r=(8000-z)/C,c0=Math.floor(c),r0=Math.floor(r),fc=c-c0,fr=r-r0,at=(rr,cc)=>heights[rr*2049+cc];
  return at(r0,c0)*(1-fc)*(1-fr)+at(r0,c0+1)*fc*(1-fr)+at(r0+1,c0)*(1-fc)*fr+at(r0+1,c0+1)*fc*fr;};
 const server=createServer();await listenServer(server);
 const browser=await chromium.launch(launchOptions()),done=[],failed=[];
 try{
  const context=await browser.newContext({viewport:{width:W,height:H},deviceScaleFactor:1});
  await context.addInitScript(()=>{try{localStorage.setItem('rlb-convars',JSON.stringify({'render.level':1,'water.reflection':true,'grass.on':true,'gfx.grain':false}));
   localStorage.setItem('rlb-render-settings',JSON.stringify({fov:70,showFps:false}));}catch{}});
  const page=await context.newPage();
  const fe=()=>page.evaluate(()=>window.rlbFrontEnd?.state()??null);
  const waitFe=async(fn,timeout=600000)=>{const t=Date.now();while(Date.now()-t<timeout){try{const s=await fe();if(s&&fn(s))return s;}catch{}await wait(200);}throw Error('front end timeout');};
  const dev=(fn,...a)=>page.evaluate(([fn,a])=>window.explorerDev[fn](...a),[fn,a]);
  const shot=async(name,delay=400)=>{await wait(delay);await page.screenshot({path:path.join(OUT,name+'.jpg'),type:'jpeg',quality:84});done.push(name);console.log('captured',name);};
  const frames=async n=>{const s=await page.evaluate(()=>window.explorerState?.frames??0);await page.waitForFunction(k=>(window.explorerState?.frames??0)>k,s+n,{timeout:60000}).catch(()=>{});};
  // Normal entry: title screen → Play → server browser → the offline island.
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'load'});
  await waitFe(s=>s.menu&&s.background);await page.mouse.click(W-200,H-80);await wait(1500);
  // The key-binding rows of the original Options window, before joining.
  if(!only||only.includes('controls')){await page.locator('#front-end [data-df-name="btnOptions"]').click();await waitFe(s=>s.options);await wait(500);
   await page.locator('#front-end [data-button="Inventory"]').scrollIntoViewIfNeeded();await wait(400);await shot('options-keys');await page.keyboard.press('Escape');await wait(600);}
  await page.locator('#front-end [data-df-name="btnPlay"]').click();await waitFe(s=>s.servers);
  await page.locator('#front-end [data-df-name="Community"]').click().catch(()=>{});await wait(800);
  await page.locator('#front-end [data-address="offline"] [data-df-name="btnHostname"]').dblclick();
  await waitFe(s=>!s.loading&&s.inGame);await wait(4000);await dev('restoreVitals').catch(()=>{});
  // Hostile animals (mutants roam near the compounds) are cleared every 1.5 s, except while the animal shots need them.
  await page.evaluate(()=>{window.__guard=setInterval(()=>{if(!window.__keepAnimals)try{window.explorerDev.clearHostiles(250);}catch{}},1500);});
  const alive=async()=>{if(await page.locator('#death:not([hidden])').count()){await page.locator('#respawn').click().catch(()=>{});await wait(5000);console.log('respawned');}await dev('restoreVitals').catch(()=>{});};
  const hands=async()=>{await dev('giveItem','Cloth',1);await dev('hold','Cloth');};
  let hut=null;
  const place=async(name,dist=2.5)=>{await dev('giveItem',name,1);let p=await dev('placeHeld',name,dist);for(let k=0;k<4&&!p?.placed;k++){await dev('walkAway',5);await dev('giveItem',name,1);p=await dev('placeHeld',name,dist);}
   return p?.placed?(await dev('deployables')).length-1:null;};
  const SHOTS={
   'gather-woodpile':async()=>{await dev('setTime',11);await page.waitForFunction(()=>window.explorerDev.nodes().length>0,{},{timeout:60000});
    const nodes=await dev('nodes'),i=Math.max(0,nodes.findIndex(n=>n.name==='res_woodpile'));await dev('hold','Rock');await dev('approachNode',i);await wait(900);await dev('aimAtNode',i);await wait(500);
    for(let k=0;k<2;k++){await dev('approachNode',i);await dev('aimAtNode',i);await dev('trigger',80);await wait(1500);}await shot('gather-woodpile');},
   'gather-ore':async()=>{const nodes=await dev('nodes'),i=nodes.findIndex(n=>/^res_ore/.test(n.name));if(i<0)throw Error('no ore node');await dev('giveItem','Pick Axe',1);await dev('hold','Pick Axe');
    await dev('approachNode',i);await wait(900);await dev('aimAtNode',i);await wait(500);for(let k=0;k<2;k++){await dev('approachNode',i);await dev('aimAtNode',i);await dev('trigger',80);await wait(2200);}await shot('gather-ore');},
   'gather-tree':async()=>{await dev('approachTree');await wait(300);await dev('giveItem','Hatchet',1);await dev('hold','Hatchet');await wait(1300);for(let k=0;k<3;k++){await dev('trigger',80);await wait(1000);}await shot('gather-tree');},
   'inventory':async()=>{for(const [n,c] of [['Wood',200],['Stones',40],['Cloth',12],['Metal Fragments',30],['Bandage',2]])await dev('giveItem',n,c);await dev('teleport',meadow);await dev('face',0.5,0.05);await wait(1200);
    await page.keyboard.press('Tab');await page.waitForSelector('#inventory[open]');await wait(1500);await shot('inventory');
    const bp=bpOf('Wood Planks');if(bp){await page.locator(`[data-blueprint="${bp}"]`).click();await wait(900);await page.locator('#craft-plus').click();await wait(400);await shot('crafting');}
    await page.keyboard.press('Tab');await wait(600);},
   'build-preview':async()=>{await dev('setTime',14.5);for(const [n,c] of [['Wood Foundation',1],['Wood Pillar',4],['Wood Wall',3],['Wood Doorway',1],['Wooden Door',1],['Wood Ceiling',1]])await dev('giveItem',n,c);
    await dev('teleport',[5688,316.5,5148]);await dev('face',0,-0.35);await wait(1200);await dev('hold','Wood Foundation');await wait(600);
    await page.evaluate(()=>{const d=window.explorerDev,e=d.aim().eye;d.aimPoint([e[0],e[1]-2.2,e[2]-5]);});await wait(900);await shot('build-preview');
    // The hut, built as a player would: foundation, four pillars, three walls, a doorway with a door, and a ceiling.
    hut=await page.evaluate(async()=>{const d=window.explorerDev,wait=ms=>new Promise(r=>setTimeout(r,ms));
     let foundation=null;for(let i=0;i<4&&!foundation?.placed;i++){if(i){d.walkAway(12);await wait(400);}d.hold('Wood Foundation');const e=d.aim().eye;d.aimPoint([e[0],e[1]-2.2,e[2]-5]);await wait(900);foundation=d.placeAim('Wood Foundation');}
     if(!foundation?.placed)return null;await wait(600);const f=d.structures()[0].position,top=f[1]+4.02,cz=-f[2];
     const put=async(name,target,dirXZ,turns=0,dist=8)=>{d.hold('Rock');const L=Math.hypot(dirXZ[0],dirXZ[1]);d.teleport([target[0]+dirXZ[0]/L*dist,top+0.1,target[2]+dirXZ[1]/L*dist]);await wait(600);d.aimPoint(target);d.hold(name);
      for(let k=0;k<turns;k++)d.turnStructure();for(let k=0;k<14;k++){d.aimPoint(target);await wait(50);}d.aimPoint(target);const res=d.placeAim(name);for(let k=0;k<(4-turns)%4;k++)d.turnStructure();d.hold('Rock');await wait(450);return res?.placed;};
     for(const [dx,dz] of [[-2.5,-2.5],[2.5,-2.5],[-2.5,2.5],[2.5,2.5]])await put('Wood Pillar',[f[0]+dx,top+0.3,cz+dz],[dx,dz]);
     await put('Wood Wall',[f[0],top+1.4,cz-2.5],[0,-1]);for(const t of [1,0]){if(await put('Wood Wall',[f[0]-2.5,top+1.4,cz],[-1,0],t))break;}for(const t of [1,0]){if(await put('Wood Wall',[f[0]+2.5,top+1.4,cz],[1,0],t))break;}
     await put('Wood Doorway',[f[0],top+1.4,cz+2.5],[0,1]);for(const [x,h] of [[1.6,1.3],[1.2,2.0],[-1.4,1.5]]){if(await put('Wooden Door',[f[0]+x,top+h,cz+2.5],[0,1],0,4))break;}
     for(const t of [0,1]){d.hold('Rock');d.teleport([f[0],top+0.05,cz+1.6]);await wait(700);d.hold('Wood Ceiling');for(let k=0;k<t;k++)d.turnStructure();
      const aimC=()=>{const e=d.aim().eye,dz=cz-e[2],dy=Math.sqrt(Math.max(0,16-dz*dz));d.aimPoint([f[0],e[1]+dy,cz]);};for(let k=0;k<14;k++){aimC();await wait(50);}aimC();const res=d.placeAim('Wood Ceiling');await wait(500);
      for(let k=0;k<(4-t)%4;k++)d.turnStructure();if(res?.placed)break;}
     return f;});
    if(!hut)throw Error('hut not built');const c=[hut[0],hut[1]+5.5,-hut[2]];await page.evaluate(c=>window.explorerDev.flyTo([c[0]+Math.sin(1.4)*11,c[1]+3.5,c[2]+Math.cos(1.4)*11],c),c);await frames(60);await shot('build-hut');},
   'door':async()=>{if(!hut)throw Error('no hut');const top=hut[1]+4.02,cz=-hut[2];const i=(await dev('deployables')).findIndex(o=>o.item==='Wooden Door');if(i<0)throw Error('no door');
    await dev('approachDeployable',i);await wait(700);await dev('aimAtDeployable',i);await wait(800);await page.keyboard.down('KeyE');await page.waitForSelector('#context-ui:not([hidden])',{timeout:5000}).catch(()=>{});await wait(700);
    await shot('door-menu');await page.keyboard.up('KeyE');await wait(600);
    await page.evaluate(([h,top,cz])=>window.explorerDev.flyTo([h[0]+3.2,top+2.3,cz+8.5],[h[0],top+1.4,cz+2.5]),[hut,top,cz]);await frames(40);await shot('door');},
   'raid':async()=>{if(!hut)throw Error('no hut');await dev('setTime',15.5);await dev('giveItem','Explosive Charge',1);
    await page.evaluate(async()=>{const d=window.explorerDev,wait=ms=>new Promise(r=>setTimeout(r,ms)),i=d.deployables().findIndex(o=>o.item==='Wooden Door');if(i>=0&&d.doorAt(i).state===1){d.useDeployed(i);await wait(2000);}});
    const door=await page.evaluate(()=>window.explorerDev.deployables().find(o=>o.item==='Wooden Door')?.center);if(!door)throw Error('no door');
    await dev('teleport',[door[0]-0.1,hut[1]+4.02,door[2]+1.6]);await wait(800);await page.evaluate(p=>window.explorerDev.aimPoint(p),door);await dev('hold','Explosive Charge');await wait(1000);await shot('raid-aim');
    const n0=await page.evaluate(()=>window.explorerDev.raid().explosions.length);if(!await page.evaluate(()=>window.explorerDev.placeAim('Explosive Charge')?.placed))throw Error('charge not placed');
    await dev('hold','Rock');await page.evaluate(p=>window.explorerDev.flyTo([p[0]+3.5,p[1]+1.4,p[2]+7.5],[p[0],p[1]-0.3,p[2]]),door);await wait(1200);await shot('raid-charge');
    for(let k=0;k<90;k++){if(await page.evaluate(n=>window.explorerDev.raid().explosions.length>n,n0))break;await wait(100);}await wait(250);await shot('raid-blast');await wait(3000);await shot('raid-after');},
   'campfire':async()=>{await dev('setTime',12);await dev('hold','Rock');await dev('teleport',[5242.8,369,4837.5]);await wait(800);const i=await place('Camp Fire');if(i==null)throw Error('camp fire not placed');
    await dev('fillDeployed',i,6,'Wood',3);await dev('fillDeployed',i,3,'Raw Chicken Breast',2);await dev('setTime',20.4);await dev('giveItem','Torch',1);await dev('hold','Torch');
    await dev('approachDeployable',i);await wait(700);await dev('aimAtDeployable',i);await wait(1200);await page.keyboard.down('KeyE');
    await page.waitForSelector('#context-ui:not([hidden]) .ctx-button[data-option="Ignite"]',{timeout:5000}).catch(()=>{});await wait(600);await shot('campfire-menu');
    await page.locator('#context-ui .ctx-button[data-option="Ignite"]').click().catch(()=>{});await page.keyboard.up('KeyE');await wait(2500);
    await page.keyboard.down('KeyS');await wait(1500);await page.keyboard.up('KeyS');await dev('aimAtDeployable',i);await wait(1800);await shot('campfire');},
   'furnace':async()=>{await dev('setTime',17.6);await dev('teleport',[5262,369,4850]);await wait(800);const i=await place('Furnace',3);if(i==null)throw Error('furnace not placed');
    await dev('fillDeployed',i,6,'Wood',10);await dev('fillDeployed',i,3,'Metal Ore',10);await dev('fillDeployed',i,4,'Sulfur Ore',10);
    await dev('approachDeployable',i);await wait(700);await dev('aimAtDeployable',i);await wait(800);await page.keyboard.down('KeyE');
    await page.waitForSelector('#context-ui:not([hidden]) .ctx-button[data-option="Ignite"]',{timeout:5000}).catch(()=>{});await page.locator('#context-ui .ctx-button[data-option="Ignite"]').click().catch(()=>{});
    await page.keyboard.up('KeyE');await wait(1200);await page.keyboard.down('KeyS');await wait(1500);await page.keyboard.up('KeyS');await dev('giveItem','Hatchet',1);await dev('hold','Hatchet');await dev('aimAtDeployable',i);await wait(1800);await shot('furnace');},
   'storage':async()=>{await dev('setTime',13);await dev('teleport',[5281,369,4862]);await wait(800);const i=await place('Wood Storage Box');if(i==null)throw Error('box not placed');
    await dev('fillDeployed',i,0,'Wood',250);await dev('fillDeployed',i,1,'Metal Fragments',80);await dev('fillDeployed',i,2,'Cloth',30);
    await dev('approachDeployable',i);await wait(700);await dev('aimAtDeployable',i);await wait(800);await page.keyboard.down('KeyE');
    await page.waitForSelector('#context-ui:not([hidden])',{timeout:5000}).catch(()=>{});await page.locator('#context-ui .ctx-button').first().click().catch(()=>{});await page.keyboard.up('KeyE');await wait(1500);
    await shot('storage');await page.keyboard.press('Tab').catch(()=>{});await wait(500);if(await page.locator('#inventory[open]').count())await page.keyboard.press('Tab');await wait(400);},
   'beds':async()=>{await dev('setTime',16);await dev('teleport',[meadow[0]-40,meadow[1],meadow[2]-30]);await dev('face',0,-0.3);await wait(1200);const bag=await place('Sleeping Bag',2.4);await dev('face',0.9,-0.3);await wait(400);await place('Workbench',3.2);
    await hands();await page.keyboard.down('KeyS');await wait(1300);await page.keyboard.up('KeyS');if(bag!=null)await dev('aimAtDeployable',bag);await wait(1500);await shot('base-gear');},
   'animals':async()=>{await page.evaluate(()=>{window.__keepAnimals=true;window.__heal=setInterval(()=>{try{window.explorerDev.restoreVitals();}catch{}},250);});await dev('setTime',12.5);await dev('teleport',meadow);await dev('face',0,0.02);await dev('clearHostiles',400);
    let k=0;for(const [prefab,name,dist] of [['stag_prefab','stag',8],['boar_prefab','boar',7],['wolf_prefab','wolf',14],['bear_prefab','bear',15],['chicken_prefab','chicken',3.5]]){
     if(process.env.ANIMALS&&!process.env.ANIMALS.split(',').includes(name)){k++;continue;}await alive();// Flat spots east of the meadow (further east the ground drops away: a teleport there is a fatal fall).
     await dev('teleport',[meadow[0]+45*(1+(k++)%3),meadow[1],meadow[2]+20]);await hands();await dev('face',0,0.02);await wait(1500);
     const id=await dev('spawnAnimal',prefab,dist);await wait(['wolf','bear'].includes(name)?700:1500);await page.evaluate(id=>window.explorerDev.aimAtAnimal(id),id).catch(()=>{});await wait(['wolf','bear'].includes(name)?120:900);await shot('animal-'+name);await dev('clearHostiles',400);await dev('restoreVitals');await wait(500);}
    await page.evaluate(()=>{window.__keepAnimals=false;clearInterval(window.__heal);});},
   // Mutant wolf and bear (normally around the compounds), then a mutant's loot sack beside its body and opened.
   'mutants':async()=>{await page.evaluate(()=>{window.__keepAnimals=true;window.__heal=setInterval(()=>{try{window.explorerDev.restoreVitals();}catch{}},250);});await dev('setTime',12.5);await dev('clearHostiles',400);
    let k=0;for(const [prefab,name,dist] of [['mutant_bear','mutant-bear',15],['mutant_wolf','mutant-wolf',14]]){
     await alive();await dev('teleport',[meadow[0]+45*(1+(k++)%3),meadow[1],meadow[2]+20]);await hands();await dev('face',0,0.02);await wait(1500);
     const id=await dev('spawnAnimal',prefab,dist);await wait(700);await page.evaluate(id=>window.explorerDev.aimAtAnimal(id),id).catch(()=>{});await wait(120);await shot('animal-'+name);
     if(name==='mutant-wolf'){
      // Killed like a player's hit: HostileWildlifeAI drops the AILootSack 1.5 m from the body.
      const sacks=await dev('killAnimal',id);if(!sacks)throw Error('the mutant left no loot sack');await wait(2500);const i=sacks-1;
      for(let t=0;t<4&&!await dev('approachDeathDrop',i,2.4);t++)await wait(500);await wait(900);await shot('mutant-sack');
      for(let t=0;t<4&&!await dev('approachDeathDrop',i,1.4);t++)await wait(500);await wait(600);await page.keyboard.press('KeyE');
      await page.waitForFunction(()=>window.explorerState.loot?.looting,{},{timeout:5000}).catch(()=>{});await wait(900);await shot('mutant-sack-loot');await page.keyboard.press('Escape');await wait(600);}
     await dev('clearHostiles',400);await dev('restoreVitals');await wait(500);}
    await page.evaluate(()=>{window.__keepAnimals=false;clearInterval(window.__heal);});},
   'weapons':async()=>{await dev('setTime',12.5);await dev('teleport',meadow);await dev('face',0.4,0.02);for(const [n,c] of [['M4',1],['556 Ammo',100],['Holo sight',1],['Hunting Bow',1],['Arrow',20],['P250',1],['9mm Ammo',40]])await dev('giveItem',n,c);
    await dev('hold','M4');await wait(1500);await shot('weapon-m4');await dev('setItemMods',['Holo sight']);await wait(800);await page.mouse.move(W/2,H/2);await page.mouse.down({button:'right'});await wait(900);await shot('weapon-holo');await page.mouse.up({button:'right'});
    await dev('setItemMods',[]);await dev('hold','Hunting Bow');await wait(1400);await page.mouse.down();await wait(1600);await shot('weapon-bow');await page.mouse.up();await wait(600);await dev('hold','P250');await wait(1300);await shot('weapon-p250');},
   'melee':async()=>{await dev('setTime',12.5);await dev('teleport',meadow);await dev('face',1.2,0.02);await dev('giveItem','Pick Axe',1);
    await dev('hold','Rock');await wait(1500);await shot('weapon-rock');await dev('hold','Pick Axe');await wait(1500);await shot('weapon-pickaxe');},
   'bow-tired':async()=>{await dev('setTime',12.5);await dev('teleport',meadow);await dev('face',0.4,0.02);await dev('giveItem','Hunting Bow',1);await dev('giveItem','Arrow',5);
    await dev('hold','Hunting Bow');await wait(1400);await dev('trigger',7000);await wait(4500);await shot('bow-tired');await wait(3500);},
   'grenade':async()=>{await dev('setTime',12.5);await dev('teleport',[meadow[0]+45,meadow[1],meadow[2]+20]);await dev('face',0,0.02);await dev('giveItem','F1 Grenade',2);await dev('hold','F1 Grenade');await wait(1500);await shot('grenade-hand');
    await page.evaluate(()=>{const d=window.explorerDev,e=d.aim().eye;d.aimPoint([e[0],e[1]-0.6,e[2]-10]);d.trigger(1600);});
    for(let k=0;k<60&&!(await dev('combat')).grenades;k++)await wait(100);for(let k=0;k<80&&(await dev('combat')).grenades;k++)await wait(50);
    await page.evaluate(()=>{const d=window.explorerDev,e=d.aim().eye;d.aimPoint([e[0],e[1]-1.6,e[2]-10]);});await shot('grenade-blast',60);},
   'armour':async()=>{await dev('setTime',12.5);await dev('teleport',meadow);await dev('face',0.5,0.05);for(const [n,s] of [['Kevlar Helmet',36],['Kevlar Vest',37],['Kevlar Pants',38],['Kevlar Boots',39]]){await dev('giveItem',n,1);await dev('equip',n,s);}
    await wait(800);await page.keyboard.press('Tab');await page.waitForSelector('#inventory[open]');await wait(1500);await shot('armour-kevlar');await page.keyboard.press('Tab');await wait(600);},
   'repair':async()=>{await dev('setTime',13);await dev('teleport',[5300,369,4870]);await wait(800);const i=await place('Repair Bench',3);if(i==null)throw Error('repair bench not placed');
    await dev('fillDeployed',i,0,'Hatchet',1);await dev('setDeployedCondition',i,0,0.35);await dev('approachDeployable',i);await wait(700);await dev('aimAtDeployable',i);await wait(800);await page.keyboard.down('KeyE');
    await page.waitForSelector('#context-ui:not([hidden])',{timeout:5000}).catch(()=>{});await page.locator('#context-ui .ctx-button').first().click().catch(()=>{});await page.keyboard.up('KeyE');await wait(1500);
    await shot('repair-bench');await page.keyboard.press('Tab').catch(()=>{});await wait(500);if(await page.locator('#inventory[open]').count())await page.keyboard.press('Tab');await wait(400);},
   'defences':async()=>{await dev('setTime',15);await hands();const at=[meadow[0]-40,meadow[1],meadow[2]+25],placed=[];
    for(const [name,yaw,dist] of [['Spike Wall',0.7,4],['Wood Barricade',-0.7,4]]){await dev('teleport',at);await dev('face',yaw,-0.1);await wait(900);const i=await place(name,dist);console.log(name,i);if(i!=null)placed.push(i);}
    if(!placed.length)throw Error('no defences placed');const pts=(await dev('deployables')).filter((o,k)=>placed.includes(k)).map(o=>o.center);const c=[0,1,2].map(j=>pts.reduce((s,p)=>s+p[j],0)/pts.length);
    await page.evaluate(c=>window.explorerDev.flyTo([c[0]+6,c[1]+3,c[2]+8],[c[0],c[1]+0.6,c[2]]),c);await frames(40);await shot('defences');},
   'talk':async()=>{await dev('setTime',12.5);await dev('teleport',meadow);await dev('face',0.4,0.02);await hands();await wait(1000);await page.keyboard.press('KeyT');await wait(500);
    await page.keyboard.type('anyone near the hangar?',{delay:30});await wait(500);await shot('chat-open');await page.keyboard.press('Escape');await wait(600);
    await page.keyboard.press('F1');await page.locator('#console-input').fill('input.keys');await page.locator('#console-input').press('Enter');await wait(800);await shot('console');await page.keyboard.press('F1');await wait(600);},
   'fall':async()=>{await dev('setTime',12.5);await hands();const [x,z]=[meadow[0]+90,meadow[2]+20];await dev('teleport',[x,ground(x,z)+14,z]);await dev('face',0,0.02);await wait(3500);await shot('fall-injured');await dev('restoreVitals');await wait(500);},
   'crate':async()=>{await dev('setTime',13);await page.waitForFunction(()=>window.explorerDev.crates().length>0,{},{timeout:60000});const list=await dev('crates');
    let i=list.findIndex(c=>/Weapon/.test(c.name)&&c.items);if(i<0)i=list.findIndex(c=>c.items);if(i<0)throw Error('no crate with loot');
    await dev('approachCrate',i);await wait(800);await dev('aimAtCrate',i);await wait(600);await page.keyboard.down('KeyE');await wait(300);await page.keyboard.up('KeyE');
    await page.waitForSelector('#inventory[open]',{timeout:5000}).catch(()=>{});await wait(1200);await shot('crate-loot');await page.keyboard.press('Tab').catch(()=>{});await wait(500);if(await page.locator('#inventory[open]').count())await page.keyboard.press('Tab');await dev('restoreVitals');},
   'move':async()=>{await dev('setTime',8.5);await hands();await dev('teleport',meadow);await dev('face',2.2,-0.02);await wait(2500);await shot('move-meadow');},
   'night':async()=>{await dev('setTime',23);await dev('teleport',yard);await dev('face',2.4,-0.05);await wait(1500);await shot('night-dark');await dev('giveItem','Torch',1);await dev('hold','Torch');await wait(2500);await shot('night-torch');
    for(const [n,c] of [['M4',1],['Flashlight Mod',1],['Laser Sight',1]])await dev('giveItem',n,c);await dev('hold','M4');await wait(1300);await dev('setItemMods',['Flashlight Mod','Laser Sight']);await wait(1200);await shot('night-flashlight');await dev('setItemMods',[]);},
   'radiation':async()=>{await dev('setTime',13);const [x,z]=[6363,4632];await hands();await dev('teleport',[x+38,ground(x+38,z+30)+1,z+30]);await wait(800);await dev('aimPoint',[x,ground(x,z)+4,z]);await wait(9000);await dev('aimPoint',[x,ground(x,z)+4,z]);await wait(400);await shot('radiation');await dev('restoreVitals');
    await dev('teleport',meadow);await wait(1500);},
   'airdrop':async()=>{await dev('setTime',12.5);await dev('teleport',meadow);await dev('face',0,0.02);await dev('giveItem','Supply Signal',1);await dev('hold','Supply Signal');await wait(1500);
    await page.evaluate(()=>{const d=window.explorerDev,e=d.aim().eye;d.aimPoint([e[0],e[1]+1,e[2]-8]);d.trigger(1600);});await wait(3200);await page.evaluate(()=>{const d=window.explorerDev,e=d.aim().eye;d.aimPoint([e[0],e[1]-0.6,e[2]-8]);});await wait(2200);await shot('airdrop-smoke');
    for(let k=0;k<600;k++){const pl=await page.evaluate(()=>window.explorerDev.airdrops().offline?.planes?.[0]?.position??null),e=await page.evaluate(()=>window.explorerDev.aim().eye);if(pl&&Math.hypot(pl[0]-e[0],pl[2]+e[2])<350)break;await wait(100);}
    const pl=await page.evaluate(()=>window.explorerDev.airdrops().offline?.planes?.[0]?.position??null);if(pl){await page.evaluate(p=>window.explorerDev.aimPoint([p[0],p[1],-p[2]]),pl);await wait(300);await shot('airdrop-plane');}
    let c=null;for(let k=0;k<60&&!c;k++){c=await page.evaluate(()=>window.explorerDev.airdrops().offline?.crates?.[0]??null);if(!c)await dev('airdropAdvance',0.5);}if(!c)throw Error('no crate');
    const g=await page.evaluate(p=>{const d=window.explorerDev;d.flyTo([p[0]+15,0,-p[2]+15],[p[0],p[1],-p[2]]);return window.explorerState.ground;},c.position);
    for(let k=0;k<400;k++){const y=await page.evaluate(()=>window.explorerDev.airdrops().offline.crates[0]?.position[1]);if(y==null||y-g<16)break;await dev('airdropAdvance',1);}
    const cp=await page.evaluate(()=>window.explorerDev.airdrops().offline.crates[0]?.position);if(cp){await page.evaluate(([p,g])=>window.explorerDev.flyTo([p[0]+12,g+2.5,-p[2]+12],[p[0],p[1]+0.5,-p[2]]),[cp,g]);await frames(30);await shot('airdrop-crate');}},
   'monuments':async()=>{const m=JSON.parse(await readFile(path.join(root,'site/generated/map/modern.json'),'utf8')).places;
    for(const p of m.filter(p=>['hangar','warehouse','smokestack','oiltank','tank'].includes(p.kind))){const g=ground(p.x,p.z),slug=p.title.toLowerCase().replace(/[^a-z0-9]+/g,'-');
     if(done.includes('place-'+slug))continue;await dev('setTime',14);await page.evaluate(([x,g,z])=>window.explorerDev.flyTo([x-70,g+38,z+60],[x,g+6,z]),[p.x,g,p.z]);await frames(80);await shot('place-'+slug);}},
  };
  for(const [name,fn] of Object.entries(SHOTS)){if(only&&!only.includes(name))continue;try{await alive();await fn();}catch(e){failed.push(name);console.log('FAIL',name,e.message.split('\n')[0]);}
   const st=await fe().catch(()=>null);if(st?.inGame&&st.menu){await page.keyboard.press('Escape');await wait(400);}}
 }finally{await browser.close();server.close();}
 return {done,failed};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const r=await captureGuideImages(process.argv[2]?process.argv.slice(2):null);console.log(JSON.stringify(r));
}
