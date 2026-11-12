// Roadmap search (no DOM): the lower-case text an entry is searched by, and a matcher for what the reader typed.
const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];

// "21 october 2026 21 oct" for a YYYY-MM-DD date, so readers can search by day.
function dateWords(d){
 const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(d??'');if(!m)return '';const month=MONTHS[Number(m[2])-1]??'',day=String(Number(m[3]));
 return `${day} ${month} ${m[1]} ${day} ${month.slice(0,3)}`;
}
// Markdown to plain words: link text kept, URLs and formatting marks dropped.
const plain=md=>String(md??'').replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/[#*`_>|~\[\]()]/g,' ');

// Title, summary, body, stats, picture and clip captions and dates of a roadmap entry (index.json), lower case.
export function entryText(e){
 return [e.title,e.summary,plain(e.body),...(e.stats??[]).map(s=>`${s.value} ${s.label}`),...(e.media??[]).map(m=>m.caption),dateWords(e.date),dateWords(e.end)]
  .filter(Boolean).join(' ').toLowerCase().replace(/\s+/g,' ').trim();
}

// Every word of the query must appear (any order, any case; hyphens optional). Empty matches everything.
export function matcher(query){
 const flat=s=>s.toLowerCase().replace(/-/g,'');
 const words=flat(String(query??'')).split(/\s+/).filter(Boolean);
 return text=>{if(!words.length)return true;const t=flat(text);return words.every(w=>t.includes(w));};
}
