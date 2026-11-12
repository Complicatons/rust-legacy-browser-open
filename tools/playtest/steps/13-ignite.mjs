const lib=()=>import('../lib.mjs?t='+Date.now());
// E is held with the menu open: click Ignite, release E, then wait for the meat to cook.
export default async function({pages,shot}){const {dev}=await lib();
 const page=pages.get('p1');
 await page.mouse.move(640,345,{steps:4});await page.mouse.down();await page.waitForTimeout(60);await page.mouse.up();await page.keyboard.up('KeyE');await page.waitForTimeout(800);
 const d=()=>dev(page,'deployables').then(x=>x.filter(d=>d.kind==='campfire').at(-1));const a=await d();await shot(page,'13-fire-lit');
 const fx=await dev(page,'fxState');
 const samples=[];for(let i=0;i<12;i++){await page.waitForTimeout(5000);const s=await d();samples.push([s.lit,s.slots.map(x=>x?x.item[0]+x.item.split(' ')[0].slice(1,4)+x.uses:'-').join(',')].join(' '));}
 await shot(page,'13-fire-cooking');
 return {lit:a.lit,fires:fx.fires,samples,menu:(await dev(page,'contextUI')).client.state};
}
