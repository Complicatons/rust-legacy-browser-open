// Admin screenshots (central/screenshots.mjs): the gateway sends {type:'capture', id}; the page copies the next frame
// the game renders, draws the HTML overlays (HUD, RPOS, chat, notices) over it as the player sees them, shrinks it to a
// JPEG under the size cap and answers {type:'capture', id, ok, image, meta}. No prompt is shown: only the game's own
// canvas and page are read (no getDisplayMedia, so nothing outside the tab). The WebGL buffer is not preserved, so the
// copy must happen right after the frame's render, in the same task: main.mjs calls frame() at the end of animate().
// The page is player-controlled code; the result is evidence, not proof (central cross-checks it with the gateway).
import {toUnityPosition,toUnityAngles} from './net-client.mjs';

export const CAPTURE=Object.freeze({maxWidth:1280,maxHeight:720,maxBytes:350_000,qualities:[0.82,0.7,0.58,0.46],frameWaitMs:3000});

// Output size: the viewport scaled down (never up) to fit maxWidth × maxHeight.
export function captureSize(w,h,maxW=CAPTURE.maxWidth,maxH=CAPTURE.maxHeight){const s=Math.min(1,maxW/Math.max(1,w),maxH/Math.max(1,h));return {width:Math.max(1,Math.round(w*s)),height:Math.max(1,Math.round(h*s)),scale:s};}
// Mean and spread of brightness over RGBA pixels (sampled): a near-zero spread means a blank or black frame.
export function lumaStats(data,step=16){let n=0,sum=0,sq=0;for(let i=0;i<data.length;i+=4*step){const y=0.2126*data[i]+0.7152*data[i+1]+0.0722*data[i+2];sum+=y;sq+=y*y;n++;}
 if(!n)return {mean:0,sd:0};const mean=sum/n;return {mean:Math.round(mean*10)/10,sd:Math.round(Math.sqrt(Math.max(0,sq/n-mean*mean))*10)/10};}
