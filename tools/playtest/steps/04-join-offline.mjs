// Play -> server browser -> Community -> double-click the offline island; watch the loading screen until in game.
export default async function({pages,shot,logs}){
 const page=pages.get('p1'),fe=()=>page.evaluate(()=>window.rlbFrontEnd.state());
 await page.locator('#front-end [data-df-name="btnPlay"]').click();await page.waitForTimeout(1500);await shot(page,'04-servers-official');
 await page.locator('#front-end [data-df-name="Community"]').click();await page.waitForTimeout(800);await shot(page,'04-servers-community');
 const rows=(await fe()).rows;
 await page.locator('#front-end [data-address="offline"] [data-df-name="btnHostname"]').dblclick();
 const t0=Date.now(),infos=[];let shots=0;
 while(Date.now()-t0<300000){const st=await fe();if(infos.at(-1)?.[1]!==st.info)infos.push([Date.now()-t0,st.info,st.progress]);
  if(st.progress>0.3*(shots+1)&&shots<2){shots++;await shot(page,'04-loading-'+shots);}
  if(st.inGame&&await page.evaluate(()=>window.explorerState?.frames>5))break;await page.waitForTimeout(50);}
 await page.waitForTimeout(3000);await shot(page,'04-spawn');
 const s=await page.evaluate(()=>({walk:explorerState.walk,pos:explorerState.position,inv:explorerState.inventory??null,hitches:window.__hitches.slice(-20)}));
 return {rows,infos,ms:Date.now()-t0,s,log:logs.get('p1')};
}
