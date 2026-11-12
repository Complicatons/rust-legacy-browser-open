const lib=()=>import('../lib.mjs?t='+Date.now());
// F1 console online: status (admin only: no answer), rcon.login, status, env.time 12, airdrop.drop; watch the plane.
export default async function({pages,env,shot}){const {lock}=await lib();const page=pages.get('p2'),out={};await lock(page);
 const f1=async c=>{if(await page.locator('#game-console').isHidden())await page.keyboard.press('F1');await page.waitForSelector('#game-console:not([hidden])');await page.locator('#console-input').fill(c);await page.locator('#console-input').press('Enter');await page.waitForTimeout(700);};
 const text=()=>page.evaluate(()=>document.querySelector('#game-console')?.innerText.split('\n').slice(-12).join(' | '));
 await f1('status');await f1('rcon.login '+env.rconPassword);await f1('status');await f1('env.time 12');await f1('airdrop.drop');out.console=await text();await shot(page,'52-console');
 await page.keyboard.press('F1');await page.waitForTimeout(500);
 for(let i=0;i<40;i++){const a=await page.evaluate(()=>window.explorerDev.airdrops?.()??null);out.air=a;if(a&&JSON.stringify(a).includes('position'))break;await page.waitForTimeout(500);}
 out.sky=await page.evaluate(()=>window.explorerDev.tod()?.hour);out.air=JSON.stringify(out.air).slice(0,400);return out;}
