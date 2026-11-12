// Holds the left mouse button and reads the game's input state (which buttons the game sees held) while it is down.
export default async function({pages}){const page=pages.get('p1');
 const held=()=>page.evaluate(()=>window.explorerDev.input().held);
 const a=await held();await page.mouse.down();await page.waitForTimeout(300);const b=await held();
 const c=await page.evaluate(()=>({lock:Boolean(document.pointerLockElement),active:document.activeElement?.id||document.activeElement?.tagName}));
 await page.mouse.up();await page.waitForTimeout(100);return {before:a,during:b,after:await held(),c};}
