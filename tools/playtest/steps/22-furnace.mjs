const lib=()=>import('../lib.mjs?t='+Date.now());
// Open the furnace (unfuelled: quick E opens), drag Metal Ore and Wood in, close, hold E -> Ignite, wait for fragments.
export default async function({pages,shot},q){const {dev,inv,drag,slotOf,closeInventory,lock,key}=await lib();
 const page=pages.get('p1');await closeInventory(page);await lock(page);const i=(await dev(page,'deployables')).findIndex(d=>d.kind==='furnace');
 await dev(page,'approachDeployable',i);await page.waitForTimeout(400);const hint=await page.evaluate(()=>window.explorerState.useHint);
 await key(page,'KeyE',80);await page.waitForTimeout(700);
 const slots=await page.evaluate(()=>[...document.querySelectorAll('#loot [data-loot]')].map(e=>e.dataset.loot+':'+e.textContent.trim()));
 const items=await inv(page);await drag(page,`#inventory [data-slot="${slotOf(items,'Metal Ore')}"]`,'#loot [data-loot="0"]');
 await drag(page,`#inventory [data-slot="${slotOf(await inv(page),'Wood')}"]`,'#loot [data-loot="1"]');await shot(page,'22-furnace-filled');
 const filled=(await dev(page,'deployables'))[i].slots;
 await closeInventory(page);await lock(page);await dev(page,'approachDeployable',i);await page.waitForTimeout(300);
 await page.keyboard.down('KeyE');await page.waitForTimeout(700);const ui=(await dev(page,'contextUI')).ui;const ig=ui.buttons.find(b=>b.text==='Ignite');
 if(ig){await page.mouse.move(ig.x+ig.width/2,ig.y+ig.height/2,{steps:4});await page.mouse.down();await page.mouse.up();}await page.keyboard.up('KeyE');await page.waitForTimeout(500);
 await shot(page,'22-furnace-lit');const samples=[];for(let k=0;k<+(q.n??8);k++){await page.waitForTimeout(5000);const s=(await dev(page,'deployables'))[i];samples.push(s.lit+' '+s.slots.map(x=>x?x.item.split(' ').map(w=>w[0]).join('')+x.uses:'-').join(','));}
 return {hint,slots,filled,menu:ui.buttons.map(b=>b.text),samples};
}
