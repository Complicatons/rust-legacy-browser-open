// Offline save round trip: note the base (pieces, health, door open/closed and where its leaf is, box contents, bag),
// reload the page (pagehide writes the save), join the offline island again from the front menu, compare.
export default async function({pages,shot,logs,newPage}){let page=pages.get('p1');
 const snap=()=>page.evaluate(()=>{const d=window.explorerDev;return {
  structures:d.structures().map(c=>c.item+':'+Math.round(c.health)).sort().join(' '),
  deployables:d.deployables().map(o=>o.kind+':'+Math.round(o.health??0)+(o.kind==='door'?':'+o.center.map(v=>v.toFixed(2)).join('/'):'')+(o.slots?':'+o.slots.filter(Boolean).map(s=>s.item+s.uses).join('+'):'')).sort().join(' '),
  feet:window.explorerState.player.feet.map(v=>+v.toFixed(1))};});
 const before=await snap();await shot(page,'73-before-reload');
 // The in-game page asks before leaving (beforeunload) and the session dismisses dialogs, so: run the pagehide save,
 // close the tab without beforeunload and open the game again in the same browser profile (same localStorage).
 const url=page.url(),context=page.context();await page.evaluate(()=>dispatchEvent(new Event('pagehide')));await page.close({runBeforeUnload:false});
 page=await newPage('p1',{context});await page.goto(url,{waitUntil:'load'});await page.waitForFunction(()=>window.rlbFrontEnd?.state()?.menu,{},{timeout:60000});
 await page.locator('#front-end [data-df-name="btnPlay"]').click();await page.waitForTimeout(1200);
 await page.locator('#front-end [data-df-name="Community"]').click();await page.waitForTimeout(800);
 await page.locator('#front-end [data-address="offline"] [data-df-name="btnHostname"]').dblclick();
 await page.waitForFunction(()=>window.rlbFrontEnd.state().inGame&&window.explorerState?.frames>5,{},{timeout:300000,polling:250});await page.waitForTimeout(3000);
 const after=await snap();await shot(page,'73-after-reload');
 const same={};for(const k of Object.keys(before))same[k]=JSON.stringify(before[k])===JSON.stringify(after[k]);
 return {same,before,after,log:logs.get('p1').filter(l=>l.type!=='http'&&!/401/.test(l.text)).slice(-6)};}
