const lib=()=>import('../lib.mjs?t='+Date.now());
// Hold E -> Open on the fire, drag cooked meat into the bag, right-click it and pick Eat.
export default async function({pages,shot}){const {inv,dev,drag,slotOf,lock}=await lib();
 const page=pages.get('p1');await lock(page);await dev(page,'approachDeployable',(await dev(page,'deployables')).findLastIndex(d=>d.kind==='campfire'));await page.waitForTimeout(300);
 await page.keyboard.down('KeyE');await page.waitForTimeout(700);
 const ui=(await dev(page,'contextUI')).ui;const open=ui.buttons.find(b=>b.text==='Open');
 await page.mouse.move(open.x+open.width/2,open.y+open.height/2,{steps:4});await page.mouse.down();await page.mouse.up();await page.keyboard.up('KeyE');await page.waitForTimeout(700);
 const looting=await page.evaluate(()=>window.explorerState.loot.looting);
 let items=await inv(page);const free=[...Array(30).keys()].find(i=>!items.some(x=>x.slot===i));
 await drag(page,'#loot [data-loot="0"]',`#inventory [data-slot="${free}"]`);items=await inv(page);
 const cal0=(await page.evaluate(()=>window.explorerState.vitals.calories));
 const s=slotOf(items,'Cooked Chicken Breast');const b=await page.locator(`#inventory [data-slot="${s}"]`).boundingBox();
 await page.mouse.click(b.x+b.width/2,b.y+b.height/2,{button:'right'});await page.waitForTimeout(300);
 const menu=await page.evaluate(()=>[...document.querySelectorAll('#item-menu button')].map(b=>b.textContent));await shot(page,'14-item-menu');
 await page.locator('#item-menu button',{hasText:'Eat'}).click();await page.waitForTimeout(800);
 const cal1=(await page.evaluate(()=>window.explorerState.vitals.calories));await shot(page,'14-ate');
 return {looting,free,menu,cal0,cal1,items:(await inv(page)).map(x=>x.slot+':'+x.item+x.count).join(' '),notices:await page.evaluate(()=>window.explorerState.resources.notices)};
}
