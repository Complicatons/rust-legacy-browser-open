// Screenshots of the launcher window in its demo host (simulated website and gateway) for the roadmap:
// analysis/site-qa/launcher-{signup,signin,servers,playing}.png at the window's size (440×680, 2× pixels).
//   node tools/capture-launcher.mjs      (then npm run build:roadmap)
import {chromium} from 'playwright-core';
import {mkdir} from 'node:fs/promises';
import {launchOptions} from './qa-browser.mjs';
import {startLauncherPreview} from './launcher-preview.mjs';

const out='analysis/site-qa';
await mkdir(out,{recursive:true});
const server=await startLauncherPreview(0);
const url=`http://127.0.0.1:${server.address().port}/ui/index.html?demo`;
const browser=await chromium.launch(launchOptions());
try{
 const page=await browser.newPage({viewport:{width:440,height:680},deviceScaleFactor:2});
 await page.goto(url);
 await page.waitForSelector('.window[data-phase="signed-out"]');
 await page.evaluate(()=>document.fonts.ready);
 // Create account, with the two ticks (remember the login name, keep me signed in) and sample details typed in.
 // The mode switch fades its fill over 0.2 s (launcher.css .mode button): wait for it, or the capture shows the old tab lit.
 const settled=()=>page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished)));
 await page.click('#mode-register');await page.fill('#email','new.player@example.com');await page.fill('#username','Survivor2026');
 await settled();await page.screenshot({path:`${out}/launcher-signup.png`});
 await page.click('#mode-signin');
 await page.fill('#login','survivor');
 await settled();await page.screenshot({path:`${out}/launcher-signin.png`});
 await page.fill('#password','demo');
 await page.click('#signin-button');
 await page.waitForSelector('#servers .server');
 await page.click('#servers .server');
 await page.waitForTimeout(700);
 await page.screenshot({path:`${out}/launcher-servers.png`});
 await page.click('#connect');
 await page.waitForSelector('.window[data-phase="connected"]');
 await page.click('#launch');
 await page.waitForSelector('.window[data-phase="in-game"]');
 await page.waitForTimeout(900);
 await page.screenshot({path:`${out}/launcher-playing.png`});
 console.log(`Wrote ${out}/launcher-{signup,signin,servers,playing}.png`);
}finally{await browser.close();server.close();}
