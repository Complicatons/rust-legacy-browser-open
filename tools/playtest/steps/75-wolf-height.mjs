const lib=()=>import('../lib.mjs?t='+Date.now());
// Spawn a ?kind (default wolf) ?d m ahead and stand still (empty hands) for ?ms while it comes and bites: sample the
// animal's height above the terrain under it and its distance to us every 250 ms. An animal standing on the player's
// hit regions or a corpse shows up as a height well above 0.
export default async function({pages,shot},q){const {lock,closeInventory,dev}=await lib();const page=pages.get('p1');await closeInventory(page);await lock(page);
 if(q.at)await dev(page,'teleport',JSON.parse(q.at));await page.waitForTimeout(800);
 const a=await dev(page,'spawnAnimal',q.kind??'wolf_prefab',+(q.d??8));const samples=[];let maxUp=-Infinity;
 for(let i=0;i<+(q.ms??12000)/250;i++){await page.waitForTimeout(250);
  const s=await page.evaluate(i=>{const d=window.explorerDev,x=d.animalAt(i),me=window.explorerState.player.feet;if(!x)return null;
   const g=d.groundAt?.(x.position[0],x.position[2]);return {y:x.position[1],me:me[1],state:x.state,dist:+x.distance.toFixed(2),health:+window.explorerState.vitals.health.toFixed(1),dxz:+Math.hypot(x.position[0]-me[0],x.position[2]-me[2]).toFixed(2)};},a);
  if(!s)break;samples.push(s);maxUp=Math.max(maxUp,s.y-s.me);}
 await shot(page,'75-'+(q.kind??'wolf'));
 return {maxAboveMyFeet:+maxUp.toFixed(2),samples:samples.filter((_,i)=>i%4===0).map(s=>`${s.state} d${s.dist} dxz${s.dxz} up${(s.y-s.me).toFixed(2)} hp${s.health}`)};}
