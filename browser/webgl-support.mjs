// Browser-only start-up failures the original Windows client never met: no WebGL 2 (blocked GPU, hardware acceleration
// off, an old browser) or a failure before the original front end exists. three.js needs WebGL 2; without it the menu
// stayed black and the loading screen said "Error creating WebGL context.". The player now gets one plain panel saying
// what to change. Nothing here draws while the game works, so the original look is untouched.

// null when WebGL 2 starts; 'no-webgl2' when only WebGL 1 does; 'no-webgl' when neither does. The probe context is
// released at once so it does not count against the browser's context limit.
export function webgl2Problem(doc=globalThis.document){
 const context=type=>{try{const c=doc.createElement('canvas').getContext(type);c?.getExtension?.('WEBGL_lose_context')?.loseContext();return Boolean(c);}catch{return false;}};
 if(context('webgl2'))return null;
 return context('webgl')?'no-webgl2':'no-webgl';
}

const FIXES=['Turn on hardware acceleration in your browser settings ("Use graphics acceleration when available"), then restart the browser.',
 'Update your graphics driver.','Use a current Chrome, Edge or Firefox on a desktop or laptop computer.'];
export function startupMessage(reason,detail=''){
 if(reason==='no-webgl2'||reason==='no-webgl')return {title:'Your browser could not start 3D graphics',
  text:reason==='no-webgl2'?'Rust Legacy needs WebGL 2. This browser only offers the older WebGL 1.':'Rust Legacy needs WebGL 2, and this browser did not start it.',fixes:FIXES,reload:false};
 if(reason==='context-lost')return {title:'The graphics device stopped',text:'The browser reset its 3D graphics (a driver update, sleep, or too many tabs using the GPU).',fixes:['Reload the page to start again.'],reload:true};
 return {title:'The game could not start',text:detail?`Error: ${detail}`:'Something went wrong while starting the game.',fixes:['Reload the page. If it keeps happening, tell us on the website\'s contact page.'],reload:true};
}

// One panel (#startup-error, styles in style.css), replaced if shown again.
export function showStartupError(doc,{title,text,fixes=[],reload=false}){
 doc.querySelector('#startup-error')?.remove();
 const el=(tag,props={},...children)=>{const e=doc.createElement(tag);Object.assign(e,props);e.append(...children);return e;};
 const panel=el('div',{id:'startup-error',role:'alertdialog'},el('h2',{id:'startup-error-title',textContent:title}),el('p',{textContent:text}),
  fixes.length?el('ul',{},...fixes.map(f=>el('li',{textContent:f}))):'',
  reload?el('button',{type:'button',textContent:'Reload',onclick:()=>doc.defaultView?.location.reload()}):'');
 panel.setAttribute('aria-labelledby','startup-error-title');
 doc.body.append(panel);panel.querySelector('button')?.focus();
 return panel;
}
