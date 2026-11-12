// Launch sign-up page (/launch): leave an email to hear when the servers open, then the offer to make an account now.
import {mountNotify,carryEmail} from './notify.mjs';

const $=s=>document.querySelector(s);
mountNotify({form:$('#notify-form'),input:$('#notify-email'),website:$('#notify-website'),err:$('#notify-err'),onDone:email=>{
 $('#done-email').textContent=email;$('#notify-step').hidden=true;const step=$('#account-step');step.hidden=false;step.focus();
 carryEmail($('#create-account'),email);
}});
$('#later').addEventListener('click',()=>{$('#later-note').hidden=false;$('#later').hidden=true;});

// What's waiting, as numbers from the wiki data (hidden when it isn't built).
const json=u=>fetch(u).then(r=>r.ok?r.json():null).catch(()=>null);
const [items,recipes,places]=await Promise.all(['items','recipes','places'].map(n=>json(`/site/generated/wiki/${n}.json`)));
if(items&&recipes&&places){
 const stat=(n,l)=>{const d=document.createElement('div'),b=document.createElement('dd'),t=document.createElement('dt');b.textContent=n;t.textContent=l;t.className='mono';d.append(b,t);return d;};
 const box=$('#launch-stats');box.replaceChildren(stat(items.entries.length,'Items'),stat(recipes.entries.length,'Blueprints'),stat(places.entries.length,'Places'),stat('1','Island'));box.hidden=false;
}
document.body.dataset.ready='1';
