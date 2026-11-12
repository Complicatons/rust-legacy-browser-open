// File helpers for off-site backups (host/offsite.mjs): a plain ustar writer and reader for the player folder, and
// passphrase encryption (AES-256-GCM, key from scrypt) for files that leave the machine. Both are ours, in JS, so a
// restore needs no tar.exe and never trusts an archive: only plain files and folders are unpacked, under the target.
import {createHash,createCipheriv,createDecipheriv,randomBytes,scrypt} from 'node:crypto';
import {openSync,closeSync,readSync,writeSync,readdirSync,statSync,mkdirSync,createReadStream,createWriteStream,fstatSync,unlinkSync} from 'node:fs';
import {join,relative,sep,dirname} from 'node:path';
import {pipeline} from 'node:stream/promises';

export const sha256File=path=>new Promise((res,rej)=>{const h=createHash('sha256');createReadStream(path).on('data',d=>h.update(d)).on('end',()=>res(h.digest('hex'))).on('error',rej);});

// ---------- tar (POSIX ustar) ----------
const octal=(n,len)=>n.toString(8).padStart(len-1,'0')+'\0';
function header(name,size,mtime,type){
 const h=Buffer.alloc(512);let prefix='';
 if(Buffer.byteLength(name)>100){const i=name.lastIndexOf('/',155);prefix=name.slice(0,i);name=name.slice(i+1);if(i<0||Buffer.byteLength(name)>100||Buffer.byteLength(prefix)>155)throw Error('path too long for the archive: '+prefix+'/'+name);}
 h.write(name,0,100);h.write(octal(type==='5'?0o755:0o644,8),100);h.write(octal(0,8),108);h.write(octal(0,8),116);
 h.write(octal(size,12),124);h.write(octal(Math.floor(mtime/1000),12),136);h.write('        ',148);h.write(type,156);
 h.write('ustar\0',257);h.write('00',263);h.write(prefix,345,155);
 let sum=0;for(const b of h)sum+=b;h.write(sum.toString(8).padStart(6,'0')+'\0 ',148);
 return h;
}
const walk=d=>readdirSync(d,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:1).flatMap(e=>{const p=join(d,e.name);return e.isDirectory()?[{p,dir:true},...walk(p)]:e.isFile()?[{p,dir:false}]:[];});

// Packs dir (if it exists) as <base>/… into outFile. Returns {files, bytes}. Symlinks and special files are left out.
export function writeTar(dir,base,outFile){
 const fd=openSync(outFile,'w');let files=0,bytes=0;
 try{
  let entries=[];try{if(statSync(dir).isDirectory())entries=walk(dir);}catch{}
  writeSync(fd,header(base+'/',0,Date.now(),'5'));
  const buf=Buffer.alloc(1<<20);
  for(const e of entries){
   const name=base+'/'+relative(dir,e.p).split(sep).join('/'),st=statSync(e.p);
   if(e.dir){writeSync(fd,header(name+'/',0,st.mtimeMs,'5'));continue;}
   writeSync(fd,header(name,st.size,st.mtimeMs,'0'));
   const src=openSync(e.p,'r');let left=st.size;
   try{while(left>0){const n=readSync(src,buf,0,Math.min(buf.length,left),null);if(!n)throw Error(e.p+' changed while it was packed');writeSync(fd,buf,0,n);left-=n;}}finally{closeSync(src);}
   if(st.size%512)writeSync(fd,Buffer.alloc(512-st.size%512));
   files++;bytes+=st.size;
  }
  writeSync(fd,Buffer.alloc(1024));
 }finally{closeSync(fd);}
 return {files,bytes};
}