// "url(\"/a.png\")" → "/a.png"; first url only (layered backgrounds draw their top layer).
export const backgroundUrl=v=>/url\((['"]?)(.*?)\1\)/.exec(v??'')?.[2]??null;
const px=v=>{const n=parseFloat(v);return Number.isFinite(n)?n:0;};
// A CSS length in px or % of ref (background sizes and positions); anything else is 0.
const len=(v,ref)=>typeof v==='string'&&v.endsWith('%')?px(v)/100*ref:px(v);
// Drawn background size: cover/contain fill the box (approximation), auto keeps the image's own size or ratio.
export function backgroundBox(sizes,r,img){
 if(sizes[0]==='cover'||sizes[0]==='contain')return [r.width,r.height];
 const w=sizes[0]&&sizes[0]!=='auto'?len(sizes[0],r.width):null,h=sizes[1]&&sizes[1]!=='auto'?len(sizes[1],r.height):null,ratio=img.naturalHeight/Math.max(1,img.naturalWidth);
 return [w??(h!=null?h/Math.max(1e-6,ratio):img.naturalWidth),h??(w!=null?w*ratio:img.naturalHeight)];
}

// Overlay painter: walks the page in DOM order and draws what is visible over the game frame: background colours and
// images (sprite offsets and sizes in px), <img>/<canvas>, input values and text, each word where the browser laid it
// out. Borders, shadows, filters and transforms are not reproduced: close to the screen, not pixel-identical.
export function createOverlayPainter({document:doc=globalThis.document,images=new Map()}={}){
 const load=src=>{if(!images.has(src))images.set(src,new Promise(res=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>res(null);i.src=src;}));return images.get(src);};
 return async function paint(ctx,{skip,scale}){
  const view=doc.defaultView,jobs=[];let drawn=0;
  const rectOn=r=>[r.left*scale,r.top*scale,r.width*scale,r.height*scale];
  const visit=(el,alpha)=>{
   if(el===skip||el.tagName==='SCRIPT'||el.tagName==='STYLE'||el.tagName==='DIALOG'&&!el.open)return;
   const cs=view.getComputedStyle(el);if(cs.display==='none'||el.hidden)return;
   const a=alpha*(parseFloat(cs.opacity)||0);if(a<=0.01)return;
   const r=el.getBoundingClientRect(),shown=cs.visibility==='visible'&&r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<view.innerHeight&&r.left<view.innerWidth;
   if(shown){
    const bg=cs.backgroundColor;if(bg&&!/rgba\(.*,\s*0\)$/.test(bg)&&bg!=='transparent')jobs.push(()=>{ctx.globalAlpha=a;ctx.fillStyle=bg;ctx.fillRect(...rectOn(r));drawn++;});
    const url=backgroundUrl(cs.backgroundImage);
    if(url){const img=load(new URL(url,doc.baseURI).href),[x,y,w,h]=rectOn(r),sizes=cs.backgroundSize.split(' '),pos=cs.backgroundPosition.split(' ');
     jobs.push(async()=>{const i=await img;if(!i)return;const [bw,bh]=backgroundBox(sizes,r,i);
      ctx.save();ctx.globalAlpha=a;ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.drawImage(i,x+len(pos[0],r.width-bw)*scale,y+len(pos[1],r.height-bh)*scale,bw*scale,bh*scale);ctx.restore();drawn++;});}
    if(el.tagName==='IMG'&&el.complete&&el.naturalWidth)jobs.push(()=>{ctx.globalAlpha=a;try{ctx.drawImage(el,...rectOn(r));drawn++;}catch{}});
    if(el.tagName==='CANVAS')jobs.push(()=>{ctx.globalAlpha=a;try{ctx.drawImage(el,...rectOn(r));drawn++;}catch{}});
    if((el.tagName==='INPUT'||el.tagName==='TEXTAREA')&&el.type!=='hidden'&&el.type!=='password'&&el.value)jobs.push(()=>{ctx.globalAlpha=a;ctx.font=cs.font;ctx.fillStyle=cs.color;ctx.textBaseline='middle';ctx.fillText(el.value,(r.left+px(cs.paddingLeft))*scale,(r.top+r.height/2)*scale,r.width*scale);drawn++;});
   }
   for(const node of el.childNodes){
    if(node.nodeType===1)visit(node,a);
    else if(node.nodeType===3&&shown&&node.textContent.trim()){
     const range=doc.createRange(),text=node.textContent;
     for(const m of text.matchAll(/\S+/g)){range.setStart(node,m.index);range.setEnd(node,m.index+m[0].length);const w=range.getBoundingClientRect();if(!w.width||w.bottom<0||w.top>view.innerHeight)continue;
      const word=m[0];jobs.push(()=>{ctx.globalAlpha=a;ctx.font=`${cs.fontStyle} ${cs.fontWeight} ${Math.max(1,px(cs.fontSize)*scale)}px ${cs.fontFamily}`;ctx.fillStyle=cs.color;ctx.letterSpacing=cs.letterSpacing==='normal'?'0px':`${px(cs.letterSpacing)*scale}px`;ctx.textBaseline='alphabetic';ctx.fillText(word,w.left*scale,(w.bottom-(w.height-px(cs.fontSize))/2-px(cs.fontSize)*0.2)*scale);drawn++;});}
    }
   }
  };
  for(const el of doc.body.children)visit(el,1);
  for(const job of jobs)await job();
  ctx.globalAlpha=1;ctx.letterSpacing='0px';return drawn;
 };
}

// canvas: the game's WebGL canvas. pose(): {feet, yaw, pitch} in browser space (as the motor sends them).
export function createAdminCapture({canvas,pose=()=>null,document:doc=globalThis.document,now=()=>performance.now(),paint=createOverlayPainter({document:doc})}={}){
 const waiting=[];
 async function encode(work,size){
  for(const q of CAPTURE.qualities){const blob=await new Promise(r=>work.toBlob(r,'image/jpeg',q));if(blob&&blob.size<=CAPTURE.maxBytes)return {blob,quality:q};}
  // Still too large: half the size once more at the lowest quality.
  const small=doc.createElement('canvas');small.width=Math.round(size.width/2);small.height=Math.round(size.height/2);small.getContext('2d').drawImage(work,0,0,small.width,small.height);
  const blob=await new Promise(r=>small.toBlob(r,'image/jpeg',CAPTURE.qualities.at(-1)));return blob&&blob.size<=CAPTURE.maxBytes?{blob,quality:CAPTURE.qualities.at(-1)}:null;
 }
 async function finish(job,work,size,frameAt){
  try{
   const ctx=work.getContext('2d'),luma=lumaStats(ctx.getImageData(0,0,size.width,size.height).data);
   const overlays=await paint(ctx,{skip:canvas,scale:size.scale});
   // The request id and time, in the image only: an old screenshot replayed later does not carry them.
   const stamp=`RLB ${job.id.slice(0,8)} ${new Date().toISOString().slice(0,19)}Z`;ctx.font='11px monospace';ctx.textBaseline='bottom';
   const tw=ctx.measureText(stamp).width;ctx.globalAlpha=0.65;ctx.fillStyle='#000';ctx.fillRect(size.width-tw-8,size.height-16,tw+8,16);ctx.globalAlpha=1;ctx.fillStyle='#fff';ctx.fillText(stamp,size.width-tw-4,size.height-2);
   const out=await encode(work,size);if(!out)return job.resolve({ok:false,reason:'too-large'});
   const bytes=new Uint8Array(await out.blob.arrayBuffer());let bin='';for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));
   const p=pose(),view=doc.defaultView;
   job.resolve({ok:true,image:btoa(bin),meta:{quality:out.quality,capturedAt:Date.now(),frameAgeMs:Math.round(now()-frameAt),overlays,luma,hidden:doc.hidden,focused:doc.hasFocus?.()??null,
    viewport:{w:view.innerWidth,h:view.innerHeight,dpr:view.devicePixelRatio},camera:p?{feet:toUnityPosition(p.feet),yaw:toUnityAngles({yaw:p.yaw,pitch:p.pitch??0}).yaw}:null}});
  }catch(e){job.resolve({ok:false,reason:'capture-error'});}
 }
 return {
  // Resolves {ok, image?, meta?, reason?}; a hidden tab renders no frames, which is reported as such.
  request(id){return new Promise(resolve=>{const job={id,resolve,timer:setTimeout(()=>{const i=waiting.indexOf(job);if(i>=0)waiting.splice(i,1);resolve({ok:false,reason:doc.hidden?'tab-hidden':'no-frame'});},CAPTURE.frameWaitMs)};waiting.push(job);});},
  // After the frame's render, same task. Copies the frame once for every waiting request.
  frame(){
   if(!waiting.length)return;
   const jobs=waiting.splice(0),t=now();
   for(const job of jobs){
    clearTimeout(job.timer);
    const size=captureSize(canvas.clientWidth||canvas.width,canvas.clientHeight||canvas.height),work=doc.createElement('canvas');work.width=size.width;work.height=size.height;
    try{work.getContext('2d').drawImage(canvas,0,0,size.width,size.height);}catch{job.resolve({ok:false,reason:'capture-error'});continue;}
    finish(job,work,size,t);
   }
  },
  // Wire to the gateway client: answers every capture request on the same socket.
  attach(client){client.addEventListener('capture',e=>{const id=e.detail?.id;if(typeof id!=='string')return;this.request(id).then(r=>client.send({type:'capture',id,...r}));});return this;},
 };
}
