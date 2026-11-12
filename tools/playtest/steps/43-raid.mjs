const lib=()=>import('../lib.mjs?t='+Date.now());
// Raid: hold an Explosive Charge, stand at the closed door, aim at it and click; run; after the blast walk in and
// loot the box; then repair the damaged doorway with Wood from the belt (wait 5 s after the damage first).
export default async function({pages,shot}){const {dev,lock,key,inv,drag,closeInventory}=await lib();const page=pages.get('p1');await closeInventory(page);await lock(page);const out={};
 await dev(page,'giveItem','Explosive Charge',1);const s=(await dev(page,'structures'))[0].position,top=s[1]+4.02,cz=-s[2];
 const door=(await dev(page,'deployables')).find(d=>d.kind==='door');const dc=door.center;
 await dev(page,'teleport',[dc[0],top,dc[2]+1.1]);await page.waitForTimeout(600);const slot=await dev(page,'hold','Explosive Charge');await key(page,'Digit1');await page.waitForTimeout(1300);/* the rock's deployLength: MeleeWeaponItem.CanSetActivate(false) waits for nextPrimaryAttackTime */await key(page,'Digit'+(slot-29));await page.waitForTimeout(600);
 await dev(page,'aimPoint',[dc[0],dc[1]+0.2,dc[2]]);await page.waitForTimeout(300);out.preview=await dev(page,'placement');await shot(page,'43-charge-aim');
 const n=(await dev(page,'raid')).explosions.length;await page.mouse.down();await page.waitForTimeout(80);await page.mouse.up();await page.waitForTimeout(600);
 out.charge=(await dev(page,'deployables')).filter(d=>d.item&&/Charge/.test(JSON.stringify(d))).map(d=>d.carrier);
 await dev(page,'teleport',[dc[0]+6,top,dc[2]+8]);await page.waitForTimeout(400);await dev(page,'aimPoint',dc);
 for(let i=0;i<150;i++){if((await dev(page,'raid')).explosions.length>n)break;await page.waitForTimeout(100);}await page.waitForTimeout(150);await shot(page,'43-blast');
 const raid=await dev(page,'raid');out.blast=JSON.stringify(raid.explosions.at(-1)).slice(0,600);await page.waitForTimeout(1500);await shot(page,'43-after');
 out.door=(await dev(page,'deployables')).filter(d=>d.kind==='door').map(d=>d.health);out.doorway=(await dev(page,'structures')).filter(c=>c.item==='WoodDoorFrame').map(c=>c.health);
 return out;}
