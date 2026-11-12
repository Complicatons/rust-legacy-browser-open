import {inv,lock,hold,dev,hitches,count,key,closeInventory} from '../lib.mjs';
// Rock in hand: walk to the nearest tree and swing with real mouse holds; then a stone/ore node.
export default async function({pages,shot,logs}){
 const page=pages.get('p1');await closeInventory(page);const before=await inv(page);
 const locked=await lock(page);if((await dev(page,'viewModel'))?.name!=='VM-Rock'){await key(page,'Digit1');await page.waitForTimeout(1200);} // 1 again would put the rock away
 const trunk=await dev(page,'approachTree');await page.waitForTimeout(300);
 const aim=await dev(page,'aim');
 await hold(page,6000);await page.waitForTimeout(500);await shot(page,'05-tree');
 const afterTree=await inv(page);
 const st=await page.evaluate(()=>window.explorerState.resources);
 return {locked,trunk,aim:aim.hit,before,afterTree,wood:count(afterTree,'Wood'),swing:st.lastSwing,notices:st.notices,hitches:await hitches(page),log:logs.get('p1').slice(-5)};
}
