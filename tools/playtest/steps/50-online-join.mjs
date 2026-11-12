const lib=()=>import('../lib.mjs?t='+Date.now());
// Online: website dev sign-in (mock central only), then /play -> Play -> Community -> double-click Pilot.
export default async function({env,newPage,pages,logs,shot},q){const name=q.name??'p2',subject=q.subject??'playtester-a';
 const page=pages.get(name)??await newPage(name);await page.goto(env.origin+'/',{waitUntil:'load'});
 const r=await page.evaluate(async s=>{const r=await fetch('/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({subject:s,name:s})});return r.status;},subject);
 await page.goto(env.origin+'/play',{waitUntil:'load'});await page.waitForFunction(()=>window.rlbFrontEnd?.state()?.menu,{},{timeout:60000});
 await page.locator('#front-end [data-df-name="btnPlay"]').click();await page.locator('#front-end [data-df-name="Community"]').click();
 await page.waitForFunction(()=>window.rlbFrontEnd.state().rows.some(r=>r.name==='Pilot'),{},{timeout:30000});const rows=await page.evaluate(()=>window.rlbFrontEnd.state().rows);
 const pilot=rows.find(r=>r.name==='Pilot');const t0=Date.now();await page.locator(`#front-end [data-address="${pilot.address}"] [data-df-name="btnHostname"]`).dblclick();
 await page.waitForFunction(()=>window.explorerState?.online?.state==='in-game'&&window.explorerState.walk&&window.rlbFrontEnd.state().inGame&&!window.rlbFrontEnd.state().loading,{},{timeout:300000,polling:500});
 await page.waitForTimeout(2500);await shot(page,'50-online-'+name);
 const s=await page.evaluate(()=>({online:explorerState.online,feet:explorerState.player.feet,vitals:explorerState.vitals,belt:[...document.querySelectorAll('#belt [data-slot]')].map(e=>e.querySelector('img')?.alt??'')}));
 return {login:r,rows,ms:Date.now()-t0,s,log:logs.get(name).filter(l=>!/401/.test(l.text)).slice(-6)};}
