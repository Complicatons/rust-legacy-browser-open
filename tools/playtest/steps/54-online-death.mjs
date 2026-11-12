const lib=()=>import('../lib.mjs?t='+Date.now());
// Online suicide (server global.suicide via the mock referee), death screen, respawn.
export default async function({pages,shot}){const {lock}=await lib();const page=pages.get('p2'),out={};await lock(page);
 await page.keyboard.press('F1');await page.waitForSelector('#game-console:not([hidden])');await page.locator('#console-input').fill('suicide');await page.locator('#console-input').press('Enter');await page.waitForTimeout(500);await page.keyboard.press('F1');
 await page.waitForFunction(()=>explorerState.vitals.dead||explorerState.online.state==='dead',{},{timeout:10000}).catch(()=>{});await page.waitForTimeout(1500);
 out.dead=await page.evaluate(()=>({vitals:explorerState.vitals.dead,online:explorerState.online.state,reason:document.querySelector('#death-reason')?.textContent,camp:getComputedStyle(document.querySelector('#respawn-camp')).display}));await shot(page,'54-online-dead');
 await page.locator('#respawn').click();await page.waitForFunction(()=>explorerState.online.state==='in-game'&&!explorerState.vitals.dead,{},{timeout:30000});await page.waitForTimeout(1500);
 out.after=await page.evaluate(()=>({feet:explorerState.player.feet,belt:[...document.querySelectorAll('#belt [data-slot]')].map(e=>e.querySelector('img')?.alt??'')}));return out;}
