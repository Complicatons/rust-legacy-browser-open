const lib=()=>import('../lib.mjs?t='+Date.now());
// Fixed belt keys: spawn with empty hands, 1 takes the rock out, 1 again puts it away; food on the belt is eaten with
// the rock still out; offline `suicide` kills with the self-kill reason.
export default async function({pages,shot}){const {dev,lock,key}=await lib();const page=pages.get('p1');await lock(page);const out={};
 const vm=async()=>(await dev(page,'viewModel'))?.name??null;
 await page.waitForTimeout(500);out.spawn=await vm();await shot(page,'40-spawn-empty-hands');
 await key(page,'Digit1');await page.waitForTimeout(800);out.one=await vm();await key(page,'Digit1');await page.waitForTimeout(800);out.again=await vm();
 await key(page,'Digit1');await page.waitForTimeout(800);
 await dev(page,'giveItem','Cooked Chicken Breast',2);const food=await page.evaluate(()=>{const d=window.explorerDev;return d.hold('Cooked Chicken Breast');});
 await key(page,'Digit1');await page.waitForTimeout(600);const cal0=await page.evaluate(()=>explorerState.vitals.calories);
 await key(page,'Digit'+(food-29));await page.waitForTimeout(600);out.food={slot:food,vm:await vm(),calories:[Math.round(cal0),Math.round(await page.evaluate(()=>explorerState.vitals.calories))]};
 return out;}
