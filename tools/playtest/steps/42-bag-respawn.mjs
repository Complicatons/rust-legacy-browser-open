const lib=()=>import('../lib.mjs?t='+Date.now());
// Store something in the box, die outside, respawn AT A CAMP: the sleeping bag inside the base.
export default async function({pages,shot}){const {dev,lock,inv,drag,slotOf,closeInventory}=await lib();const page=pages.get('p1');await closeInventory(page);await lock(page);const out={};
 const deps=await dev(page,'deployables'),box=deps.findIndex(d=>d.item&&d.kind==='storage'),bag=deps.find(d=>d.kind==='respawn');
 await dev(page,'giveItem','Metal Fragments',50);await dev(page,'approachDeployable',box);await page.waitForTimeout(300);out.hint=await page.evaluate(()=>explorerState.useHint);
 await page.keyboard.press('KeyE');await page.waitForTimeout(700);const items=await inv(page);
 await drag(page,`#inventory [data-slot="${slotOf(items,'Metal Fragments')}"]`,'#loot [data-loot="0"]');out.box=(await dev(page,'deployables'))[box].slots.filter(Boolean);await closeInventory(page);
 await dev(page,'teleport',[5700,316.5,5170]);await page.waitForTimeout(600);await lock(page);
 await page.keyboard.press('F1');await page.waitForTimeout(300);await page.keyboard.type('suicide');await page.keyboard.press('Enter');await page.keyboard.press('F1');await page.waitForTimeout(1500);
 await page.locator('#respawn-camp').click();await page.waitForTimeout(3000);const feet=await page.evaluate(()=>explorerState.player.feet);
 out.bag=bag.position;out.spawnedAt=feet;out.distToBag=Math.hypot(feet[0]-bag.position[0],feet[2]+bag.position[2]);await shot(page,'42-respawn-at-bag');
 out.alive=await page.evaluate(()=>!explorerState.vitals.dead);return out;}
