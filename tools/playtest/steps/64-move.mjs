const lib=()=>import('../lib.mjs?t='+Date.now());
// Movement with real keys at ?at (default the flat field): walk, sprint, crouch, back-sprint, held jump (count jumps in
// 4 s), sprint-jump; speeds are horizontal m/s from the feet. ?yaw faces a direction first (radians).
export default async function({pages,shot,logs},q){const {lock,closeInventory,dev}=await lib();const page=pages.get('p1');await closeInventory(page);await lock(page);
 if(q.at)await dev(page,'teleport',JSON.parse(q.at));else await dev(page,'teleport',[5700,316.5,5170]);await page.waitForTimeout(1200);
 if(q.yaw)await dev(page,'face',+q.yaw,0);
 const feet=()=>page.evaluate(()=>window.explorerState.player.feet.slice());
 const measure=async(keys,ms=2000)=>{for(const k of keys)await page.keyboard.down(k);await page.waitForTimeout(400);const a=await feet();await page.waitForTimeout(ms);const b=await feet();for(const k of keys)await page.keyboard.up(k);await page.waitForTimeout(500);
  return {h:+(Math.hypot(b[0]-a[0],b[2]-a[2])/(ms/1000)).toFixed(2),dy:+(b[1]-a[1]).toFixed(2)};};
 const out={};
 out.walk=await measure(['KeyW']);out.sprint=await measure(['ShiftLeft','KeyW']);out.crouch=await measure(['ControlLeft','KeyW']);
 out.backSprint=await measure(['ShiftLeft','KeyS']);out.strafeSprint=await measure(['ShiftLeft','KeyD']);
 // Held Space for 4 s, sampling grounded every frame: count take-offs.
 await page.evaluate(()=>{const S=()=>window.explorerState.player;let ups=0,was=S().grounded,top=S().feet[1],y0=S().feet[1];const t0=performance.now();const times=[],lands=[];
  window.__samp=new Promise(r=>{const f=()=>{const g=S().grounded;top=Math.max(top,S().feet[1]);if(was&&!g){ups++;times.push(Math.round(performance.now()-t0));}if(!was&&g)lands.push(Math.round(performance.now()-t0));was=g;if(performance.now()-t0<4200)requestAnimationFrame(f);else r({ups,times,lands,apex:+(top-y0).toFixed(3)});};requestAnimationFrame(f);});});
 await page.waitForTimeout(100);await page.keyboard.down('Space');await page.waitForTimeout(4000);await page.keyboard.up('Space');
 out.heldJump=await page.evaluate(()=>window.__samp);
 await page.waitForTimeout(800);
 // Real key: tap Space twice quickly (second tap within the cooldown), then once after 1.3 s.
 const jumps=()=>page.evaluate(()=>window.explorerDev.motorState().jumps??null);
 await page.keyboard.down('ShiftLeft');await page.keyboard.down('KeyW');await page.waitForTimeout(600);const a=await feet();
 await page.keyboard.press('Space');await page.waitForTimeout(900);const b=await feet();await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');
 out.sprintJump={h:+(Math.hypot(b[0]-a[0],b[2]-a[2])/0.9).toFixed(2)};
 await shot(page,q.name??'64-move');
 out.log=logs.get('p1').filter(l=>l.type!=='http'&&!/401/.test(l.text)).slice(-5);
 return out;}
