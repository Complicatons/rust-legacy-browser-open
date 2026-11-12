// Scroll Options with the wheel, rebind Up to K and back to W, set Render Quality Good, grass on, FPS on, apply.
export default async function({pages,shot}){
 const page=pages.get('p1'),fe=()=>page.evaluate(()=>window.rlbFrontEnd.state());
 const wait=async f=>{for(let i=0;i<100;i++){const s=await fe();if(f(s))return s;await page.waitForTimeout(50);}throw Error('timeout '+f);};
 const shotsTaken=[];
 await page.mouse.move(900,400);for(let i=0;i<6;i++){await page.mouse.wheel(0,120);await page.waitForTimeout(80);}
 await page.waitForTimeout(300);await shot(page,'03-options-scrolled');
 const cell=(n,i)=>page.locator(`#front-end [data-button="${n}"] [data-df-name="Sliced Sprite"]`).nth(i);
 await cell('Up',0).click();await wait(s=>s.listening==='Up');await page.keyboard.press('KeyK');const k=await wait(s=>!s.listening);
 await cell('Up',0).click();await wait(s=>s.listening==='Up');await page.keyboard.press('KeyW');const w=await wait(s=>!s.listening);
 for(let i=0;i<20;i++){await page.mouse.wheel(0,120);await page.waitForTimeout(40);}
 await page.waitForTimeout(300);await shot(page,'03-options-bottom');
 const boxes=await page.evaluate(()=>[...document.querySelectorAll('#front-end [data-option]')].map(e=>[e.dataset.option,JSON.stringify(e.getBoundingClientRect())]));
 await page.locator('#front-end [data-option="grass"] .df-dfCheckbox').click();await page.locator('#front-end [data-option="fps"] .df-dfCheckbox').click();
 for(let i=0;i<30;i++){await page.mouse.wheel(0,-120);await page.waitForTimeout(30);}
 {const q=page.locator('#front-end [data-convar="render.level"]'),b=await q.boundingBox();await q.click({position:{x:b.width*0.6,y:b.height/2}});}
 await page.waitForTimeout(300);await shot(page,'03-options-edited');
 const edited=(await fe()).values;
 await page.locator('#front-end [data-df-name="btnApply"]').click().catch(async()=>{await page.getByText('Apply Changes').click();});
 await page.waitForTimeout(500);
 return {up:[k.keys[2],w.keys[2]],boxes,edited,after:(await fe()).values,storage:await page.evaluate(()=>Object.keys(localStorage))};
}
