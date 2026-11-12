// Forum page helpers without the DOM: routes, short times, page links, who-may-post notes, ban lengths.

// /forum → index, /forum/<category> → category, /forum/t/<id> → thread (id as a string), anything else → null.
export function forumRoute(pathname){
 const p=pathname.split('/').filter(Boolean);
 if(p[0]!=='forum')return null;
 if(p.length===1)return {view:'index'};
 if(p.length===2&&p[1]!=='t'&&/^[a-z0-9-]{1,32}$/.test(p[1]))return {view:'category',category:p[1]};
 if(p.length===3&&p[1]==='t'&&/^\d{1,12}$/.test(p[2]))return {view:'thread',id:p[2]};
 return null;
}

const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const dateLabel=ts=>{const d=new Date(ts);return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;};
// Short mono times: NOW, 5M, 3H, 12D, then the date.
export function ago(ts,now=Date.now()){
 const s=Math.max(0,(now-ts)/1000);
 if(s<60)return 'now';if(s<3600)return `${Math.floor(s/60)}m`;if(s<86400)return `${Math.floor(s/3600)}h`;if(s<30*86400)return `${Math.floor(s/86400)}d`;
 return dateLabel(ts);
}

// Page numbers to show: first, last, and two either side of the current page; null marks a gap.
export function pageList(page,pages){
 if(pages<=1)return [];
 const keep=new Set([1,pages]);for(let i=page-2;i<=page+2;i++)if(i>=1&&i<=pages)keep.add(i);
 const out=[];let prev=0;for(const n of [...keep].sort((a,b)=>a-b)){if(n-prev>1)out.push(null);out.push(n);prev=n;}
 return out;
}

// What the composer shows instead of the form, or null when the viewer may post here.
export function postGate(viewer,{staffOnly=false,locked=false}={}){
 if(!viewer)return {kind:'sign-in',text:'Sign in to post.'};
 if(!viewer.canPost)return {kind:'refused',text:{'username-required':'Choose a username on your account page to post.','forum-banned':'Your account cannot post on the forum right now.',banned:'This account is banned.'}[viewer.reason]??'You cannot post right now.'};
 if(staffOnly&&!viewer.staff)return {kind:'staff',text:'Only staff start threads here.'};
 if(locked&&!viewer.staff)return {kind:'locked',text:'Locked.'};
 return null;
}

export const BAN_LENGTHS=[['1','1 day'],['7','7 days'],['30','30 days'],['','Until removed']];
export const banUntil=ts=>ts==null?'Until removed':dateLabel(ts);
