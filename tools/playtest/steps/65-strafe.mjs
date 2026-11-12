const lib=()=>import('../lib.mjs?t='+Date.now());
// Horizontal speed for each ?sets of keys (JSON list of key lists), 2 s each, at the flat field.
export default async function({pages},q){const {lock,closeInventory,dev}=await lib();const page=pages.get('p1');await closeInventory(page);await lock(page);
 await dev(page,'teleport',JSON.parse(q.at??'[5700,316.5,5170]'));await page.waitForTimeout(1200);
 const feet=()=>page.evaluate(()=>window.explorerState.player.feet.slice());const out=[];
 for(const keys of JSON.parse(q.sets??'[["KeyD"],["KeyA"],["ShiftLeft","KeyD"],["KeyW","KeyD"],["ShiftLeft","KeyW","KeyD"]]')){
  for(const k of keys)await page.keyboard.down(k);await page.waitForTimeout(500);const a=await feet();await page.waitForTimeout(2000);const b=await feet();for(const k of keys)await page.keyboard.up(k);await page.waitForTimeout(600);
  out.push([keys.join('+'),+(Math.hypot(b[0]-a[0],b[2]-a[2])/2).toFixed(2),+(b[1]-a[1]).toFixed(2)]);}
 return out;}
