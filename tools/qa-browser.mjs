import {chromium} from 'playwright-core';

// On Windows, Chromium implements Pointer Lock by confining the REAL OS cursor (ClipCursor) to the browser window,
// even a headless one. A check that clicks into the game would trap the user's mouse in an invisible square for the
// whole run. Test pages therefore get an in-page Pointer Lock stand-in with the same API and events, which the game
// cannot tell apart; it never touches the OS cursor. Set REAL_POINTER_LOCK=1 to exercise the browser's real lock
// (only when nobody is using the PC). Every harness importing this module gets it through chromium.launch.
export function pointerLockStandIn(){
 let locked=null;const fire=type=>queueMicrotask(()=>document.dispatchEvent(new Event(type)));
 Object.defineProperty(Document.prototype,'pointerLockElement',{configurable:true,get(){return locked&&locked.isConnected?locked:null;}});
 Element.prototype.requestPointerLock=function(){if(!this.isConnected){fire('pointerlockerror');return Promise.reject(new DOMException('Element is not connected','WrongDocumentError'));}
  if(locked!==this){locked=this;fire('pointerlockchange');}return Promise.resolve();};
 Document.prototype.exitPointerLock=function(){if(!locked)return;locked=null;fire('pointerlockchange');};
 // A real lock also ends when the page loses focus or the user presses Escape (handled by the browser itself).
 addEventListener('blur',()=>document.exitPointerLock());
 addEventListener('keydown',e=>{if(e.code==='Escape'&&locked)queueMicrotask(()=>document.exitPointerLock());},true);
}
if(process.env.REAL_POINTER_LOCK!=='1'&&!chromium.__pointerLockStandIn){
 const launch=chromium.launch.bind(chromium);chromium.__pointerLockStandIn=true;
 chromium.launch=async(...args)=>{const browser=await launch(...args),newContext=browser.newContext.bind(browser);
  browser.newContext=async(...o)=>{const context=await newContext(...o);await context.addInitScript(pointerLockStandIn);return context;};
  browser.newPage=async(...o)=>{const context=await browser.newContext(...o),page=await context.newPage();page.on('close',()=>context.close().catch(()=>{}));return page;};
  return browser;};
}

// Local Windows checks use the real graphics adapter; cloud runs retain software rendering.
export function launchOptions(){
 const software=process.env.BROWSER_SOFTWARE==='1'||(process.platform!=='win32'&&process.env.BROWSER_SOFTWARE!=='0');
 return {executablePath:process.env.BROWSER_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--mute-audio',...(software?['--use-angle=swiftshader']:[])]};
}
export async function readGraphics(page){
 const result=await page.evaluate(()=>{const gl=document.querySelector('#world')?.getContext('webgl2');if(!gl)return {renderer:'unavailable'};const ext=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),version:gl.getParameter(gl.VERSION)};});
 if(process.env.REQUIRE_GPU==='1'&&(!result.renderer||/unavailable|SwiftShader|Software|llvmpipe|Microsoft Basic Render/i.test(result.renderer)))throw Error(`Hardware GPU required: ${result.renderer}`);
 return result;
}