const UNSAFE=/(^|\/)\.\.(\/|$)|^\/|^[A-Za-z]:|\\|\0/;
// Unpacks the entries under <base>/ into destDir. Refuses anything but plain files and folders, any name that could
// leave destDir, and a damaged header. Returns {files, bytes}.
export function readTar(file,base,destDir,{maxFiles=100000}={}){
 const fd=openSync(file,'r'),total=fstatSync(fd).size,h=Buffer.alloc(512),buf=Buffer.alloc(1<<20);let pos=0,files=0,bytes=0;
 const str=(o,l)=>{const s=h.subarray(o,o+l),z=s.indexOf(0);return s.subarray(0,z<0?l:z).toString('utf8');};
 try{
  mkdirSync(destDir,{recursive:true});
  while(pos+512<=total){
   readSync(fd,h,0,512,pos);pos+=512;
   if(h.every(b=>b===0))break;
   let sum=0;for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:h[i];
   if(sum!==parseInt(str(148,8).trim(),8))throw Error('the player folder archive is damaged (bad header)');
   const size=parseInt(str(124,12).trim()||'0',8),type=str(156,1)||'0',prefix=str(345,155),name=(prefix?prefix+'/':'')+str(0,100);
   if(!Number.isSafeInteger(size)||size<0)throw Error('the player folder archive is damaged (bad size)');
   const rel=name.replace(/\/$/,'');
   if(UNSAFE.test(rel)||!(rel===base||rel.startsWith(base+'/')))throw Error('the player folder archive has an entry outside the folder: '+name.slice(0,120));
   const out=join(destDir,...rel.split('/').slice(1));
   if(type==='5')mkdirSync(out,{recursive:true});
   else if(type==='0'){
    if(++files>maxFiles)throw Error('the player folder archive has too many files');
    mkdirSync(dirname(out),{recursive:true});const o=openSync(out,'w');let left=size,at=pos;
    try{while(left>0){const n=readSync(fd,buf,0,Math.min(buf.length,left),at);if(!n)throw Error('the player folder archive is cut short');writeSync(o,buf,0,n);left-=n;at+=n;}}finally{closeSync(o);}
    bytes+=size;
   }else throw Error(`the player folder archive has an entry of a kind it should not (${type})`);
   pos+=Math.ceil(size/512)*512;
  }
 }finally{closeSync(fd);}
 return {files,bytes};
}

// ---------- encryption ----------
// File layout: "RLBENC1\n", 16-byte scrypt salt, 12-byte GCM nonce, ciphertext, 16-byte tag. scrypt N=2^15, r=8, p=1.
const MAGIC=Buffer.from('RLBENC1\n'),HEAD=MAGIC.length+16+12;
const deriveKey=(pass,salt)=>new Promise((res,rej)=>scrypt(String(pass).normalize('NFC'),salt,32,{N:32768,r:8,p:1,maxmem:64<<20},(e,k)=>e?rej(e):res(k)));
export const isEncrypted=file=>{const fd=openSync(file,'r');try{const b=Buffer.alloc(8);readSync(fd,b,0,8,0);return b.equals(MAGIC);}finally{closeSync(fd);}};

export async function encryptFile(src,dst,passphrase){
 const salt=randomBytes(16),iv=randomBytes(12),key=await deriveKey(passphrase,salt);
 const c=createCipheriv('aes-256-gcm',key,iv),out=createWriteStream(dst);
 out.write(Buffer.concat([MAGIC,salt,iv]));
 await pipeline(createReadStream(src),c,out,{end:false}).catch(e=>{out.destroy();throw e;});
 await new Promise((res,rej)=>out.end(c.getAuthTag(),e=>e?rej(e):res()));
}
// Writes dst only when the tag checks out; a wrong passphrase and a changed file give the same answer (GCM cannot tell).
export async function decryptFile(src,dst,passphrase){
 const fd=openSync(src,'r'),size=fstatSync(fd).size,head=Buffer.alloc(HEAD),tag=Buffer.alloc(16);
 try{if(size<HEAD+16)throw Error('too short');readSync(fd,head,0,HEAD,0);readSync(fd,tag,0,16,size-16);}
 catch{closeSync(fd);throw Error('not an encrypted backup file');}
 closeSync(fd);
 if(!head.subarray(0,8).equals(MAGIC))throw Error('not an encrypted backup file');
 const key=await deriveKey(passphrase,head.subarray(8,24)),d=createDecipheriv('aes-256-gcm',key,head.subarray(24,36));d.setAuthTag(tag);
 try{await pipeline(size-16>HEAD?createReadStream(src,{start:HEAD,end:size-17}):[],d,createWriteStream(dst));}
 catch{try{unlinkSync(dst);}catch{}throw Object.assign(Error('Wrong passphrase, or the backup was changed after it was made'),{status:409});}
}
