const lib=()=>import('../lib.mjs?t='+Date.now());
// 9mm Pistol: shoot a wolf (it hunts back), count clip, reload with R.
export default async function({pages,shot},q){const {dev,lock,key,closeInventory,vitals}=await lib();const page=pages.get('p1');await closeInventory(page);await lock(page);
 const gun=q.gun??'9mm Pistol',ammo=q.ammo??'9mm Ammo';await dev(page,'giveItem',gun,1);await dev(page,'giveItem',ammo,60);
 const s=await dev(page,'hold',gun);await page.waitForTimeout(900);const out={w0:await dev(page,'weapon')};
 const a=await dev(page,'spawnAnimal',q.animal??'wolf_prefab',10);await page.waitForTimeout(300);out.shots=[];
 for(let i=0;i<14;i++){const st=await dev(page,'animalAt',a);if(!st||st.dead)break;await dev(page,'aimAtAnimal',a);await page.mouse.down();await page.waitForTimeout(60);await page.mouse.up();await page.waitForTimeout(350);
  if(i===0)await shot(page,'29-gun-fire');const w=await dev(page,'weapon');out.shots.push([Math.round((await dev(page,'animalAt',a))?.health??-1),w.clip,(await dev(page,'combat')).lastShot?.hit?.kind??(await dev(page,'combat')).lastShot?.target??'?']);}
 out.animal=await dev(page,'animalAt',a);out.me=await vitals(page);
 await key(page,'KeyR',80);await page.waitForTimeout(2500);out.afterReload=await dev(page,'weapon');await shot(page,'29-gun-reloaded');
 out.lastShot=JSON.stringify((await dev(page,'combat')).lastShot)?.slice(0,300);
 return out;
}
