// Title-screen menu: ↑/↓ select, Enter opens, letter shortcuts (data-key) jump, hover selects. Links stay real links,
// so the menu also works with Tab, screen readers and without JavaScript.
export function createMenu(list,{onActivate=a=>{location.href=a.href;}}={}){
 const items=[...list.querySelectorAll('a')];let index=Math.max(0,items.findIndex(a=>a.hasAttribute('data-selected')));
 function select(i){index=(i+items.length)%items.length;items.forEach((a,k)=>a.toggleAttribute('data-selected',k===index));}
 select(index);
 items.forEach((a,k)=>{a.addEventListener('mouseenter',()=>select(k));a.addEventListener('focus',()=>select(k));});
 document.addEventListener('keydown',e=>{
  if(e.defaultPrevented||e.altKey||e.ctrlKey||e.metaKey||e.target.closest?.('input,textarea,select,[contenteditable],.user-menu'))return;
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();select(index+(e.key==='ArrowDown'?1:-1));if(document.activeElement?.closest?.('.ts-menu'))items[index].focus();return;}
  if(e.key==='Enter'&&!document.activeElement?.closest?.('a,button')){e.preventDefault();onActivate(items[index]);return;}
  const hit=items.findIndex(a=>a.dataset.key&&a.dataset.key.toLowerCase()===e.key.toLowerCase());
  if(hit>=0&&!e.shiftKey){e.preventDefault();select(hit);onActivate(items[hit]);}
 });
 return {select,get index(){return index;}};
}
