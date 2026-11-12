// Closes p1 without its leave prompt (after the pagehide save) and opens /play again in the same profile, then joins
// the offline island from the front menu (fresh modules: picks up edited browser files). ?fresh=1 starts a new world.
export default async function({pages,newPage,env}){let page=pages.get('p1');const context=page.context();
 await page.evaluate(()=>dispatchEvent(new Event('pagehide'))).catch(()=>{});await page.close({runBeforeUnload:false});
 page=await newPage('p1',{context});await page.goto(env.origin+'/play'+(process.env.X??''),{waitUntil:'load'});await page.waitForFunction(()=>window.rlbFrontEnd?.state()?.menu,{},{timeout:60000});
 await page.locator('#front-end [data-df-name="btnPlay"]').click();await page.waitForTimeout(1200);
 await page.locator('#front-end [data-df-name="Community"]').click();await page.waitForTimeout(800);
 await page.locator('#front-end [data-address="offline"] [data-df-name="btnHostname"]').dblclick();
 await page.waitForFunction(()=>window.rlbFrontEnd.state().inGame&&window.explorerState?.frames>5,{},{timeout:300000,polling:250});await page.waitForTimeout(2500);
 return page.evaluate(()=>window.explorerState.player.feet);}
