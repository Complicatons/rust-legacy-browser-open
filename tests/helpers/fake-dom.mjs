// A very small DOM for running site page scripts in node (no layout, no events beyond what is dispatched by hand):
// elements with attributes, children, text, dataset, listeners and simple selectors (#id, tag, .class, [name=x]).
class El{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parent=null;this.attrs=new Map();this.listeners={};this.dataset={};this.text='';this.html=null;this.value='';}
 get className(){return this.attrs.get('class')??'';}set className(v){this.attrs.set('class',String(v));}
 get id(){return this.attrs.get('id')??'';}
 get hidden(){return this.attrs.has('hidden');}set hidden(v){if(v)this.attrs.set('hidden','');else this.attrs.delete('hidden');}
 setAttribute(k,v){this.attrs.set(k,String(v));if(k==='value')this.value=String(v);}
 getAttribute(k){return this.attrs.get(k)??null;}hasAttribute(k){return this.attrs.has(k);}removeAttribute(k){this.attrs.delete(k);}
 get textContent(){return this.html!=null?this.html.replace(/<[^>]*>/g,''):this.text+this.children.map(c=>c.textContent).join('');}
 set textContent(v){this.children=[];this.html=null;this.text=String(v);}
 get innerHTML(){return this.html??'';}set innerHTML(v){this.children=[];this.text='';this.html=String(v);}
 get childElementCount(){return this.children.filter(c=>c instanceof El).length;}
 append(...kids){for(const k of kids){const n=k instanceof El||k instanceof Text?k:new Text(String(k));n.parent?.removeChild(n);n.parent=this;this.children.push(n);}}
 replaceChildren(...kids){for(const c of this.children)c.parent=null;this.children=[];this.text='';this.html=null;this.append(...kids);}
 removeChild(n){this.children=this.children.filter(c=>c!==n);n.parent=null;}
 remove(){this.parent?.removeChild(this);}
 replaceWith(n){const p=this.parent;if(!p)return;const i=p.children.indexOf(this);n.parent?.removeChild(n);p.children[i]=n;n.parent=p;this.parent=null;}
 after(n){const p=this.parent;if(!p)return;n.parent?.removeChild(n);p.children.splice(p.children.indexOf(this)+1,0,n);n.parent=p;}
 addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
 // Resolves when every (possibly async) listener has finished.
 dispatch(type,extra={}){const e={type,target:this,currentTarget:this,preventDefault(){},...extra};return Promise.all((this.listeners[type]??[]).map(fn=>fn(e)));}
 click(){return this.dispatch('click');}
 focus(){}scrollIntoView(){}
 matches(sel){
  if(sel.startsWith('#'))return this.id===sel.slice(1);
  if(sel.startsWith('.'))return this.className.split(/\s+/).includes(sel.slice(1));
  const a=/^\[([\w-]+)=["']?([^"'\]]*)["']?\]$/.exec(sel);if(a)return this.getAttribute(a[1])===a[2];
  return this.tagName===sel.toUpperCase();
 }
 *walk(){for(const c of this.children)if(c instanceof El){yield c;yield* c.walk();}}
 querySelectorAll(sel){return [...this.walk()].filter(e=>e.matches(sel));}
 querySelector(sel){return this.querySelectorAll(sel)[0]??null;}
 closest(sel){for(let e=this;e;e=e.parent)if(e.matches?.(sel))return e;return null;}
}
class Text{constructor(t){this.text=t;this.parent=null;}get textContent(){return this.text;}}

// Installs document/location/history on globalThis; returns {document, body, location, el}. Call again for a fresh page.
export function installDom(url){
 const u=new URL(url,'http://site.test'),body=new El('body'),root=new El('html');root.append(body);
 const document={body,title:'',createElement:t=>new El(t),querySelector:s=>root.querySelector(s),querySelectorAll:s=>root.querySelectorAll(s),
  getElementById:id=>root.querySelector('#'+id),addEventListener(){}};
 const location={pathname:u.pathname,search:u.search,hash:u.hash,assigned:[],replace(h){this.assigned.push(h);}};
 Object.defineProperty(location,'href',{get:()=>u.href,set(h){location.assigned.push(h);}});
 Object.assign(globalThis,{document,location,history:{replaceState(){}}});
 return {document,body,location,el:t=>new El(t)};
}
