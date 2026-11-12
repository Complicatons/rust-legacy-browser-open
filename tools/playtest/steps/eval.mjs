// Evaluates ?js=<expression> in page ?page (default p1); an async arrow body works too (?fn=1: js is `async d=>...` run with explorerDev).
export default async function({pages},q){const page=pages.get(q.page??'p1');
 if(q.fn)return page.evaluate(async src=>{const f=(0,eval)(src);return f(window.explorerDev,window.explorerState);},q.js);
 return page.evaluate(q.js);}
