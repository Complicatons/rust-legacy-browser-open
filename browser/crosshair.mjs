// ViewModel crosshair (ViewModel.OnGUI / DrawShadowed, ViewModel.cs) from the exported crosshair fields
// (tools/export_crosshair.py). Only a held item's view model draws one, and only when drawCrosshair
// (showCrosshairZoom || showCrosshairNotZoomed) and both textures are set, RPOS is closed and the camera renders. In the
// shipped content every view model with textures has both flags off (and the Bandage, NotZoomed on, has no textures), so
// the original game never draws a crosshair; the rules are still ported so the data decides.

// OnGUI alpha: NotZoomed+Zoom -> 1; NotZoomed only -> 1 - zoom fraction; Zoom only -> zoom fraction. null = not drawn.
export function crosshairAlpha(vm,zoom,{rposOpen=false,cameraEnabled=true}={}){
 if(!vm||rposOpen||!cameraEnabled||!(vm.showCrosshairZoom||vm.showCrosshairNotZoomed)||!vm.crosshairTexture||!vm.dotTexture)return null;
 const z=Number.isFinite(zoom)?zoom:0;let a;
 if(vm.showCrosshairNotZoomed)a=vm.showCrosshairZoom?1:Math.min(1,Math.max(0,1-z));else a=z;
 return a===0?null:a;}
// DrawShadowed(GUI.color alpha a): above .5 four outline copies at (+1,-1), (-1,-1), (-1,+1), (+1,+1) then the texture in
// a crosshair/outline blend; otherwise one draw fading towards the outline. Colours are 0..1 RGBA.
export function shadowedDraws(a,color,outline){
 if(a>0.5){const k=(a-0.5)*2,oa=outline.a*(k*k),o={r:outline.r,g:outline.g,b:outline.b,a:oa},n=1-oa;
  return [...[[1,-1],[-1,-1],[-1,1],[1,1]].map(([dx,dy])=>({dx,dy,color:o})),{dx:0,dy:0,color:{r:color.r*oa+outline.r*n,g:color.g*oa+outline.g*n,b:color.b*oa+outline.b*n,a:color.a*oa+outline.a*n}}];}
 if(a>0){const n2=a*2,n3=n2+(n2-n2*n2),n4=1-n3;return [{dx:0,dy:0,color:{r:outline.r*n3+color.r*n4,g:outline.g*n3+color.g*n4,b:outline.b*n3+color.b*n4,a:outline.a*(n2*n2)}}];}
 return [];}
// The crosshair sits where the viewport-centre ray meets the noHitPlane (the screen centre), the dot where it hits
// something (Physics2.Raycast2, also on the centre ray): Rect(x - w/2, Screen.height - (y + 1) - h/2, w, h).
export function centredRect(texture,screen){return {x:screen.width*0.5-texture.width/2,y:screen.height-(screen.height*0.5+1)-texture.height/2,width:texture.width,height:texture.height};}

export async function createCrosshair({base='/assets/recovered/crosshair/',document=globalThis.document}={}){
 const response=await fetch(base+'manifest.json');if(!response.ok)throw Error('Original crosshair export missing');const manifest=await response.json();
 const images=new Map(),image=file=>{if(!images.has(file)){const img=new Image();img.src=base+file;images.set(file,img);}return images.get(file);};
 let canvas=null,last='';
 function update({viewModel,zoom=0,rposOpen=false,cameraEnabled=true,hit=()=>false,screen={width:innerWidth,height:innerHeight}}){
  const vm=viewModel?manifest.viewmodels[viewModel]:null,a=crosshairAlpha(vm,zoom,{rposOpen,cameraEnabled});
  if(a===null){if(canvas&&!canvas.hidden){canvas.hidden=true;last='';}return null;}
  const dot=Boolean(hit()),key=[viewModel,a,dot,screen.width,screen.height].join();if(key===last)return {alpha:a,dot};last=key;
  if(!canvas){canvas=document.createElement('canvas');canvas.id='crosshair';canvas.setAttribute('aria-hidden','true');document.body.append(canvas);}
  canvas.hidden=false;canvas.width=screen.width;canvas.height=screen.height;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
  const tint=document.createElement('canvas');
  const draw=(tex)=>{const img=image(tex.file);if(!img.complete)return;const r=centredRect(tex,screen);tint.width=tex.width;tint.height=tex.height;const t=tint.getContext('2d');
   for(const op of shadowedDraws(a,vm.crosshairColor,vm.crosshairOutline)){t.globalCompositeOperation='source-over';t.clearRect(0,0,tex.width,tex.height);t.drawImage(img,0,0);t.globalCompositeOperation='multiply';t.fillStyle=`rgb(${op.color.r*255},${op.color.g*255},${op.color.b*255})`;t.fillRect(0,0,tex.width,tex.height);t.globalCompositeOperation='destination-in';t.drawImage(img,0,0);
    ctx.globalAlpha=op.color.a;ctx.drawImage(tint,r.x+op.dx,r.y+op.dy);ctx.globalAlpha=1;}};
  ctx.clearRect(0,0,canvas.width,canvas.height);draw(vm.crosshairTexture);if(dot)draw(vm.dotTexture);return {alpha:a,dot};}
 return {update,manifest,element:()=>canvas,visible:()=>Boolean(canvas&&!canvas.hidden)};}
