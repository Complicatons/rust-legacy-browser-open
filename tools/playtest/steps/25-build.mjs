const lib=()=>import('../lib.mjs?t='+Date.now());
// A one-room base with a second floor at the flat site: foundation, 4 pillars, 3 walls + doorway, door, ceiling,
// pillars + walls upstairs, a second foundation with stairs, then a box and a bag inside. Aim points as a player would.
export default async function({pages,shot}){const {dev,closeInventory,lock}=await lib();const page=pages.get('p1');await closeInventory(page);await lock(page);
 const out=await page.evaluate(async()=>{const d=window.explorerDev,wait=ms=>new Promise(r=>setTimeout(r,ms));
  for(const [n,c] of [['Wood Foundation',2],['Wood Pillar',8],['Wood Wall',6],['Wood Doorway',1],['Wooden Door',1],['Wood Ceiling',2],['Wood Stairs',1],['Wood Storage Box',1],['Sleeping Bag',1]])d.giveItem(n,c);
  d.setTime(11);d.teleport([5688,316.5,5148]);await wait(900);
  let f0=null;for(let i=0;i<6&&!f0?.placed;i++){if(i)d.walkAway(12);await wait(300);const e=d.aim().eye;d.aimPoint([e[0],e[1]-2.2,e[2]-5]);f0=d.placeAim('Wood Foundation');}
  if(!f0.placed)return {f0};await wait(400);const f=d.structures()[0].position,top=f[1]+4.02,cz=-f[2],out={foundation:true};
  const put=async(name,p)=>{d.aimPoint(p);await wait(40);const r=d.placeAim(name);await wait(400);return r?.placed??false;};
  out.pillars=[];for(const [dx,dz] of [[2.3,2.3],[-2.3,2.3],[2.3,-2.3],[-2.3,-2.3]])out.pillars.push(await put('Wood Pillar',[f[0]+dx,top,cz+dz]));
  out.walls=[await put('Wood Wall',[f[0],top,cz-2.3]),await put('Wood Wall',[f[0]-2.3,top,cz]),await put('Wood Wall',[f[0]+2.3,top,cz])];
  out.doorway=await put('Wood Doorway',[f[0],top,cz+2.3]);out.door=await put('Wooden Door',[f[0]+1.6,top+1.3,cz+2.5]);
  d.teleport([f[0],top-0.02,cz+2.0]);await wait(700);out.ceiling=false;
  for(const dz of [-2.5,-2,-1.5,-1,-0.5]){const eye=d.aim().eye,dy=Math.sqrt(16-dz*dz);out.ceiling=await put('Wood Ceiling',[f[0],eye[1]+dy,eye[2]+dz]);if(out.ceiling)break;}
  out.box=await put('Wood Storage Box',[f[0]-1.5,top+0.05,cz-1.5]);out.bag=await put('Sleeping Bag',[f[0]+1.2,top+0.05,cz-1.2]);
  out.pieces=d.structures().map(c=>c.item);out.f=f;return out;});
 await shot(page,'25-base-inside');return out;
}
