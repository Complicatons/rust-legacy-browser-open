// Restricted markdown for wiki articles (shared by central and the editor's live preview). Supports # ## ### (rendered
// as h2–h4 under the page title), paragraphs, - and 1. lists, **bold**, *em*, `code`, fenced code, links to the site or
// https, images from /site/ only, pipe tables and [[item:Name]] / [[place:Name]] embeds. Every piece of text is
// escaped; raw HTML never passes through.
const ESC={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
export const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>ESC[c]);

// Site paths (not "//host", and not "/\host", which browsers read the same way) or https.
const safeHref=u=>/^\/(?![/\\])/.test(u)&&!u.includes('\\')||/^https:\/\/[^\s/]/i.test(u)?u:null;
const safeSrc=u=>/^\/site\/(?!.*\.\.)[^\s]*$/.test(u)?u:null;
const URL_PART=String.raw`((?:[^()\s]|\([^()\s]*\))+)`; // one level of balanced parentheses
const INLINE=new RegExp(String.raw`\x60([^\x60]+)\x60|\[\[(item|place):([^\]\n]{1,80})\]\]|!\[([^\]\n]*)\]\(${URL_PART}\)|\[([^\]\n]+)\]\(${URL_PART}\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*`,'g');

function inline(s,opt,links=true){
 let out='',last=0;
 for(const m of s.matchAll(INLINE)){
  out+=escapeHtml(s.slice(last,m.index));last=m.index+m[0].length;
  const [all,code,kind,name,alt,src,text,href,bold,em]=m;
  if(code!==undefined)out+=`<code>${escapeHtml(code)}</code>`;
  else if(kind)out+=embed(kind,name.trim(),opt);
  else if(src!==undefined){const ok=safeSrc(src);if(ok)out+=`<img src="${escapeHtml(ok)}" alt="${escapeHtml(alt)}" loading="lazy">`;}
  else if(text!==undefined){const ok=links&&safeHref(href),inner=inline(text,opt,false);
   out+=ok?`<a href="${escapeHtml(ok)}"${ok.startsWith('/')?'':' rel="nofollow noopener" target="_blank"'}>${inner}</a>`:inner;}
  else if(bold!==undefined)out+=`<strong>${inline(bold,opt,links)}</strong>`;
  else if(em!==undefined)out+=`<em>${inline(em,opt,links)}</em>`;
  else out+=escapeHtml(all);
 }
 return out+escapeHtml(s.slice(last));
}
function embed(kind,name,{resolveItem,resolvePlace}){
 if(kind==='item'){const it=resolveItem?.(name);if(it)return `<a class="wiki-item" href="/wiki/items/${escapeHtml(it.slug)}">${it.icon&&safeSrc(it.icon)?`<img src="${escapeHtml(it.icon)}" alt="" loading="lazy">`:''}${escapeHtml(it.name)}</a>`;}
 else{const p=resolvePlace?.(name);if(p&&Number.isFinite(p.x)&&Number.isFinite(p.z))return `<a class="wiki-place" href="/island?x=${Math.round(p.x)}&amp;z=${Math.round(p.z)}&amp;zoom=4">${escapeHtml(p.title)}</a>`;}
 return `<span class="wiki-missing">${escapeHtml(name)}</span>`;
}

const cells=line=>line.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
export function renderMarkdown(src,opt={}){
 const lines=String(src??'').replace(/\r\n?/g,'\n').split('\n'),out=[];let i=0;
 const para=[];const flush=()=>{if(para.length){out.push(`<p>${inline(para.join(' '),opt)}</p>`);para.length=0;}};
 while(i<lines.length){
  const line=lines[i];
  if(/^```/.test(line)){flush();const body=[];i++;while(i<lines.length&&!/^```/.test(lines[i]))body.push(lines[i++]);i++;out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);continue;}
  const h=/^(#{1,3})\s+(.*)$/.exec(line);
  if(h){flush();const n=h[1].length+1;out.push(`<h${n}>${inline(h[2].trim(),opt)}</h${n}>`);i++;continue;}
  if(/^\s*\|.*\|\s*$/.test(line)&&/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[i+1]??'')){
   flush();const head=cells(line);i+=2;const rows=[];while(i<lines.length&&/^\s*\|.*\|\s*$/.test(lines[i]))rows.push(cells(lines[i++]));
   out.push(`<table><thead><tr>${head.map(c=>`<th>${inline(c,opt)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${head.map((_,j)=>`<td>${inline(r[j]??'',opt)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);continue;}
  const li=/^\s*(-|\d+\.)\s+(.*)$/.exec(line);
  if(li){flush();const ordered=li[1]!=='-',tag=ordered?'ol':'ul',items=[];
   while(i<lines.length){const m=/^\s*(-|\d+\.)\s+(.*)$/.exec(lines[i]);if(!m||(m[1]!=='-')!==ordered)break;items.push(`<li>${inline(m[2],opt)}</li>`);i++;}
   out.push(`<${tag}>${items.join('')}</${tag}>`);continue;}
  if(!line.trim()){flush();i++;continue;}
  para.push(line.trim());i++;
 }
 flush();
 return out.join('');
}

// "---" front matter of key: value lines (values may be quoted) before a markdown body.
export function parseFrontMatter(src){
 const s=String(src??'').replace(/\r\n?/g,'\n'),m=/^---\n([\s\S]*?)\n---\n?/.exec(s);
 if(!m)return {meta:{},body:String(src??'')};
 const meta={};
 for(const line of m[1].split('\n')){const kv=/^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);if(!kv)continue;let v=kv[2].trim();
  if(/^(["']).*\1$/.test(v))v=v.slice(1,-1);meta[kv[1]]=v;}
 return {meta,body:s.slice(m[0].length).replace(/^\n+/,'')};
}
