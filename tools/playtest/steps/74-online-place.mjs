const lib=()=>import('../lib.mjs?t='+Date.now());
// Online: belt key ?key (e.g. Digit4) takes the item out (DoBeltUse -> server IAST), look ?pitch down, click; report
// what the server spawned near the player (onlineFires/onlineProps/onlineBuildings) and the inventory.
export default async function({pages,shot},q){const {lock,closeInventory,key,dev}=await lib();const page=pages.get('p1');await closeInventory(page);await lock(page);
 if(q.key){await key(page,q.key);await page.waitForTimeout(1300);}
 await page.evaluate(p=>window.explorerDev.face(window.explorerDev.controls().yaw??0,p),+(q.pitch??-0.5));await page.waitForTimeout(400);
 const prev=await dev(page,'placementPreview');await shot(page,'74-online-preview');
 const count=()=>page.evaluate(()=>{const d=window.explorerDev;return {fires:d.onlineFires().length,props:d.onlineProps().length,buildings:JSON.stringify(d.onlineBuildings?.()??null).length};});
 const c0=await count();await page.mouse.down();await page.waitForTimeout(80);await page.mouse.up();await page.waitForTimeout(1500);
 return {prev:JSON.stringify(prev).slice(0,200),c0,c1:await count(),vm:(await dev(page,'viewModel'))?.name,inv:await page.evaluate(()=>[...document.querySelectorAll('#belt [data-slot],#inventory [data-slot]')].filter(e=>e.querySelector('img')).map(e=>e.dataset.slot+':'+e.querySelector('img').alt+e.textContent.trim())),notices:(await page.evaluate(()=>window.explorerState.resources.notices)).slice(-2),popups:(await dev(page,'popupNotices')).slice(-2)};}
