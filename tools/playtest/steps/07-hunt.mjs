import {inv,lock,hold,dev,hitches} from '../lib.mjs';
// Spawn a boar ahead (as a spawner would), chase it with the rock, then harvest the corpse.
export default async function({pages,shot},q){
 const page=pages.get('p1');await lock(page);const kind=q.kind??'boar_prefab';
 const i=await dev(page,'spawnAnimal',kind,5);await page.waitForTimeout(500);
 const log=[];
 for(let n=0;n<40;n++){const a=await dev(page,'animalAt',i);log.push([a.state,Math.round(a.health),a.dead]);if(a.dead)break;
  await dev(page,'approachAnimal',i);await hold(page,900);}
 await page.waitForTimeout(500);await shot(page,'07-'+kind+'-dead');
 const v1=await page.evaluate(()=>window.explorerState.vitals);
 const before=await inv(page);
 for(let n=0;n<12;n++){await dev(page,'approachAnimal',i);await hold(page,1200);const a=await dev(page,'animalAt',i);if(!a||a.harvestLeft<=0)break;}
 await shot(page,'07-'+kind+'-harvest');
 return {log:log.map(x=>x.join(':')).join(' '),vitals:v1,before:before.map(x=>x.item+x.count).join(' '),after:(await inv(page)).map(x=>x.item+x.count).join(' '),animal:await dev(page,'animalAt',i),hitches:await hitches(page)};
}
