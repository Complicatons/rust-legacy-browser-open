// Download boxes for the host app installer and the game loader: the release the website serves (central/downloads.mjs,
// /downloads/<kind>/latest.json). The host app checks the manifest's signature itself; here it only fills in the numbers.
export const KINDS={
 host:{product:'rust-legacy-host',label:'Download for Windows',docs:'/docs/install-the-host-app'},
 loader:{product:'rust-legacy-loader',label:'Download for Windows',docs:'/docs/the-game-loader'},
};
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(v!=null&&v!==false)e.setAttribute(k,v);}e.append(...kids.flat().filter(Boolean));return e;};

export function releaseFacts(envelope,product=KINDS.host.product){
 try{const m=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(envelope.manifest),c=>c.charCodeAt(0))));if(m.format!=='rlb-installer-1'||m.product!==product||!/^\d+\.\d+\.\d+$/.test(m.version))return null;
  return {version:m.version,file:m.file,mb:(m.bytes/1048576).toFixed(m.bytes<10*1048576?1:0),sha256:m.sha256,signed:m.signed===true,signer:m.signer??null,date:new Date(m.publishedAt).toISOString().slice(0,10)};}catch{return null;}
}

export async function downloadBox(kind){
 const k=KINDS[kind];
 const r=await fetch(`/downloads/${kind}/latest.json`,{cache:'no-cache'}).then(x=>x.ok?x.json():null).catch(()=>null),f=r&&releaseFacts(r,k.product);
 if(!f)return el('section',{class:'dl-box',id:'download-'+kind,'aria-label':'Download'},el('div',{class:'dl-stats'},el('div',{},el('b',{text:'Soon'}),el('span',{text:kind==='host'?'installer':'download'}))),
  el('p',{class:'dl-note',text:'Not published yet. Ask in our Discord for the test build.'}));
 return el('section',{class:'dl-box',id:'download-'+kind,'aria-label':'Download'},
  el('div',{class:'dl-stats'},el('div',{},el('b',{text:f.version}),el('span',{text:'version'})),el('div',{},el('b',{text:f.mb+' MB'}),el('span',{text:'download'})),
   el('div',{},el('b',{text:f.signed?'Signed':'Unsigned',class:f.signed?'':'warn'}),el('span',{text:f.signed&&f.signer?f.signer:'code signature'})),el('div',{},el('b',{text:f.date}),el('span',{text:'released'}))),
  el('div',{class:'dl-act'},el('a',{class:'btn-play',href:'/download/'+kind},el('span',{text:k.label})),
   el('code',{class:'dl-sha',text:'SHA-256 '+f.sha256}),
   el('a',{class:'dl-sum mono',href:`/downloads/${kind}/${f.file}.sha256`,text:f.file+'.sha256'})));
}
