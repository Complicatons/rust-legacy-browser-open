const lib=()=>import('../lib.mjs?t='+Date.now());
// Door code lock as the owner: hold E -> Change Lock, type ?code + Enter, hold E -> Lock; then E toggles the door.
export default async function({pages,shot},q){const {lock,closeInventory,dev}=await lib();const page=pages.get('p1');await closeInventory(page);await lock(page);const out={};
 const wait=ms=>page.waitForTimeout(ms);const di=(await dev(page,'deployables')).findIndex(d=>d.kind==='door');
 const menu=async label=>{await lock(page);await dev(page,'approachDeployable',di);await wait(300);await page.keyboard.down('KeyE');await wait(700);const ui=(await dev(page,'contextUI')).ui;const b=ui.buttons.find(b=>b.text===label);
  if(b){await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:4});await page.mouse.down();await page.mouse.up();}await page.keyboard.up('KeyE');await wait(600);return ui.buttons.map(b=>b.text);};
 out.m1=await menu('Change Lock');out.entry=await page.evaluate(()=>{const e=document.querySelector('#lock-entry,[id*=lock]');return e?{id:e.id,visible:e.checkVisibility?.(),text:e.innerText.slice(0,120)}:null;});
 await shot(page,'72-lock-entry');await page.keyboard.type(q.code??'1234');await page.keyboard.press('Enter');await wait(600);
 out.popups1=(await dev(page,'popupNotices')).slice(-2);
 out.m2=await menu('Lock');out.popups2=(await dev(page,'popupNotices')).slice(-2);out.m3=await menu('Open');
 const d=(await dev(page,'deployables'))[di];out.door={center:d.center};await shot(page,'72-lock-after');
 return out;}
