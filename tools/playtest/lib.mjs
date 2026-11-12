// Shared helpers for playtest steps: read what a player sees (RPOS slots, HUD, notices), act with real input.
export const inv=page=>page.evaluate(()=>[...document.querySelectorAll('#inventory [data-slot]')].map(e=>{const img=e.querySelector('img');return img?{slot:+e.dataset.slot,item:img.alt,count:e.querySelector('.rpos-count')?.textContent??''}:null;}).filter(Boolean));
export const vitals=page=>page.evaluate(()=>({...window.explorerState.vitals,legInjury:window.explorerState.player.legInjury,notices:window.explorerState.resources.notices,pos:window.explorerState.player.feet}));
export const dev=(page,fn,...args)=>page.evaluate(([fn,args])=>window.explorerDev[fn](...args),[fn,args]);
// Clicks into the game (Pointer Lock stand-in) the way a player starts playing after the menu.
export async function lock(page){if(!await page.evaluate(()=>Boolean(document.pointerLockElement))){await page.mouse.click(640,360);await page.waitForTimeout(200);}return page.evaluate(()=>Boolean(document.pointerLockElement));}
export async function hold(page,ms,button='left'){await page.mouse.down({button});await page.waitForTimeout(ms);await page.mouse.up({button});}
export async function key(page,code,ms=60){await page.keyboard.down(code);await page.waitForTimeout(ms);await page.keyboard.up(code);}
export const hitches=page=>page.evaluate(()=>{const h=window.__hitches.splice(0);return h;});
export const count=(items,name)=>items.filter(i=>i.item===name).reduce((n,i)=>n+(+(i.count.replace(/\D/g,''))||1),0);
// Drags one RPOS cell onto another with the mouse (selectors), as a player would.
export async function drag(page,from,to){const a=await page.locator(from).boundingBox(),b=await page.locator(to).boundingBox();if(!a||!b)throw Error('drag: missing '+(a?to:from));
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(a.x+a.width/2+8,a.y+a.height/2,{steps:2});await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:10});await page.mouse.up();await page.waitForTimeout(150);}
export const slotOf=(items,name)=>items.find(i=>i.item===name)?.slot;
export async function closeInventory(page){if(await page.evaluate(()=>document.querySelector('#inventory')?.open)){await page.keyboard.press('Tab');await page.waitForTimeout(200);}}
