// Backups page: the save guard's copies of completed saves, the owner's own copies (kept until deleted), the server's own
// .sav.old.N rotation, and saves set aside by a repair or a restore. Restore needs the server stopped. GET /api/backups.
import {createOffsitePanel} from './offsite.mjs';
const $=id=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v!=null&&v!==false)e.setAttribute(k,v);}e.append(...kids.flat().filter(x=>x!=null&&x!==false));return e;};
const size=b=>b<0?'missing':b<1024?b+' B':b<1048576?(b/1024).toFixed(0)+' KB':(b/1048576).toFixed(1)+' MB';

export function createBackupsPage({api,toast,span,clock,serverNow}){
 let timer=null,visible=false;
 const offsite=createOffsitePanel({api,toast,span,clock,serverNow,onRestored:()=>load()});
 const when=t=>t?(serverNow()-t<12*3600e3?clock(t):new Date(t).toLocaleString()):'–';
 function confirmDialog(title,text,ok){
  const dlg=$('confirm');$('confirm-h').textContent=title;$('confirm-text').textContent=text;$('confirm-ok').textContent=ok;dlg.showModal();
  return new Promise(r=>dlg.addEventListener('close',()=>r(dlg.returnValue==='ok'),{once:true}));
 }
 async function load(){
  let d;try{d=await api('/api/backups');}catch(e){if(e.message!=='sign-in')toast('Could not load backups: '+e.message,'error');return;}
  if(!d.configured){$('bk-note').hidden=false;$('bk-note').textContent='No game server in host.json, so there are no saves to keep.';return;}
  const stopped=d.serverState==='stopped'||d.serverState==='failed';
  $('bk-note').hidden=stopped;$('bk-note').textContent=`The game server is ${d.serverState}${d.external?' (started outside the host)':''}. Restoring needs it stopped, so its next autosave cannot overwrite the copy you put back.`;
  const all=[...d.kept,...d.owner].sort((a,b)=>(b.at??0)-(a.at??0));
  $('bk-auto').textContent=String(d.kept.length);$('bk-own').textContent=String(d.owner.length);
  $('bk-newest').textContent=all[0]?.at?span(serverNow()-all[0].at):'–';$('bk-aside').textContent=String(d.setAside.length);
  $('bk-table').tBodies[0].replaceChildren(...all.map(b=>el('tr',{},
   el('td',{},el('span',{class:'name',text:when(b.at)}),b.label?el('span',{class:'sub',text:b.label}):null),
   el('td',{},el('span',{class:'tag'+(b.source==='owner'?' desktop':' browser'),text:b.source==='owner'?'You':'Watchdog'})),
   el('td',{class:'id',text:size(b.bytes)}),el('td',{class:'id',text:b.objects!=null?String(b.objects):'–'}),
   el('td',{},el('div',{class:'acts'},
    el('button',{class:'btn small',type:'button',text:'Restore',disabled:stopped?null:'',title:stopped?null:'Stop the game server first',onclick:async()=>{
     if(!await confirmDialog('Restore this save?',`The world goes back to ${when(b.at)}. The current save is set aside in the backups folder, not deleted, and the next start loads the restored one.`,'Restore'))return;
     try{const r=await api('/api/backups/restore',{method:'POST',body:{name:b.name}});toast(`Restored. ${r.setAside?'The previous save is set aside.':''} Start the server to load it.`);load();}catch(e){toast(e.message,'error');}}}),
    b.source==='owner'?el('button',{class:'btn small danger',type:'button',text:'Delete',onclick:async()=>{
     if(!await confirmDialog('Delete this copy?',`Your copy from ${when(b.at)} is removed for good.`,'Delete'))return;
     try{await api('/api/backups/delete',{method:'POST',body:{name:b.name}});toast('Copy deleted');load();}catch(e){toast(e.message,'error');}}}):null)))));
  $('bk-empty').hidden=all.length>0;
  const c=d.current;
  $('bk-current').replaceChildren(...[['File',c.name],['Size',size(c.bytes)],['Written',when(c.at)],['Now',d.saving?'the server is saving':'idle']].flatMap(([k,v])=>[el('dt',{text:k}),el('dd',{text:v})]));
  $('bk-rotation').replaceChildren(...(d.rotation.length?d.rotation.map(r=>el('li',{},el('time',{text:when(r.at)}),el('span',{text:`${r.name} · ${size(r.bytes)}`}))):[el('li',{class:'empty',text:'None yet. The server keeps up to six older saves next to its save file.'})]));
  $('bk-setaside').replaceChildren(...(d.setAside.length?d.setAside.slice(0,10).map(a=>el('li',{'data-level':a.kind==='damaged'?'warn':'info'},el('time',{text:a.kind==='damaged'?'repair':'restore'}),el('span',{text:`${a.name} · ${a.files.join(', ')}`}))):[el('li',{class:'empty',text:'Nothing set aside. Damaged saves the watchdog repairs, and saves a restore replaces, land here.'})]));
 }
 $('bk-keep').addEventListener('submit',async e=>{
  e.preventDefault();
  try{const k=await api('/api/backups/keep',{method:'POST',body:{label:$('bk-label').value}});$('bk-label').value='';toast(`Copy kept (${size(k.bytes)})`);load();}
  catch(x){toast(x.message,'error');}
 });
 return {
  show(){visible=true;load();offsite.show();clearInterval(timer);timer=setInterval(()=>{if(visible&&!document.hidden)load();},10000);},
  hide(){visible=false;clearInterval(timer);offsite.hide();},
 };
}
