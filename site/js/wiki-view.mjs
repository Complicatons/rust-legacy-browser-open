// Wiki page helpers without the DOM: sections, search ranking, property rows and labels.
export const SECTIONS=[
 {id:'guides',label:'Guides'},{id:'items',label:'Items'},{id:'recipes',label:'Crafting'},{id:'building',label:'Building'},{id:'raiding',label:'Raiding'},
 {id:'animals',label:'Animals'},{id:'resources',label:'Resources'},{id:'places',label:'Places'},{id:'radiation',label:'Radiation'},
];
export const ARTICLE_SECTIONS=[...new Set(['guides','news',...SECTIONS.map(s=>s.id)])];
export const TYPE_LABEL={weapon:'Weapon',ammo:'Ammo',armour:'Armour',consumable:'Food',medical:'Medical',resource:'Resource',tool:'Tool',
 deployable:'Deployable',structure:'Structure',mod:'Weapon mod',explosive:'Explosive',misc:'Part'};

export function routeOf(pathname){const p=pathname.split('/').filter(Boolean);return {section:p[1]??null,slug:p[2]??null};}

// Exact title, title prefix, a word in the title, anywhere in the title, then keywords; shorter titles first.
export function rankSearch(index,query,{limit=8}={}){
 const q=query.trim().toLowerCase();if(!q)return [];
 const scored=[];
 for(const e of index){const t=e.t.toLowerCase();
  const s=t===q?0:t.startsWith(q)?1:t.split(/[\s-]+/).some(w=>w.startsWith(q))?2:t.includes(q)?3:(e.k??'').split(/\s+/).some(w=>w.startsWith(q))?4:-1;
  if(s>=0)scored.push([s,e]);}
 return scored.sort((a,b)=>a[0]-b[0]||a[1].t.length-b[1].t.length||a[1].t.localeCompare(b[1].t)).slice(0,limit).map(x=>x[1]);
}

const range=v=>Array.isArray(v)?(v[0]===v[1]?String(v[0]):`${v[0]}–${v[1]}`):v;
const yes=v=>v?'Yes':undefined;
const PROPS=[['stack','Stack'],['uses','Uses'],['damage','Damage',v=>range(v)],['fireRate','Fire rate',v=>`${v} s`],['clip','Clip'],['range','Range',v=>`${v} m`],['pellets','Pellets'],['effectiveRange','Bullet range',v=>`${v} m`],
 ['heardFrom','Heard from',v=>`${v} m`],['recoil','Recoil',v=>`${v[0]}–${v[1]}°`],['readySeconds','Ready time',v=>`${v} s`],['modSlots','Mod slots',v=>v?`0–${v}, rolled per gun`:'None'],['caloriesPerSwing','Calories per swing'],
 ['ammo','Ammo',(v,o)=>({text:o.nameOf?.(v)??v,href:'/wiki/items/'+v})],['arrowSpeed','Arrow speed',v=>`${v} m/s`],['drawSeconds','Draw time',v=>`${v} s`],['semiAuto','Semi-auto',yes],
 ['calories','Calories'],['water','Water',v=>`${v} L`],['heal','Heals',v=>Array.isArray(v)?range(v):v],['antiRads','Anti-rads'],['poison','Poison'],['stopsBleeding','Stops bleeding',yes],
 ['bloodTaken','Blood taken'],['flammable','Flammable',yes],['cookable','Cookable',yes],['researchable','Researchable',yes],['repairable','Repairable',yes],['recyclable','Recyclable',yes]];
export function propRows(item,opt={}){const p=item.props??{},rows=[];
 for(const [k,label,fmt] of PROPS){if(p[k]===undefined||p[k]===null)continue;const v=fmt?fmt(p[k],opt):p[k];if(v!==undefined)rows.push([label,v]);}
 return rows;}
const DAMAGE_TYPES=[['generic','Generic'],['bullet','Bullet'],['melee','Melee'],['explosion','Explosion'],['radiation','Radiation'],['cold','Cold']];
export const protectionRows=prot=>DAMAGE_TYPES.filter(([k])=>prot?.[k]!=null).map(([k,l])=>[l,prot[k]]);

export function chanceLabel(c){if(c==null)return '—';const pct=c*100;return pct<0.1?'<0.1%':`${Math.round(pct*10)/10}%`;}
export const chargesLabel=n=>n==null?'Immune':String(n);
export const shortHash=h=>h?String(h).slice(0,12):'';

// Guides (site/content/guides/*.md) are shown in these groups, in this order; unknown groups follow.
export const GUIDE_GROUPS=['Start here','Survival','Gathering & crafting','Building','Combat & raiding','The world'];
// The front-matter picture heads the guide unless the text already shows it as a figure.
export const featuredGuides=list=>list.filter(g=>g.featured!=null).sort((a,b)=>a.featured-b.featured);
export const guideHero=(image,body)=>image&&!String(body).includes(`](${image})`)?image:null;
export function groupGuides(list){
 const groups=new Map();for(const g of list){const k=g.group||'More';if(!groups.has(k))groups.set(k,[]);groups.get(k).push(g);}
 const rank=k=>{const i=GUIDE_GROUPS.indexOf(k);return i<0?GUIDE_GROUPS.length:i;};
 return [...groups.entries()].sort((a,b)=>rank(a[0])-rank(b[0])||a[0].localeCompare(b[0])).map(([k,v])=>[k,v.sort((a,b)=>(a.order??99)-(b.order??99)||a.title.localeCompare(b.title))]);
}
