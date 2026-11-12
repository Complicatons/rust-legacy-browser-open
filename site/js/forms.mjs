// Form behaviour shared by the account pages: inline validation, error summary, busy state, password toggle.
// Markup per field: <div class="field" data-field="NAME"><label for=ID>…</label><input id=ID name=NAME>… <p class="err" hidden></p></div>
import {validateField,fieldForCode} from './form-rules.mjs';
import {explain} from './api.mjs';
export {validateField,fieldForCode};

export const debounce=(fn,ms)=>{let t;return (...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};};

function setError(form,name,message){
 const field=form.querySelector(`.field[data-field="${name}"]`);if(!field)return;
 const err=field.querySelector('.err'),input=field.querySelector('input,select,textarea');
 // aria-describedby keeps the field's own help text (e.g. f-username-help) and adds the error while there is one.
 const described=on=>{if(!input||!err.id)return;const ids=(input.getAttribute('aria-describedby')??'').split(/\s+/).filter(id=>id&&id!==err.id);
  if(on)ids.push(err.id);if(ids.length)input.setAttribute('aria-describedby',ids.join(' '));else input.removeAttribute('aria-describedby');};
 if(message){field.dataset.invalid='';err.textContent=message;err.hidden=false;input?.setAttribute('aria-invalid','true');described(true);}
 else{delete field.dataset.invalid;err.textContent='';err.hidden=true;input?.removeAttribute('aria-invalid');described(false);}
}
function summary(form,items){
 let box=form.querySelector('.error-summary');
 if(!items.length){box?.remove();return;}
 if(!box){box=document.createElement('div');box.className='error-summary';box.tabIndex=-1;box.setAttribute('role','alert');form.prepend(box);}
 const h=document.createElement('h2');h.textContent=items.length===1?'There is a problem':'There are problems';
 const ul=document.createElement('ul');
 for(const {name,message} of items){const li=document.createElement('li');
  if(name){const a=document.createElement('a');a.href='#'+form.querySelector(`[name="${name}"]`)?.id;a.textContent=message;li.append(a);}else li.textContent=message;ul.append(li);}
 box.replaceChildren(h,ul);box.focus();
}
const values=form=>Object.fromEntries([...new FormData(form)].map(([k,v])=>[k,String(v)]));

// fields: names validated on the client. ctx(values) → {username,email} for the password check.
// submit(values) resolves on success or throws an api error ({code}).
export function bindForm(form,{fields=[],ctx=v=>({username:v.username,email:v.email}),submit,busyText='Working…'}){
 const touched=new Set();
 const check=name=>{const v=values(form),m=validateField(name,v[name]??'',ctx(v));setError(form,name,m);return m;};
 for(const name of fields){
  const input=form.querySelector(`[name="${name}"]`);if(!input)continue;
  input.addEventListener('blur',()=>{if(input.value){touched.add(name);check(name);}});
  input.addEventListener('input',()=>{if(touched.has(name))check(name);});
 }
 const button=form.querySelector('[type=submit]');
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(form.dataset.busy!=null)return;
  const problems=fields.map(name=>{touched.add(name);const message=check(name);return message&&{name,message};}).filter(Boolean);
  summary(form,problems);if(problems.length)return;
  form.dataset.busy='';const label=button?.innerHTML;if(button){button.dataset.busy='';button.innerHTML=`<span class="spinner" aria-hidden="true"></span><span>${busyText}</span>`;}
  form.querySelectorAll('input,select,textarea').forEach(i=>i.readOnly=true);
  try{await submit(values(form));}
  catch(err){const name=fieldForCode(err.code),message=explain(err.code);if(name)setError(form,name,message);summary(form,[{name,message}]);}
  finally{delete form.dataset.busy;if(button){delete button.dataset.busy;button.innerHTML=label;}form.querySelectorAll('input,select,textarea').forEach(i=>i.readOnly=false);}
 });
 return {setError:(name,message)=>setError(form,name,message),summary:items=>summary(form,items)};
}

// Show/hide toggle for a password input.
export function passwordToggle(input,button){
 button.addEventListener('click',()=>{const show=input.type==='password';input.type=show?'text':'password';button.setAttribute('aria-pressed',String(show));button.textContent=show?'Hide':'Show';input.focus();});
}
// Length meter: 8 characters reaches half, 16 or more fills it.
export function passwordMeter(input,meter){
 const bar=meter.querySelector('i');
 const update=()=>{const n=input.value.length,f=Math.min(1,n/16);bar.style.width=Math.round(f*100)+'%';bar.style.background=n<8?'var(--red)':n<12?'var(--amber)':'var(--teal)';};
 input.addEventListener('input',update);update();
}
