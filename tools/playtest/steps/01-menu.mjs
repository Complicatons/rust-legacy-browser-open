// Fresh visit: website, Play, front menu.
export default async function({env,newPage,shot,logs}){
 const page=await newPage('p1');
 await page.goto(env.origin+'/play',{waitUntil:'load'});
 await page.waitForFunction(()=>window.rlbFrontEnd?.state()?.menu,{},{timeout:60000});
 await page.waitForTimeout(1500);
 await shot(page,'01-menu');
 const fe=await page.evaluate(()=>window.rlbFrontEnd.state());
 return {fe:JSON.stringify(fe).slice(0,1500),log:logs.get('p1')};
}
