const lib=()=>import('../lib.mjs?t='+Date.now());
// Building rules from 1c1b911 played: storage RadialCheck (walk 7 m away with the box open), lit fire loses its
// fuel when a player takes the wood out (FuelRemoveCheck), door open/close with E.
export default async function({pages,shot,logs},q){const {lock,closeInventory,dev,inv,drag,slotOf,key}=await lib();const page=pages.get('p1');await closeInventory(page);await lock(page);const out={};
 const wait=ms=>page.waitForTimeout(ms);const deps=()=>dev(page,'deployables');
 // 1. Storage box: open, then move 7 m away.
 const box=(await deps()).findIndex(d=>d.kind==='storage');await dev(page,'approachDeployable',box);await wait(300);
 await page.keyboard.press('KeyE');await wait(600);out.boxOpen=await page.evaluate(()=>Boolean(document.querySelector('#loot')?.checkVisibility?.()||window.explorerState.loot.looting));
 const bp=(await deps())[box].position;await dev(page,'teleport',[bp[0]+7,bp[1]+0.3,-bp[2]]);
 const t0=Date.now();let closedAfter=null;for(let i=0;i<60;i++){await wait(250);const open=await page.evaluate(()=>Boolean(document.querySelector('#inventory')?.open&&window.explorerState.loot.looting));if(!open){closedAfter=Date.now()-t0;break;}}
 out.radial={closedAfterMs:closedAfter,looting:await page.evaluate(()=>window.explorerState.loot.looting),invOpen:await page.evaluate(()=>Boolean(document.querySelector('#inventory')?.open))};
 await closeInventory(page);await lock(page);
 // 2. The lit camp fire: open it (hold E -> Open), drag the Wood into the bag.
 const fires=(await deps()).map((d,i)=>[d,i]).filter(([d])=>d.kind==='campfire'),[fire,fi]=fires.find(([d])=>d.lit)??fires.at(-1);
 out.fireBefore={lit:fire.lit,slots:fire.slots.map(s=>s?s.item+s.uses:'-').join(',')};
 if(!fire.slots[6])await dev(page,'giveItem','Wood',5);
 await dev(page,'approachDeployable',fi);await wait(300);await page.keyboard.down('KeyE');await wait(700);
 const ui=(await dev(page,'contextUI')).ui;const open=ui.buttons.find(b=>b.text==='Open');
 if(open){await page.mouse.move(open.x+open.width/2,open.y+open.height/2,{steps:4});await page.mouse.down();await page.mouse.up();}await page.keyboard.up('KeyE');await wait(700);
 const items=await inv(page);const free=[...Array(30).keys()].find(i=>!items.some(x=>x.slot===i));
 const lit0=(await deps())[fi].lit;
 if((await deps())[fi].slots[6]){await drag(page,'#loot [data-loot="6"]',`#inventory [data-slot="${free}"]`);}
 await wait(150);const litAt150=(await deps())[fi].lit;await wait(400);const f1=(await deps())[fi];
 out.fuelRemove={litBeforeDrag:lit0,litAt150,litAt550:f1.lit,slots:f1.slots.map(s=>s?s.item+s.uses:'-').join(',')};await shot(page,'68-fire-unfuelled');
 await closeInventory(page);await lock(page);
 // 3. Door: E toggles it.
 const di=(await deps()).findIndex(d=>d.kind==='door');await dev(page,'approachDeployable',di);await wait(300);out.doorHint=await page.evaluate(()=>window.explorerState.useHint);
 const ds=()=>page.evaluate(i=>JSON.stringify(window.explorerDev.deployables()[i].door??window.explorerDev.deployables()[i]).slice(0,200),di);
 out.door0=await ds();await page.keyboard.press('KeyE');await wait(1500);out.door1=await ds();await shot(page,'68-door-open');
 out.log=logs.get('p1').filter(l=>l.type!=='http'&&!/401/.test(l.text)).slice(-6);
 return out;}
