const lib=()=>import('../lib.mjs?t='+Date.now());
// Walk a bit, move the Torch into the bag, Esc -> Disconnect, then join Pilot again: same place, same inventory.
export default async function({pages,shot}){const {lock,drag}=await lib();const page=pages.get('p2'),out={};await lock(page);
 await page.keyboard.down('KeyW');await page.waitForTimeout(2500);await page.keyboard.up('KeyW');await page.waitForTimeout(1500);
 await page.keyboard.press('Tab');await page.waitForSelector('#inventory[open]');const torch=await page.evaluate(()=>[...document.querySelectorAll('#belt [data-slot],#inventory [data-slot]')].find(e=>e.querySelector('img[alt="Torch"]'))?.dataset.slot);
 await drag(page,`[data-slot="${torch}"]`,'#inventory [data-slot="4"]');await page.waitForTimeout(800);await page.keyboard.press('Tab');
 const snap=()=>page.evaluate(()=>({feet:explorerState.player.feet.map(v=>+v.toFixed(2)),items:[...document.querySelectorAll('#belt [data-slot],#inventory [data-slot]')].filter(e=>e.querySelector('img')).map(e=>e.dataset.slot+':'+e.querySelector('img').alt+e.textContent.trim())}));
 out.before=await snap();
 await page.keyboard.press('Escape');await page.waitForTimeout(500);await page.waitForFunction(()=>window.rlbFrontEnd.state().menu);await shot(page,'53-esc-menu');
 await page.locator('#front-end [data-df-name="btnDisconnect"]').click();for(let i=0;i<300;i++){const ok=await page.evaluate(()=>{const s=window.rlbFrontEnd?.state();return Boolean(s&&s.menu&&!s.inGame);}).catch(()=>false);if(ok)break;await page.waitForTimeout(200);}await page.waitForTimeout(1000);
 out.menuAfter=await page.evaluate(()=>({menu:window.rlbFrontEnd.state().menu,disconnect:window.rlbFrontEnd.state().disconnect,online:window.explorerState?.online?.state??null}));
 await page.locator('#front-end [data-df-name="btnPlay"]').click();await page.locator('#front-end [data-df-name="Community"]').click();
 await page.waitForFunction(()=>window.rlbFrontEnd.state().rows.some(r=>r.name==='Pilot'));const addr=await page.evaluate(()=>window.rlbFrontEnd.state().rows.find(r=>r.name==='Pilot').address);
 await page.locator(`#front-end [data-address="${addr}"] [data-df-name="btnHostname"]`).dblclick();
 await page.waitForFunction(()=>window.explorerState?.online?.state==='in-game'&&window.explorerState.walk&&window.rlbFrontEnd.state().inGame&&!window.rlbFrontEnd.state().loading,{},{timeout:300000,polling:500});await page.waitForTimeout(2500);
 out.after=await snap();await shot(page,'53-reconnected');return out;}
