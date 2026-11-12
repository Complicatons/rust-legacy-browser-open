const lib=()=>import('../lib.mjs?t='+Date.now());
// F1 console: suicide (offline global.suicide), then respawn from the death screen.
export default async function({pages,shot}){const {lock}=await lib();const page=pages.get('p1');await lock(page);const out={};
 await page.keyboard.press('F1');await page.waitForTimeout(400);await page.keyboard.type('suicide');await page.keyboard.press('Enter');await page.waitForTimeout(600);
 out.console=await page.evaluate(()=>[...document.querySelectorAll('#console *, .console *')].filter(e=>e.children.length===0).map(e=>e.textContent).filter(t=>/suicid|dead/i.test(t)).slice(-3));
 await page.keyboard.press('F1');await page.waitForTimeout(1500);out.vitals=await page.evaluate(()=>explorerState.vitals);
 out.reason=await page.evaluate(()=>document.querySelector('#death-reason')?.textContent);await shot(page,'41-suicide-death');
 await page.locator('#respawn').click();await page.waitForTimeout(2500);out.after=await page.evaluate(()=>({alive:!explorerState.vitals.dead,health:explorerState.vitals.health}));
 return out;}
