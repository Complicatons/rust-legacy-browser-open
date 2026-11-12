// Settings page: a container that mounts its sections in order, with a chip per section to jump to it. A section is
// either a factory (deps) → {id, title, el, show(), hide()} (server-settings.mjs) or a module object
// {id, title, create(deps) → {el, load?(), hide?()}} (settings-alerts.mjs); add one by listing it in SECTIONS.
import {createServerSettingsSection} from './server-settings.mjs';
import {alertsSection} from './settings-alerts.mjs';

export const SECTIONS=[createServerSettingsSection,alertsSection];

const mount=(s,deps)=>{
 if(typeof s==='function')return s(deps);
 const part=s.create(deps);part.el.id='set-'+s.id;part.el.classList.add('settings-section');
 return {id:s.id,title:s.title,el:part.el,show:()=>part.load?.(),hide:()=>part.hide?.()};
};

export function createSettingsPage(deps,sections=SECTIONS){
 const root=document.getElementById('settings-sections'),nav=document.getElementById('settings-nav');
 const made=sections.map(s=>mount(s,deps));
 for(const s of made){
  root.append(s.el);
  const a=document.createElement('a');a.href='#settings';a.textContent=s.title;a.className='chip';
  a.addEventListener('click',e=>{e.preventDefault();s.el.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});});
  nav?.append(a);
 }
 if(nav)nav.hidden=made.length<2;
 return {show(arg){for(const s of made)s.show?.(arg);},hide(){for(const s of made)s.hide?.();}};
}
