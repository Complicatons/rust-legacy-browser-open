// Reads a PE file's import and export tables from its bytes (never loads or runs it). Used to build the launcher
// proxy's export list from the original librust.dll (DESKTOP-LAUNCHER-PLAN.md, "The proxy").
//   node tools/pe-imports.mjs <file> [dll-name]   prints imports (optionally only from one DLL) and exports
import {readFileSync} from 'node:fs';

export function readPe(buf){
 if(buf.readUInt16LE(0)!==0x5a4d)throw new Error('not a PE file (no MZ)');
 const pe=buf.readUInt32LE(0x3c);
 if(buf.readUInt32LE(pe)!==0x4550)throw new Error('not a PE file (no PE signature)');
 const sections=buf.readUInt16LE(pe+6),optSize=buf.readUInt16LE(pe+20),opt=pe+24,magic=buf.readUInt16LE(opt);
 const dirs=opt+(magic===0x20b?112:96),pe32plus=magic===0x20b;
 const secs=[];
 for(let i=0,s=opt+optSize;i<sections;i++,s+=40)
  secs.push({va:buf.readUInt32LE(s+12),size:Math.max(buf.readUInt32LE(s+8),buf.readUInt32LE(s+16)),raw:buf.readUInt32LE(s+20)});
 const off=rva=>{const s=secs.find(x=>rva>=x.va&&rva<x.va+x.size);if(!s)throw new Error('rva outside sections: 0x'+rva.toString(16));return rva-s.va+s.raw;};
 const str=rva=>{const o=off(rva);return buf.toString('latin1',o,buf.indexOf(0,o));};
 const dir=i=>({rva:buf.readUInt32LE(dirs+i*8),size:buf.readUInt32LE(dirs+i*8+4)});
 const imports=[];
 const imp=dir(1);
 if(imp.rva)for(let d=off(imp.rva);buf.readUInt32LE(d+12);d+=20){
  const dll=str(buf.readUInt32LE(d+12)),names=[];
  let t=off(buf.readUInt32LE(d)||buf.readUInt32LE(d+16));
  for(;;t+=pe32plus?8:4){
   const lo=buf.readUInt32LE(t),hi=pe32plus?buf.readUInt32LE(t+4):0;
   if(!lo&&!hi)break;
   const byOrdinal=pe32plus?(hi&0x80000000)!==0:(lo&0x80000000)!==0;
   names.push(byOrdinal?'#'+(lo&0xffff):str((lo&0x7fffffff)+2));
  }
  imports.push({dll,names});
 }
 const exports=[];
 const exp=dir(0);
 if(exp.rva){
  const e=off(exp.rva),count=buf.readUInt32LE(e+24),names=off(buf.readUInt32LE(e+32));
  for(let i=0;i<count;i++)exports.push(str(buf.readUInt32LE(names+i*4)));
 }
 return {machine:buf.readUInt16LE(pe+4),pe32plus,imports,exports};
}

if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].replace(/\\/g,'/').split('/').pop())){
 const [file,only]=process.argv.slice(2);
 const pe=readPe(readFileSync(file));
 for(const i of pe.imports)if(!only||i.dll.toLowerCase()===only.toLowerCase())console.log(i.dll+': '+i.names.join(' '));
 if(!only)console.log('exports: '+pe.exports.join(' '));
}
