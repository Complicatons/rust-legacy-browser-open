const lib=()=>import('../lib.mjs?t='+Date.now());
// Spike Wall: place one on open ground 3 m ahead, walk into it with W (trigger damage), then hit it with the rock
// (SpikeWall.OnHurt returns melee damage to the attacker).
export default async function({pages,shot,logs},q){const {lock,closeInventory,dev,key}=await lib();const page=pages.get('p1');await closeInventory(page);await lock(page);const out={};
 const wait=ms=>page.waitForTimeout(ms);const hp=()=>page.evaluate(()=>+window.explorerState.vitals.health.toFixed(2));
 await dev(page,'teleport',JSON.parse(q.at??'[5712,316.5,5180]'));await wait(900);await dev(page,'face',0,0);
 const name=q.name??'Spike Wall';await dev(page,'giveItem',name,1);await dev(page,'hold',name);await wait(500);
 await dev(page,'face',0,-0.35);await wait(300);out.preview=await dev(page,'placementPreview');
 const n0=(await dev(page,'deployables')).length;await page.mouse.down();await wait(80);await page.mouse.up();await wait(600);
 const ds=await dev(page,'deployables');out.placed=ds.length>n0;const w=ds.at(-1);out.wall={item:w.item,kind:w.kind,center:w.center,health:w.health};
 await shot(page,'70-spikes-placed');
 await dev(page,'face',0,0);const h0=await hp();await page.keyboard.down('KeyW');await wait(2500);await page.keyboard.up('KeyW');await wait(300);
 out.walk={before:h0,after:await hp(),feet:await page.evaluate(()=>window.explorerState.player.feet)};
 await key(page,'Digit1');await wait(700);await dev(page,'face',0,-0.2);const h1=await hp(),wh=(await dev(page,'deployables')).at(-1).health;
 await page.mouse.down();await wait(2600);await page.mouse.up();await wait(300);
 out.hit={me:[h1,await hp()],wall:[wh,(await dev(page,'deployables')).at(-1).health],swing:await page.evaluate(()=>JSON.stringify(window.explorerState.resources.lastSwing).slice(0,200))};
 await key(page,'Digit1');await shot(page,'70-spikes-after');
 out.log=logs.get('p1').filter(l=>l.type!=='http'&&!/401/.test(l.text)).slice(-6);return out;}
