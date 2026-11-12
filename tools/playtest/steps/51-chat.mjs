const lib=()=>import('../lib.mjs?t='+Date.now());
// Two players: see each other, chat with Enter (Return), read it on the other page.
export default async function({pages,shot}){const {lock}=await lib();const a=pages.get('p2'),b=pages.get('p3'),out={};
 out.seen=[await a.evaluate(()=>window.explorerDev.onlinePlayers().map(p=>({name:p.name??p.userName,pos:p.position}))),await b.evaluate(()=>window.explorerDev.onlinePlayers().map(p=>({name:p.name??p.userName})))];
 await lock(a);await a.keyboard.press('Enter');await a.waitForTimeout(300);await a.keyboard.type('hello from a');await a.keyboard.press('Enter');await a.waitForTimeout(1200);
 const lines=p=>p.evaluate(()=>window.explorerDev.chat?.()??null);out.a=await lines(a);out.b=await lines(b);await shot(b,'51-chat-b');
 return out;}
