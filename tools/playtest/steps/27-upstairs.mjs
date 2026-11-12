const lib=()=>import('../lib.mjs?t='+Date.now());
// Stairs in the room, then the second floor: pillars on the ceiling corners and a wall; screenshot from outside.
export default async function({pages,shot}){const {dev,lock}=await lib();const page=pages.get('p1');await lock(page);
 const f=(await dev(page,'structures'))[0].position,top=f[1]+4.02,cz=-f[2],out={};
 const click=async()=>{await page.mouse.down();await page.waitForTimeout(80);await page.mouse.up();await page.waitForTimeout(500);};
 await dev(page,'hold','Wood Stairs');await dev(page,'teleport',[f[0],top+0.05,cz+1.8]);await page.waitForTimeout(700);
 await dev(page,'aimPoint',[f[0],top,cz-0.5]);await page.waitForTimeout(250);out.stairs=await dev(page,'placement');await click();
 // Up on the ceiling (a player climbs the stairs; teleport stands in).
 await dev(page,'hold','Wood Pillar');await dev(page,'teleport',[f[0],top+4.2,cz]);await page.waitForTimeout(800);out.onRoof=await page.evaluate(()=>window.explorerState.player.feet[1]);
 out.pillars=[];for(const [dx,dz] of [[2.3,2.3],[-2.3,2.3],[2.3,-2.3],[-2.3,-2.3]]){await dev(page,'aimPoint',[f[0]+dx,top+4,cz+dz]);await page.waitForTimeout(200);const p=await dev(page,'placement');await click();out.pillars.push(p?.valid);}
 await dev(page,'hold','Wood Wall');await page.waitForTimeout(200);await dev(page,'aimPoint',[f[0],top+4,cz-2.2]);await page.waitForTimeout(200);out.wall2=(await dev(page,'placement'))?.valid;await click();
 out.pieces=(await dev(page,'structures')).map(c=>c.item);
 await dev(page,'teleport',[f[0]+9,top-3,cz+9]);await page.waitForTimeout(900);await dev(page,'aimPoint',[f[0],top+2,cz]);await page.waitForTimeout(500);await shot(page,'27-base-outside');
 return out;
}
