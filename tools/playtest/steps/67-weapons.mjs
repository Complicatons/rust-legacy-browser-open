const lib=()=>import('../lib.mjs?t='+Date.now());
// Hatchet swing right after equipping (deploy delay), Shotgun at a boar (pellet tracers), F1 Grenade at a boar
// (explosion + corpse force). Real mouse clicks; dev hooks only to give items, spawn the animal and aim.
export default async function({pages,shot,logs},q){const {lock,closeInventory,dev,key}=await lib();const page=pages.get('p1');await closeInventory(page);await lock(page);const out={};
 const wait=ms=>page.waitForTimeout(ms);
 await dev(page,'teleport',[5700,316.5,5175]);await wait(900);
 // 1. Hatchet: equip and hold the button at once; when does the first swing land?
 await dev(page,'giveItem','Hatchet',1);await key(page,'Digit1');await wait(400); // rock out
 const s0=await page.evaluate(()=>window.explorerState.resources.lastSwing?.time??null);
 const t0=await page.evaluate(()=>performance.now()/1000);await dev(page,'hold','Hatchet');await page.mouse.down();
 let first=null;for(let i=0;i<40;i++){await wait(50);const s=await page.evaluate(()=>window.explorerState.resources.lastSwing?.time??null);if(s!==s0&&s!=null){first=s;break;}}
 await page.mouse.up();out.hatchet={firstSwingAfter:first!=null?+(first-t0).toFixed(2):null,vm:(await dev(page,'viewModel'))?.name};
 await wait(600);
 // 2. Shotgun at a boar 8 m ahead.
 await dev(page,'giveItem','Shotgun',1);await dev(page,'giveItem','Shotgun Shells',20);await dev(page,'hold','Shotgun');await wait(1500);
 const b=await dev(page,'spawnAnimal','boar_prefab',8);await wait(300);await dev(page,'aimAtAnimal',b);
 await page.mouse.down();await wait(60);await page.mouse.up();await wait(400);
 const c=await dev(page,'combat');out.shotgun={weapon:await dev(page,'weapon'),boar:(await dev(page,'animalAt',b))?.health,lastTracer:JSON.stringify(c.lastTracer)?.slice(0,300),lastShot:JSON.stringify(c.lastShot)?.slice(0,300)};
 await shot(page,'67-shotgun');
 // 3. F1 Grenade at another boar 10 m ahead.
 await dev(page,'giveItem','F1 Grenade',2);await dev(page,'hold','F1 Grenade');await wait(1200);
 const g=await dev(page,'spawnAnimal','boar_prefab',10);await wait(300);await dev(page,'aimAtAnimal',g);
 const n0=(await dev(page,'raid')).explosions.length;
 await page.mouse.down();await wait(700);await page.mouse.up();
 for(let i=0;i<80;i++){if((await dev(page,'raid')).explosions.length>n0)break;await wait(100);}
 await wait(200);await shot(page,'67-grenade');
 const r=await dev(page,'raid');out.grenade={explosions:r.explosions.length-n0,last:JSON.stringify(r.explosions.at(-1))?.slice(0,400),boar:await dev(page,'animalAt',g),me:(await page.evaluate(()=>window.explorerState.vitals.health))};
 out.log=logs.get('p1').filter(l=>l.type!=='http'&&!/401/.test(l.text)).slice(-6);
 return out;}
