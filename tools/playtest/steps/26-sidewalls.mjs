const lib=()=>import('../lib.mjs?t='+Date.now());
// Side walls from inside: hold the wall, right-click once (StructureComponentItem attack2 turns 90°), aim at the floor edge, click.
export default async function({pages,shot,out:dir}){const {dev,lock,key}=await lib();const page=pages.get('p1');await lock(page);
 const f=(await dev(page,'structures'))[0].position,top=f[1]+4.02,cz=-f[2];
 const slot=await dev(page,'hold','Wood Wall');await page.waitForTimeout(300);await dev(page,'teleport',[f[0],top+0.05,cz]);await page.waitForTimeout(700);
 await page.mouse.down({button:'right'});await page.waitForTimeout(80);await page.mouse.up({button:'right'});await page.waitForTimeout(200);
 const out={};
 for(const [k,x] of [['west',-2.1],['east',2.1]]){await dev(page,'aimPoint',[f[0]+x,top,cz]);await page.waitForTimeout(250);out[k+'Preview']=await dev(page,'placement');
  if(k==='west')await page.screenshot({path:dir+'/26-sidewall-preview.png'});
  await page.mouse.down();await page.waitForTimeout(80);await page.mouse.up();await page.waitForTimeout(500);}
 out.pieces=(await dev(page,'structures')).map(c=>c.item);return out;
}
