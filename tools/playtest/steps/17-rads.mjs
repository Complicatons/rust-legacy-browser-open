const lib=()=>import('../lib.mjs?t='+Date.now());
// Walk into the nearest radiation zone for 20 s; read RADS on the HUD and metabolism.
export default async function({pages,shot}){const {vitals,lock,dev}=await lib();
 const page=pages.get('p1');await lock(page);
 const zones=await dev(page,'zones');const me=(await vitals(page)).pos;
 const z=zones.map(z=>({...z,position:[z.position[0],z.position[1],-z.position[2]]})).map(z=>({...z,d:Math.hypot(z.position[0]-me[0],z.position[2]-me[2])})).sort((a,b)=>a.d-b.d)[0];
 await dev(page,'teleport',[z.position[0]+z.radius*0.3,z.position[1]+2,z.position[2]]);await page.waitForTimeout(1000);
 const r=[];for(let i=0;i<4;i++){await page.waitForTimeout(5000);const t=await dev(page,'tod');r.push(Math.round(t.rads));}
 await shot(page,'17-rads');
 const hud=await page.evaluate(()=>document.querySelector('#hud-stats, .hud-stats, #vitals')?.innerText??null);
 return {zones:zones.length,zone:z,rads:r,health:(await vitals(page)).health,hud};
}
