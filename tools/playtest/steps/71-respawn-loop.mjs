const lib=()=>import('../lib.mjs?t='+Date.now());
// ?n times: F1 suicide, Respawn (random spawn), then health/feet/lastFall at 0.3 s and 3 s after the click.
export default async function({pages},q){const {lock}=await lib();const page=pages.get('p1');const out=[];
 const st=()=>page.evaluate(()=>({h:+window.explorerState.vitals.health.toFixed(1),b:+window.explorerState.vitals.bleeding.toFixed(2),feet:window.explorerState.player.feet.map(v=>+v.toFixed(1)),g:window.explorerState.player.grounded,fall:window.explorerState.player.lastFall&&{speed:+window.explorerState.player.lastFall.speed?.toFixed?.(1),dmg:+window.explorerState.player.lastFall.damage?.toFixed?.(1),t:window.explorerState.player.lastFall.time}}));
 for(let i=0;i<+(q.n??4);i++){await lock(page);
  await page.keyboard.press('F1');await page.waitForTimeout(300);await page.keyboard.type('suicide');await page.keyboard.press('Enter');await page.keyboard.press('F1');await page.waitForTimeout(1200);
  const dead=await st();await page.locator(q.camp?'#respawn-camp':'#respawn').click();await page.waitForTimeout(300);const a=await st();await page.waitForTimeout(2700);const b=await st();
  out.push({dead:[dead.h,dead.b],at300:a,at3s:b});}
 return out;}
