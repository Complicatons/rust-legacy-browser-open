const lib=()=>import('../lib.mjs?t='+Date.now());
// Back to the camp fire; top up materials (dev giveItem stands in for more gathering); daytime for screenshots.
export default async function({pages},q){const {dev}=await lib();
 const page=pages.get('p1');const fire=(await dev(page,'deployables'))[0];
 await dev(page,'teleport',[fire.center[0]+3,fire.center[1]+1,fire.center[2]+3]);await dev(page,'setTime',+(q.hour??11));
 const give=JSON.parse(q.give??'{}');const out={};for(const [n,a] of Object.entries(give))out[n]=await dev(page,'giveItem',n,a);
 return out;
}
