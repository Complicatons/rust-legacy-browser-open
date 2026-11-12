import {inv,hitches} from '../lib.mjs';
// Tab opens the RPOS inventory; pick a blueprint by its row text, craft (and optionally cancel part-way).
export default async function({pages,shot},q){
 const page=pages.get('p1');
 if(!await page.evaluate(()=>document.querySelector('#inventory')?.open)){await page.keyboard.press('Tab');await page.waitForSelector('#inventory[open]');}
 await page.waitForTimeout(400);
 const rows=await page.evaluate(()=>[...document.querySelectorAll('#blueprint-list [data-blueprint]')].map(b=>b.textContent.trim()));
 if(!q.name)return {rows};
 await page.locator('#blueprint-list [data-blueprint]',{hasText:q.name}).first().click();await page.waitForTimeout(200);
 if(q.amount){await page.locator('#craft-amount').fill(q.amount);await page.locator('#craft-amount').press('Tab');}
 const info=await page.evaluate(()=>({details:document.querySelector('#craft-ingredients')?.innerText,craft:document.querySelector('#craft').textContent,disabled:document.querySelector('#craft').disabled}));
 await shot(page,'08-craft-'+q.name.replace(/\W/g,''));
 await page.locator('#craft').click();await page.waitForTimeout(300);
 const started=await page.evaluate(()=>({craft:document.querySelector('#craft').textContent,status:document.querySelector('#craft-status')?.textContent,progress:document.querySelector('#craft-progress')?.value}));
 if(q.cancel){await page.waitForTimeout(+q.cancel);await page.locator('#craft').click();await page.waitForTimeout(300);}
 else await page.waitForFunction(()=>document.querySelector('#craft').textContent==='Craft',{},{timeout:+(q.timeout??60000)});
 await shot(page,'08-crafted-'+q.name.replace(/\W/g,''));
 const done=await page.evaluate(()=>({craft:document.querySelector('#craft').textContent,status:document.querySelector('#craft-status')?.textContent}));
 return {info,started,done,inv:(await inv(page)).map(x=>x.slot+':'+x.item+x.count).join(' '),hitches:await hitches(page)};
}
