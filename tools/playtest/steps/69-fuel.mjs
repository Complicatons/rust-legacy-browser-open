const lib=()=>import('../lib.mjs?t='+Date.now());
// FireBarrel FuelRemoveCheck as a player: open the last camp fire, drag Wood into Fuel, Ignite from the hold-E menu,
// open it again (hold E -> Open) and drag the Wood back out; the fire should go out about 0.25 s later.
export default async function({pages,shot},q){const {lock,closeInventory,dev,inv,drag,slotOf}=await lib();const page=pages.get('p1');await closeInventory(page);await lock(page);const out={};
 const wait=ms=>page.waitForTimeout(ms);const deps=()=>dev(page,'deployables');
 const fi=(await deps()).findLastIndex(d=>d.kind==='campfire');await dev(page,'giveItem','Wood',10);
 const menu=async label=>{await dev(page,'approachDeployable',fi);await wait(300);await page.keyboard.down('KeyE');await wait(700);const ui=(await dev(page,'contextUI')).ui;const b=ui.buttons.find(b=>b.text===label);
  if(b){await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:4});await page.mouse.down();await page.mouse.up();}await page.keyboard.up('KeyE');await wait(700);return ui.buttons.map(b=>b.text);};
 out.menu1=await menu('Open');
 await drag(page,`#inventory [data-slot="${slotOf(await inv(page),'Wood')}"]`,'#loot [data-loot="6"]');out.filled=(await deps())[fi].slots[6];
 await closeInventory(page);await lock(page);out.menu2=await menu('Ignite');out.lit=(await deps())[fi].lit;
 out.menu3=await menu('Open');const items=await inv(page);const free=[...Array(30).keys()].find(i=>!items.some(x=>x.slot===i));
 const t=Date.now();await drag(page,'#loot [data-loot="6"]',`#inventory [data-slot="${free}"]`);const samples=[];
 for(let i=0;i<8;i++){samples.push([Date.now()-t,(await deps())[fi].lit]);await wait(60);}
 out.samples=samples;out.slots=(await deps())[fi].slots.map(s=>s?s.item+s.uses:'-').join(',');out.fx=(await dev(page,'fxState')).fires.at(-1);
 await shot(page,'69-fuel-removed');await closeInventory(page);return out;}
