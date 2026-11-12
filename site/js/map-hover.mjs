// Island map hover labels: a short title and up to two lines for what is under the cursor (map-viewer.mjs draws them).
const AREA_M=200;
const TITLE={crate:'Loot crate',mutant:'Mutant zone',rad:'Radiation zone',animals:'Wildlife zone',resources:'Resource zone',nobuild:'No-build zone'};
const counts=list=>list.map(a=>`${a.name} ×${a.count}`).join(' · ');
const crateName=n=>n.replace(/ Loot( Box)?$/,'');

// The nearest named place within AREA_M metres, or null in open country.
export function areaAt(places,x,z){
 let best=null,bd=AREA_M;for(const p of places??[]){const d=Math.hypot(p.x-x,p.z-z);if(d<=bd){bd=d;best=p;}}
 return best;
}

// {title, lines} for a picked feature ({type:'crate'|'rad'|…|'place'|'point', …}), or null when there is nothing to say.
export function hoverLabel(f,places){
 if(!f)return null;
 if(f.type==='place'){const what=(f.features??[]).filter(n=>n!==f.title);return {title:f.title,lines:[what.length?what.join(' · '):null,f.rad?`${f.rad} rad/min`:null].filter(Boolean)};}
 const area=areaAt(places,f.x,f.z)?.title??null;
 if(f.type==='point')return area?{title:area,lines:[]}:null;
 const detail={
  crate:()=>f.crates.map(c=>`${crateName(c.name)} ${Math.round(c.chance*100)}%`).join(' · '),
  rad:()=>`${f.exposure} rad/min`,
  mutant:()=>counts(f.animals),
  animals:()=>counts(f.animals),
  resources:()=>counts(f.resources),
  nobuild:()=>'Nothing can be placed here',
 }[f.type];
 if(!detail)return null;
 return {title:TITLE[f.type],lines:[detail(),area].filter(Boolean)};
}
