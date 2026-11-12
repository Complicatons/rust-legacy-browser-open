// Crops a saved region of the live page: ?page=p1&x=&y=&w=&h=&name=
export default async function({pages,shot,out},q){const page=pages.get(q.page??'p1');await page.screenshot({path:out+'/'+q.name+'.png',clip:{x:+q.x,y:+q.y,width:+q.w,height:+q.h}});return q.name;}
