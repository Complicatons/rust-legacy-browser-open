// Island map viewer (DOM): tile layers (the modern tiles carry the buildings, roads, rocks and trees), the classic
// image, a vector overlay (radiation, zones, crates, contours, spawns), labels, compare swipe, and pan / zoom by pointer, wheel, pinch and keyboard. Maths in map-viewer-math.mjs.
import {createView,worldToScreen,screenToWorld,zoomAt,pan,clampView,gridLabel,tilesFor} from './map-viewer-math.mjs';
import {hoverLabel} from './map-hover.mjs';

const SVG='http://www.w3.org/2000/svg';
const svg=(tag,attrs={})=>{const e=document.createElementNS(SVG,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);return e;};
const div=(cls)=>{const e=document.createElement('div');e.className=cls;return e;};
const ICON={hangar:'H',tank:'T',smokestack:'S',warehouse:'W',apartment:'A',bunker:'B',barn:'Ba',tower:'G',garage:'Ga',shack:'Sh',shed:'Sd',oiltank:'O',building:'·'};

// layers: {modern:{manifest,base}|null, aerial:{…}|null, classic:{image,affine,credit}|null}; data: modern.json.
export function mountMap(root,{layers,data,initial={},onSelect=()=>{},onView=()=>{},onPick=()=>{},elevationUrl=null}){
 root.classList.add('mapview');root.tabIndex=0;root.setAttribute('role','application');root.setAttribute('aria-label','Island map. Drag or use arrow keys to move, plus and minus to zoom.');
 const stackA=div('map-stack'),stackB=div('map-stack compare');stackB.hidden=true;
 const overlay=svg('svg',{class:'map-vector','aria-hidden':'true'}),world=svg('g');overlay.append(world);
 const labels=div('map-labels'),handle=div('swipe');handle.hidden=true;handle.setAttribute('role','slider');handle.setAttribute('aria-label','Compare position');handle.tabIndex=0;
 const hud=div('map-hud');hud.innerHTML='<span class="readout mono" aria-live="off"></span><span class="scale mono"><i></i><b></b></span><span class="north mono" aria-hidden="true">▲<br>N</span>';
 // Mouse hover label: what is under the cursor (crate, zone, place) and the area it is in (map-hover.mjs).
 const tip=div('map-tip');tip.hidden=true;tip.setAttribute('aria-hidden','true');tip.innerHTML='<b></b><span></span>';
 root.append(stackA,stackB,overlay,labels,handle,hud,tip);
 let v=null,layerA=initial.layer??'modern',layerB=null,swipe=.5,raf=0;
 const show={labels:true,rad:true,spawns:false,grid:false,crates:true,mutants:true,animals:false,resources:false,nobuild:false,elevation:false,...initial.overlays};

 // Vector overlay in world coordinates (one transform per frame).
 const g=(cls,parent=world)=>{const e=svg('g',{class:cls});parent.append(e);return e;};
 const gContours=g('contours'),gNoBuild=g('nobuild'),gRes=g('resources'),gAnimals=g('animals'),gMutants=g('mutants'),gRad=g('rad'),gSpawn=g('spawns'),gLoot=g('crates'),gGrid=g('grid');
 // Static spawn data (modern.json): zones and fixed crate spots, never live positions.
 const zoneGroup={wildlife:gAnimals,mutant:gMutants,resources:gRes};
 if(data){
  for(const z of data.rad)gRad.append(svg('circle',{cx:z.x,cy:z.z,r:z.r,'data-exposure':z.exposure}));
  for(const z of data.zones??[]){zoneGroup[z.kind]?.append(svg('circle',{cx:z.x,cy:z.z,r:z.r}));if(z.kind==='wildlife'&&z.resources.length)gRes.append(svg('circle',{cx:z.x,cy:z.z,r:z.r}));}
  for(const z of data.noBuild??[])gNoBuild.append(svg('circle',{cx:z.x,cy:z.z,r:z.r}));
  for(const c of data.contours??[])gContours.append(svg('path',{d:c.d,class:c.coast?'coast':c.major?'major':''}));
  for(const c of data.loot??[])gLoot.append(svg('rect',{x:c.x,y:c.z,width:1,height:1}));
  for(const [x,z] of data.spawns)gSpawn.append(svg('circle',{cx:x,cy:z,r:5}));
  const w=data.window;for(let i=1;i<16;i++){const x=w.x0+(w.x1-w.x0)*i/16,z=w.z0+(w.z1-w.z0)*i/16;gGrid.append(svg('line',{x1:x,y1:w.z0,x2:x,y2:w.z1}),svg('line',{x1:w.x0,y1:z,x2:w.x1,y2:z}));}
 }
 // Labels: places (and radiation exposure), placed in screen space; lower-priority labels that overlap are hidden.
 const placeEls=(data?.places??[]).map(p=>{const b=document.createElement('button');b.type='button';b.className='place '+p.kind;b.dataset.id=p.id;
  b.innerHTML=`<i aria-hidden="true">${ICON[p.kind]??'·'}</i><span></span>`;b.querySelector('span').textContent=p.title;b.setAttribute('aria-label',`${p.title}${p.rad?`, radiation ${p.rad} per minute`:''}`);
  b.addEventListener('click',e=>{e.stopPropagation();onSelect(p);});labels.append(b);return {p,el:b};});
 const PRIORITY=['smokestack','warehouse','hangar','tank','oiltank','apartment','bunker','barn','tower','garage','shack','shed','building'];
 placeEls.sort((a,b)=>PRIORITY.indexOf(a.p.kind)-PRIORITY.indexOf(b.p.kind)||b.p.structures-a.p.structures);

 function tileLayer(stack,name){
  stack.replaceChildren();const L=layers[name];
  if(!L){const p=div('pending');p.innerHTML=`<b>${name==='classic'?'Classic map coming soon':name==='aerial'?'Aerial view not generated':'Map not generated'}</b><span>${name==='classic'?'The original community map will appear here.':'Run npm run build:site on the server to create it.'}</span>`;stack.append(p);return;}
  if(name==='classic'){const img=document.createElement('img');img.src=L.image;img.alt='';img.className='classic';img.draggable=false;stack.append(img);if(L.credit){const c=div('credit mono');c.textContent=L.credit;stack.append(c);}return;}
  const tiles=tilesFor(v,L.manifest,{base:L.base,dpr:Math.min(2,devicePixelRatio||1)}),keep=new Map([...stack.querySelectorAll('img')].map(i=>[i.dataset.k,i]));
  const frag=document.createDocumentFragment();
  for(const t of tiles){const k=`${t.z}/${t.x}/${t.y}`;let img=keep.get(k);if(img)keep.delete(k);else{img=document.createElement('img');img.dataset.k=k;img.alt='';img.draggable=false;img.decoding='async';img.src=t.url;}
   img.style.transform=`translate(${t.left}px,${t.top}px)`;img.style.width=img.style.height=(t.size+.6)+'px';frag.append(img);}
  for(const old of keep.values())old.remove();stack.append(frag);
 }
 function placeClassic(stack){
  const L=layers.classic,img=stack.querySelector('img.classic');if(!L||!img)return;
  const [a,b,c,d,e,f]=L.affine,s=v.scale;
  img.style.transform=`matrix(${a*s},${d*s},${b*s},${e*s},${v.width/2+(c-v.cx)*s},${v.height/2+(f-v.cz)*s})`;
 }
 const built=new Map();
 // Draw one base layer into a stack: tiles are refreshed every frame, the classic image is placed by its affine fit.
 function drawStack(stack,name){
  if(built.get(stack)!==name){stack.replaceChildren();built.set(stack,name);}
  if(name==='classic'){if(!stack.firstChild)tileLayer(stack,'classic');placeClassic(stack);}else tileLayer(stack,name);
 }
 function render(){
  raf=0;if(!v)return;
  drawStack(stackA,layerA);
  stackB.hidden=!layerB;handle.hidden=!layerB;
  if(layerB){drawStack(stackB,layerB);
   stackB.style.clipPath=`inset(0 0 0 ${swipe*100}%)`;handle.style.left=swipe*100+'%';handle.setAttribute('aria-valuenow',String(Math.round(swipe*100)));}
  // Vector overlay (every layer).
  world.setAttribute('transform',`matrix(${v.scale},0,0,${v.scale},${v.width/2-v.cx*v.scale},${v.height/2-v.cz*v.scale})`);
  gRad.style.display=show.rad?'':'none';for(const [k,el] of [['crates',gLoot],['mutants',gMutants],['animals',gAnimals],['resources',gRes],['nobuild',gNoBuild],['elevation',gContours]])el.style.display=show[k]?'':'none';gSpawn.style.display=show.spawns?'':'none';gGrid.style.display=show.grid?'':'none';
  overlay.style.setProperty('--px',String(1/v.scale));
  // Labels with simple collision avoidance in priority order.
  const boxes=[];labels.hidden=!show.labels;
  if(show.labels)for(const {p,el} of placeEls){const [x,y]=worldToScreen(v,[p.x,p.z]);const w=el.offsetWidth||90,h=24,box=[x-w/2,y-h/2,x+w/2,y+h/2];
   const out=x<-50||y<-20||x>v.width+50||y>v.height+20,hit=boxes.some(b=>!(box[2]<b[0]||box[0]>b[2]||box[3]<b[1]||box[1]>b[3]));
   el.hidden=out||(hit&&!el.classList.contains('selected'));if(!el.hidden){boxes.push(box);el.style.transform=`translate(${Math.round(x-w/2)}px,${Math.round(y-h/2)}px)`;}}
  // Scale bar: the largest round length under ~120 px.
  const metres=[50,100,200,500,1000].reverse().find(m=>m*v.scale<=120)??50;hud.querySelector('.scale i').style.width=metres*v.scale+'px';hud.querySelector('.scale b').textContent=metres>=1000?`${metres/1000} km`:`${metres} m`;
  onView(v);
 }
 const schedule=()=>{if(!raf)raf=requestAnimationFrame(render);};
 function setView(nv){v=clampView(nv);schedule();}
 function resize(){const r=root.getBoundingClientRect();const fresh=createView({window:data?.window??layers.modern?.manifest.window,width:r.width,height:r.height});
  if(!v){v=fresh;if(initial.x!=null&&initial.z!=null){v.cx=initial.x;v.cz=initial.z;}if(initial.zoom)v.scale=Math.min(fresh.fit*16,Math.max(fresh.fit,fresh.fit*initial.zoom));}
  else{const zoom=v.scale/v.fit;v={...fresh,cx:v.cx,cz:v.cz,scale:fresh.fit*zoom};}
  overlay.setAttribute('width',r.width);overlay.setAttribute('height',r.height);setView(v);}
 new ResizeObserver(resize).observe(root);

 // Height above sea level under the cursor, from the generated 20 m grid (int16 decimetres).
 let heights=null;const E=data?.elevation;
 if(E&&elevationUrl)fetch(elevationUrl).then(r=>r.ok?r.arrayBuffer():null).then(b=>{if(b)heights=new Int16Array(b);}).catch(()=>{});
 function heightAbove(x,z){if(!heights)return null;const fi=(x-E.x0)/E.step,fj=(z-E.z0)/E.step,i=Math.floor(fi),j=Math.floor(fj);if(i<0||j<0||i>=E.nx-1||j>=E.nz-1)return null;
  const h=(a,b)=>heights[b*E.nx+a]*E.scale,ti=fi-i,tj=fj-j;return (h(i,j)*(1-ti)+h(i+1,j)*ti)*(1-tj)+(h(i,j+1)*(1-ti)+h(i+1,j+1)*ti)*tj-data.waterLine;}
 // Pointer: drag to pan, two pointers to pinch.
 const pointers=new Map();let pinch=null;
 root.addEventListener('pointerdown',e=>{if(e.target.closest('.place,.swipe,.map-controls'))return;root.setPointerCapture(e.pointerId);pointers.set(e.pointerId,[e.clientX,e.clientY]);root.classList.add('dragging');
  if(pointers.size===2){const [a,b]=[...pointers.values()];pinch={d:Math.hypot(a[0]-b[0],a[1]-b[1])};}});
 root.addEventListener('pointermove',e=>{
  const r=root.getBoundingClientRect(),[wx,wz]=screenToWorld(v,[e.clientX-r.left,e.clientY-r.top]);
  const above=heightAbove(wx,wz);hud.querySelector('.readout').textContent=`X ${Math.round(wx)} · Z ${Math.round(wz)} · ${gridLabel([wx,wz],v.window)??'—'}${above==null?'':above<0?' · sea':` · ${Math.round(above)} m`}`;
  hover(e,r,wx,wz);
  if(!pointers.has(e.pointerId))return;const last=pointers.get(e.pointerId);pointers.set(e.pointerId,[e.clientX,e.clientY]);
  if(pointers.size===2&&pinch){const [a,b]=[...pointers.values()],d=Math.hypot(a[0]-b[0],a[1]-b[1]);setView(zoomAt(v,d/pinch.d,[(a[0]+b[0])/2-r.left,(a[1]+b[1])/2-r.top]));pinch.d=d;return;}
  setView(pan(v,e.clientX-last[0],e.clientY-last[1]));});
 // A click that did not drag identifies what is under it: a crate spot within 12 px, else the topmost zone shown.
 let downAt=null;root.addEventListener('pointerdown',e=>{downAt=[e.clientX,e.clientY];},true);
 root.addEventListener('click',e=>{if(!downAt||Math.hypot(e.clientX-downAt[0],e.clientY-downAt[1])>5||e.target.closest('.place,.swipe'))return;
  const r=root.getBoundingClientRect(),pt=[e.clientX-r.left,e.clientY-r.top],[wx,wz]=screenToWorld(v,pt);onPick(pick(pt,wx,wz));});
 function pick(pt,wx,wz){
  if(show.crates&&data?.loot){let best=null,bd=12;for(const c of data.loot){const [sx,sy]=worldToScreen(v,[c.x,c.z]),d=Math.hypot(sx-pt[0],sy-pt[1]);if(d<bd){bd=d;best=c;}}if(best)return {type:'crate',...best};}
  const inside=z=>Math.hypot(z.x-wx,z.z-wz)<=z.r,zones=data?.zones??[];
  const order=[['mutants',zones.filter(z=>z.kind==='mutant'),'mutant'],['rad',data?.rad??[],'rad'],['animals',zones.filter(z=>z.kind==='wildlife'),'animals'],['resources',zones.filter(z=>z.resources.length),'resources'],['nobuild',data?.noBuild??[],'nobuild']];
  for(const [k,list,type] of order)if(show[k]){const z=list.find(inside);if(z)return {type,...z};}
  return {type:'point',x:Math.round(wx),z:Math.round(wz)};
 }
 function hover(e,r,wx,wz){
  if(e.pointerType!=='mouse'||pointers.size||e.target.closest('.swipe,.map-controls')){tip.hidden=true;return;}
  const pt=[e.clientX-r.left,e.clientY-r.top],el=e.target.closest('.place'),p=el&&placeEls.find(x=>x.el===el)?.p;
  const l=hoverLabel(p?{type:'place',...p}:pick(pt,wx,wz),data?.places);if(!l){tip.hidden=true;return;}
  tip.querySelector('b').textContent=l.title;tip.querySelector('span').textContent=l.lines.join('\n');tip.querySelector('span').hidden=!l.lines.length;tip.hidden=false;
  const w=tip.offsetWidth,h=tip.offsetHeight,x=pt[0]+16+w>r.width?pt[0]-12-w:pt[0]+16,y=pt[1]+18+h>r.height-30?pt[1]-12-h:pt[1]+18;
  tip.style.transform=`translate(${Math.max(4,x)}px,${Math.max(4,y)}px)`;
 }
 root.addEventListener('pointerleave',()=>{tip.hidden=true;});root.addEventListener('pointerdown',()=>{tip.hidden=true;});
 const up=e=>{pointers.delete(e.pointerId);if(pointers.size<2)pinch=null;if(!pointers.size)root.classList.remove('dragging');};
 root.addEventListener('pointerup',up);root.addEventListener('pointercancel',up);
 root.addEventListener('wheel',e=>{e.preventDefault();const r=root.getBoundingClientRect();setView(zoomAt(v,Math.exp(-e.deltaY*(e.deltaMode?0.05:0.0015)),[e.clientX-r.left,e.clientY-r.top]));},{passive:false});
 root.addEventListener('dblclick',e=>{if(e.target.closest('.place'))return;const r=root.getBoundingClientRect();setView(zoomAt(v,2,[e.clientX-r.left,e.clientY-r.top]));});
 root.addEventListener('keydown',e=>{if(e.target!==root)return;const step=80,c=[v.width/2,v.height/2];
  const act={ArrowLeft:()=>pan(v,step,0),ArrowRight:()=>pan(v,-step,0),ArrowUp:()=>pan(v,0,step),ArrowDown:()=>pan(v,0,-step),'+':()=>zoomAt(v,1.5,c),'=':()=>zoomAt(v,1.5,c),'-':()=>zoomAt(v,1/1.5,c),'0':()=>({...v,scale:v.fit,cx:(v.window.x0+v.window.x1)/2,cz:(v.window.z0+v.window.z1)/2})}[e.key];
  if(act){e.preventDefault();setView(act());}});
 // Compare swipe handle.
 handle.addEventListener('pointerdown',e=>{e.stopPropagation();handle.setPointerCapture(e.pointerId);const r=root.getBoundingClientRect();
  const move=ev=>{swipe=Math.min(.95,Math.max(.05,(ev.clientX-r.left)/r.width));schedule();};handle.addEventListener('pointermove',move);
  handle.addEventListener('pointerup',()=>handle.removeEventListener('pointermove',move),{once:true});});
 handle.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();swipe=Math.min(.95,Math.max(.05,swipe+(e.key==='ArrowLeft'?-.05:.05)));schedule();}});

 return {
  setLayer(name){layerA=name;if(layerB===name)layerB=null;schedule();},
  setCompare(name){layerB=name&&name!==layerA?name:null;schedule();},
  toggle(name,on){show[name]=on;schedule();},
  flyTo([x,z],zoom=4){setView({...v,cx:x,cz:z,scale:Math.min(v.fit*16,v.fit*zoom)});},
  select(id){for(const {p,el} of placeEls)el.classList.toggle('selected',p.id===id);schedule();},
  get view(){return v;},
 };
}
