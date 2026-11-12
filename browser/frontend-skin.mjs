import {cssUrl} from './asset-versions.mjs';
let shared;
// Only the recovered original atlas, logo and embedded fonts are used by the front end.
export function loadFrontendSkin({base='/assets/recovered/frontend/'}={}){return shared??=load(base);}
async function load(base){const response=await fetch(base+'manifest.json');if(!response.ok)throw Error('Original menu export is missing');const manifest=await response.json(),atlases=Object.values(manifest.atlases),fonts=Object.values(manifest.fonts);
 // The fonts download together and are added in export order.
 const faces=fonts.filter(f=>f.kind==='dynamic').map(font=>new FontFace(font.name,`url("${base+font.file}")`));await Promise.all(faces.map(face=>face.load()));for(const face of faces)document.fonts.add(face);
 const sprite=name=>{const s=atlases.map(a=>a.sprites[name]).find(Boolean);return s?base+s.file:null;};
 for(const name of ['window_background','menu_background','button_normal','button_hover','button_down','text_input'])document.documentElement.style.setProperty('--legacy-'+name.replaceAll('_','-'),cssUrl(sprite(name)));
 const logo=manifest.screens.MainMenu.nodes.flatMap(n=>n.components.dfTextureSprite??[]).find(d=>d.textureFile);
 const bitmap=fonts.find(f=>f.kind==='bitmap'),fontImage=new Image();fontImage.src=base+manifest.atlases[bitmap.atlas].sprites[bitmap.sprite].file;await fontImage.decode();const glyphs=new Map(bitmap.glyphs.map(g=>[g.id,g]));
 function text(element,value){element.textContent=value;const canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');const gs=[...value].map(c=>glyphs.get(c.charCodeAt(0))).filter(Boolean);canvas.width=Math.max(1,gs.reduce((n,g)=>n+g.xadvance,0));canvas.height=bitmap.lineHeight;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;let x=0;for(const g of gs){ctx.drawImage(fontImage,g.x,g.y,g.width,g.height,x+g.xoffset,g.yoffset,g.width,g.height);x+=g.xadvance;}element.classList.add('legacy-bitmap');element.append(canvas);}
 return {manifest,base,sprite,logo:base+logo.textureFile,text};
}
