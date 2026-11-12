// Resource calculator maths (no DOM): what a list of crafted items costs, from the original recipes in
// /site/generated/wiki/recipes.json. Shared intermediates (gunpowder, explosives, planks…) are added up across the whole
// list before rounding to whole crafts, so leftovers are counted once.

// Standing at a workbench crafts everything this many times faster (CraftingInventory: crafting.workbench_speed, 3 by
// default; server owners can change it).
export const WORKBENCH_SPEED=3;

// recipes: [{slug, result:{slug, amount}, ingredients:[{slug, amount}], seconds, workbench}]
// wanted: [{slug, qty}]. breakdown: false stops at each wanted item's own ingredients.
// Returns {steps (craft order, ingredients first): [{slug, crafts, makes, seconds, workbench}],
//  base: [{slug, amount}] (largest first), leftovers: [{slug, amount}], seconds, crafts, workbench, unknown: [slug]}.
export function craftPlan(recipes,wanted,{breakdown=true}={}){
 const byResult=new Map(recipes.map(r=>[r.result.slug,r])),top=new Set(),demand=new Map(),unknown=[];
 const add=(slug,n)=>demand.set(slug,(demand.get(slug)??0)+n);
 for(const {slug,qty} of wanted){const n=Math.max(0,Math.floor(Number(qty)||0));if(!n)continue;if(!byResult.has(slug)&&!top.has(slug))unknown.push(slug);top.add(slug);add(slug,n);}
 const crafted=slug=>byResult.has(slug)&&(breakdown||top.has(slug));
 // Depth-first post-order over item → ingredient edges: every item comes after all of its ingredients.
 const post=[],seen=new Set(),walk=slug=>{if(seen.has(slug))return;seen.add(slug);if(crafted(slug))for(const g of byResult.get(slug).ingredients)walk(g.slug);post.push(slug);};
 for(const slug of top)walk(slug);
 const steps=[],base=new Map(),leftovers=[];
 for(const slug of [...post].reverse()){ // consumers before their ingredients, so each demand is complete
  const need=demand.get(slug)??0;if(!need)continue;
  if(!crafted(slug)){base.set(slug,(base.get(slug)??0)+need);continue;}
  const r=byResult.get(slug),crafts=Math.ceil(need/r.result.amount),makes=crafts*r.result.amount;
  for(const g of r.ingredients)add(g.slug,crafts*g.amount);
  steps.push({slug,crafts,makes,seconds:crafts*r.seconds,workbench:Boolean(r.workbench),...(r.cook?{cook:true,station:r.station}:{})});
  if(makes>need)leftovers.push({slug,amount:makes-need});
 }
 steps.reverse();
 // benchSeconds: the same crafting at a workbench, WORKBENCH_SPEED times faster (fires cook at their own pace).
 const seconds=steps.reduce((s,x)=>s+x.seconds,0),benchSeconds=steps.reduce((s,x)=>s+(x.cook?x.seconds:x.seconds/WORKBENCH_SPEED),0);
 return {steps,base:[...base].map(([slug,amount])=>({slug,amount})).sort((a,b)=>b.amount-a.amount||a.slug.localeCompare(b.slug)),leftovers,
  seconds:Math.round(seconds*100)/100,benchSeconds:Math.round(benchSeconds*100)/100,crafts:steps.reduce((s,x)=>s+x.crafts,0),workbench:steps.some(x=>x.workbench),unknown};
}

// Cooking as recipes: food that only comes from a fire (items.json cookedFrom, one for one) becomes a craft step at
// that fire. A camp fire cooks 2 of each of its 3 raw slots a minute, so about 10 s an item.
export const FIRE_SECONDS={campfire:10,furnace:5};
export function cookingRecipes(items){
 return items.filter(i=>i.type==='consumable').flatMap(i=>(i.cookedFrom??[]).filter(c=>!c.fuel&&c.min===1&&c.max===1).map(c=>({slug:'cook-'+i.slug,cook:true,station:c.station,
  result:{slug:i.slug,amount:1},ingredients:[{slug:c.slug,amount:1}],seconds:FIRE_SECONDS[c.station]??10,workbench:false})));
}

// What to put in the fire for the smelted and burnt base resources (items.json cookedFrom): ore ranges from a lucky to
// an unlucky furnace, and the wood that leaves the charcoal (per fire: camp fire 3 per wood, furnace 2.5).
export function smeltFor(base,items){
 const by=new Map(items.map(i=>[i.slug,i])),ore=[],fuel=[];
 for(const b of base)for(const c of by.get(b.slug)?.cookedFrom??[]){
  if(c.fuel)fuel.push({slug:c.slug,from:b.slug,station:c.station,amount:Math.ceil(b.amount/c.min)});
  else if(c.max>1)ore.push({slug:c.slug,from:b.slug,station:c.station,min:Math.ceil(b.amount/c.max),max:Math.ceil(b.amount/c.min)});}
 return {ore,fuel};
}

// "2 h 05 min", "3 min 20 s", "45 s", "0.5 s".
export function durationLabel(s){
 if(s<60)return `${Math.round(s*10)/10} s`;
 const t=Math.round(s),h=Math.floor(t/3600),m=Math.floor(t%3600/60),sec=t%60;
 return h?`${h} h ${String(m).padStart(2,'0')} min`:`${m} min${sec?` ${sec} s`:''}`;
}

// Shareable list: "explosive-charge*2,metal-door" ⇄ [{slug, qty}].
export const encodeBuild=list=>list.filter(x=>x.qty>0).map(x=>x.qty===1?x.slug:`${x.slug}*${x.qty}`).join(',');
export function decodeBuild(text){
 const out=new Map();
 for(const part of String(text??'').split(',')){const m=/^([a-z0-9-]+)(?:\*(\d{1,6}))?$/.exec(part.trim());if(m)out.set(m[1],(out.get(m[1])??0)+Number(m[2]??1));}
 return [...out].map(([slug,qty])=>({slug,qty}));
}
