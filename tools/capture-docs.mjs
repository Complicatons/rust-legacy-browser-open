// Annotated screenshots for the help pages (site/content/docs): the real screens on demo data, with numbered orange
// circles drawn around the buttons and fields a page talks about. Output: site/content/docs/images/<name>.jpg,
// referenced from the markdown as ![…](/site/content/docs/images/<name>.jpg) with a numbered list under each picture.
// Re-run after a screen changes; a missing selector fails loudly instead of drawing a circle in the wrong place.
//   node tools/capture-docs.mjs [loader] [host]        (BROWSER_PATH overrides the browser, as the other checks)
import {chromium} from 'playwright-core';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startLauncherPreview} from './launcher-preview.mjs';
import {launchOptions} from './qa-browser.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
export const OUT=join(root,'site','content','docs','images');

// Draws the marks in the page itself (an SVG over everything, no pointer events), so they line up with the layout
// exactly. marks: [{sel, n, pad?, nth?}]; every selector must match a visible element.
export async function annotate(page,marks){
 const missing=await page.evaluate(marks=>{
  document.getElementById('rlb-doc-marks')?.remove();
  const NS='http://www.w3.org/2000/svg',svg=document.createElementNS(NS,'svg');
  svg.id='rlb-doc-marks';Object.assign(svg.style,{position:'fixed',inset:'0',width:'100vw',height:'100vh',pointerEvents:'none',zIndex:'2147483647'});
  const el=(tag,attrs,parent=svg)=>{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);parent.append(e);return e;};
  const lost=[];
  for(const m of marks){
   const t=[...document.querySelectorAll(m.sel)].filter(e=>e.getClientRects().length)[m.nth??0];
   if(!t){lost.push(m.sel);continue;}
   const r=t.getBoundingClientRect(),p=m.pad??6,x=r.left-p,y=r.top-p,w=r.width+2*p,h=r.height+2*p;
   // A dark halo under the orange ring keeps it readable on any background.
   el('rect',{x,y,width:w,height:h,rx:Math.min(14,h/2),fill:'none',stroke:'rgba(0,0,0,.65)','stroke-width':7});
   el('rect',{x,y,width:w,height:h,rx:Math.min(14,h/2),fill:'none',stroke:'#ff7a1a','stroke-width':3});
   // The number sits just left of the ring, at its middle, so it never covers a label above the field; at the
   // left edge of the picture it falls back to the ring's top-left corner.
   const left=x-20>=16,cx=left?x-20:Math.max(16,x),cy=left?y+h/2:Math.max(16,y);
   el('circle',{cx,cy,r:14,fill:'#ff7a1a',stroke:'#0a0a0a','stroke-width':3});
   const tx=el('text',{x:cx,y:cy+5,'text-anchor':'middle','font-family':'Arial, sans-serif','font-weight':'800','font-size':15,fill:'#0a0a0a'});tx.textContent=String(m.n);
  }
  document.body.append(svg);
  return lost;
 },marks);
 if(missing.length)throw Error('no visible element for: '+missing.join(', '));
}
export const clearMarks=page=>page.evaluate(()=>document.getElementById('rlb-doc-marks')?.remove());

const shot=async(target,name,opts={})=>{await target.screenshot({path:join(OUT,name+'.jpg'),type:'jpeg',quality:86,...opts});console.log('wrote',name+'.jpg');};

// The game loader in its demo host, at its real window width, sized to each step as the app sizes its window.
async function loader(browser){
 const server=await startLauncherPreview(0);
 const page=await browser.newPage({viewport:{width:520,height:900},deviceScaleFactor:2});
 try{
  await page.goto(`http://127.0.0.1:${server.address().port}/ui/index.html?demo`);
  await page.waitForSelector('.window[data-phase="signed-out"]');await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>{window.__h=0;const h=window.launcherDemo.host,r=h.report;h.report=s=>{if(s.height)window.__h=s.height;r(s);};});
  const frame=async(name,marks)=>{
   await page.waitForTimeout(800);
   await page.evaluate(()=>{const w=document.querySelector('.window');w.style.height=window.__h+'px';});
   await annotate(page,marks);await shot(page.locator('.window'),name);await clearMarks(page);
   await page.evaluate(()=>document.querySelector('.window').style.height='');
  };
  await page.click('#mode-register');
  await page.fill('#email','new.player@example.com');await page.fill('#username','Survivor2026');
  await frame('loader-create-account',[{sel:'#mode-register',n:1},{sel:'#email',n:2},{sel:'#username',n:3},{sel:'#password',n:4},{sel:'label.check',n:5,nth:0},{sel:'label.check',n:6,nth:1},{sel:'#signin-button',n:7}]);
  await page.click('#mode-signin');await page.fill('#login','survivor');
  await frame('loader-sign-in',[{sel:'#mode-signin',n:1},{sel:'#login',n:2},{sel:'#password',n:3},{sel:'#device-start',n:4}]);
  await page.fill('#password','demo');await page.click('#signin-button');
  await page.waitForSelector('#servers .server');await page.click('#servers .server');
  await frame('loader-servers',[{sel:'#servers .server',n:1},{sel:'#connect',n:2}]);
  await page.click('#connect');await page.waitForSelector('.window[data-phase="connected"]');
  await frame('loader-launch',[{sel:'#launch',n:1}]);
  await page.click('#launch');await page.waitForSelector('.window[data-phase="in-game"]');
  await frame('loader-in-game',[{sel:'.readout',n:1},{sel:'#ro-connect',n:2}]);
 }finally{await page.close();server.close();}
}

const main=process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1];
if(main){
 const want=process.argv.slice(2),all=!want.length;
 mkdirSync(OUT,{recursive:true});
 const browser=await chromium.launch(launchOptions());
 try{
  if(all||want.includes('loader'))await loader(browser);
  if(all||want.includes('host')){const {captureHost}=await import('./capture-docs-host.mjs');await captureHost(browser,{annotate,clearMarks,shot});}
 }finally{await browser.close();}
}
