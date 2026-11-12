// Link-preview cards (og:image, 1200×630) for the pages people share: site/generated/media/share-<name>.jpg.
// Drawn in a headless browser with the site's fonts over the title-screen shot of our port (hero-menu.jpg, from the
// media step); without that shot the card is plain dark. Generated, so it stays in ignored site/generated/.
//   node tools/share-cards.mjs
import {chromium} from 'playwright-core';
import {readFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {launchOptions} from './qa-browser.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),GEN=path.join(root,'site/generated');
export const W=1200,H=630;

// Each card: a tag over the title, the line under it and the call to action at the bottom.
export const CARDS={
 launch:{tag:'Servers opening soon',sub:'Back to where survival began',cta:'Get notified',note:'Leave your email · hear first when the servers open'},
 home:{tag:'Play in your browser',sub:'Back to where survival began',cta:'Play now',note:'The original island and rules · no download'},
};

const esc=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const dataUrl=async(file,type)=>`data:${type};base64,${(await readFile(file)).toString('base64')}`;

function cardHtml({tag,sub,cta,note},{archivo,mono,hero}){
 return `<!doctype html><html><head><style>
@font-face{font-family:A;font-weight:100 900;font-stretch:62% 125%;src:url(${archivo})}
@font-face{font-family:M;font-weight:700;src:url(${mono})}
*{box-sizing:border-box}body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#0a0a0a${hero?` url(${hero}) 18% 50%/cover`:''};color:#f2efe9;font-family:A,sans-serif}
.v{position:absolute;inset:0;background:linear-gradient(90deg,rgba(10,10,10,.93) 0%,rgba(10,10,10,.78) 55%,rgba(10,10,10,.35) 100%)}
.c{position:absolute;inset:0;display:flex;flex-direction:column;padding:60px 72px}
.brand{display:flex;align-items:center;gap:14px;font:700 18px M;letter-spacing:.16em;text-transform:uppercase;color:#b9b5ae}.brand i{width:18px;height:18px;background:#cd5a28}
.tag{align-self:flex-start;display:flex;align-items:center;gap:12px;margin-top:auto;padding:9px 16px;border:1px solid #363636;background:rgba(10,10,10,.6);font:700 18px M;letter-spacing:.14em;text-transform:uppercase;color:#e8a93a}.tag i{width:10px;height:10px;border-radius:50%;background:#e8a93a}
h1{margin:22px 0 0;font-weight:900;font-stretch:125%;font-size:132px;line-height:.86;text-transform:uppercase;letter-spacing:-.01em}
.sub{margin-top:18px;font-weight:900;font-stretch:125%;font-size:24px;letter-spacing:.3em;text-transform:uppercase;color:#b9b5ae}
.foot{display:flex;align-items:center;gap:26px;margin-top:40px}
.cta{padding:18px 30px;background:#cd5a28;font-weight:900;font-stretch:125%;font-size:28px;text-transform:uppercase}
.note{font:700 17px M;letter-spacing:.08em;text-transform:uppercase;color:#b9b5ae}
</style></head><body><div class="v"></div><div class="c">
<div class="brand"><i></i>Rust Legacy Browser</div>
<div class="tag"><i></i>${esc(tag)}</div><h1>Rust<br>Legacy</h1><div class="sub">${esc(sub)}</div>
<div class="foot"><div class="cta">${esc(cta)}</div><div class="note">${esc(note)}</div></div>
</div></body></html>`;
}

export async function buildShareCards({names=Object.keys(CARDS)}={}){
 const fonts=path.join(GEN,'fonts'),heroFile=path.join(GEN,'media/hero-menu.jpg');
 if(!existsSync(path.join(fonts,'archivo-wdth.woff2')))throw Error('share: run the fonts step first (node tools/build-site.mjs fonts)');
 const assets={archivo:await dataUrl(path.join(fonts,'archivo-wdth.woff2'),'font/woff2'),mono:await dataUrl(path.join(fonts,'jetbrains-mono-700.woff2'),'font/woff2'),
  hero:existsSync(heroFile)?await dataUrl(heroFile,'image/jpeg'):null};
 await mkdir(path.join(GEN,'media'),{recursive:true});
 const browser=await chromium.launch(launchOptions());
 try{
  const page=await browser.newPage({viewport:{width:W,height:H}});
  for(const name of names){
   if(!CARDS[name])throw Error('share: unknown card '+name);
   await page.setContent(cardHtml(CARDS[name],assets));await page.evaluate(()=>document.fonts.ready);
   await page.screenshot({path:path.join(GEN,'media',`share-${name}.jpg`),type:'jpeg',quality:88});
  }
 }finally{await browser.close();}
 return {cards:names,hero:Boolean(assets.hero)};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const r=await buildShareCards({names:process.argv.length>2?process.argv.slice(2):undefined});
 console.log(`share: ${r.cards.length} cards${r.hero?'':' (no hero-menu.jpg: plain background)'}`);
}
