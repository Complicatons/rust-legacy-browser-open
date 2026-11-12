// While dead: screenshot the death camera, report ragdolls/camera, then click Respawn (?respawn=0 to stay dead).
export default async function({pages,shot},q){const page=pages.get('p1'),out={};
 out.dead=await page.evaluate(()=>window.explorerState.vitals.dead);
 out.combat=await page.evaluate(()=>{const c=window.explorerDev.combat();return {ragdolls:c.ragdolls,cameraNear:c.cameraNear};});
 out.camera=await page.evaluate(()=>window.explorerState.position);out.reason=await page.evaluate(()=>document.querySelector('#death-reason')?.textContent);
 await shot(page,q.name??'63-death');
 if(out.dead&&q.respawn!=='0'){await page.locator('#respawn').click();await page.waitForTimeout(2500);
  out.after=await page.evaluate(()=>({alive:!window.explorerState.vitals.dead,health:window.explorerState.vitals.health,feet:window.explorerState.player.feet,camera:window.explorerState.position,near:window.explorerDev.combat().cameraNear}));}
 return out;}
