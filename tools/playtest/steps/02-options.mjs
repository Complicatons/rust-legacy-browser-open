// Options: read the values a fresh profile shows, the key binds, quality and grass rows.
export default async function({pages,shot}){
 const page=pages.get('p1'),fe=()=>page.evaluate(()=>window.rlbFrontEnd.state());
 await page.locator('#front-end [data-df-name="btnOptions"]').click();
 await page.waitForFunction(()=>window.rlbFrontEnd.state().options);await page.waitForTimeout(600);
 await shot(page,'02-options');
 const s=await fe();
 const storage=await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k).slice(0,300)])));
 return {values:s.values,inert:s.inert,storage};
}
