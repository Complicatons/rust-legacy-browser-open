// Leaderboard helpers without the DOM: boards, periods, number formats, profile tiles.
export const BOARDS=[
 {id:'playtime',label:'Most active',unit:'Hours'},{id:'animals',label:'Hunters',unit:'Animals'},{id:'pvp',label:'PvP',unit:'Kills'},
 {id:'gather',label:'Gatherers',unit:'Gathered'},{id:'build',label:'Builders',unit:'Built'},{id:'craft',label:'Crafters',unit:'Crafted'},{id:'distance',label:'Travellers',unit:'Km'},
];
export const PERIODS=[['all','All time'],['day','Today'],['week','7 days'],['month','30 days']];
export const boardOf=id=>BOARDS.find(b=>b.id===id)??BOARDS[0];

const group=n=>Math.round(n).toLocaleString('en-GB');
// Hours from seconds and km from metres: one decimal under 10, whole numbers above; counts grouped (12,345).
export function formatValue(board,v){
 const n=Number(v)||0;
 const scaled=board==='playtime'?n/3600:board==='distance'?n/1000:null;
 if(scaled===null)return group(n);
 return scaled<10?(Math.round(scaled*10)/10).toFixed(1):group(scaled);
}
// 'metal-ore' → 'Metal ore', 'mutant-bear' → 'Mutant bear'.
export const subLabel=s=>String(s).replace(/-/g,' ').replace(/^./,c=>c.toUpperCase());

// The query string a board view keeps (defaults left out).
export function boardQuery({board='playtime',server='',period='all',species=''}){
 const q=new URLSearchParams();if(board!=='playtime')q.set('board',board);if(server)q.set('server',server);if(period!=='all')q.set('period',period);if(board==='animals'&&species)q.set('species',species);
 const s=q.toString();return s?'?'+s:'';
}
export function readQuery(search){
 const q=new URLSearchParams(search),board=boardOf(q.get('board')).id,period=PERIODS.some(p=>p[0]===q.get('period'))?q.get('period'):'all';
 return {board,period,server:q.get('server')??'',species:board==='animals'?q.get('species')??'':''};
}

const sum=o=>Object.values(o??{}).reduce((a,b)=>a+b,0);
// Profile headline tiles: [value text, label].
export function profileTiles(s){
 return [[formatValue('playtime',s.playtime),'Hours'],[group(sum(s.animal)),'Animals'],[group(s.pvp),'PvP kills'],[group(s.death),'Deaths'],
  [group(sum(s.gather)),'Gathered'],[group(sum(s.build)),'Built'],[group(s.craft),'Crafted'],[formatValue('distance',s.distance),'Km']];
}
// Breakdown rows, biggest first: [label, value text].
export const breakdown=o=>Object.entries(o??{}).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([k,v])=>[subLabel(k),group(v)]);
