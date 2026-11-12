// Ticket signing keys on disk: one PKCS#8 PEM per key, named signing-<kid>.pem, readable only by the service.
import {generateKeyPairSync,createPrivateKey,createPublicKey,randomUUID} from 'node:crypto';
import {writeFileSync,readFileSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {basename,join} from 'node:path';

// System32's whoami and icacls by full path, so an earlier PATH entry (Git Bash's coreutils whoami) never runs instead.
const system32=exe=>join(process.env.SystemRoot??'C:\\Windows','System32',exe);
const windowsSid=()=>execFileSync(system32('whoami.exe'),['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true}).match(/S-1-\d+(?:-\d+)+/)?.[0];

export function writeSigningKey(dir){
 const kid=randomUUID(),{privateKey}=generateKeyPairSync('ed25519');
 const file=join(dir,`signing-${kid}.pem`);
 // POSIX mode bits are ignored on Windows. Protect an empty file first so private key
 // bytes are never written with inherited permissions, then grant only the service SID.
 writeFileSync(file,'',{mode:0o600,flag:'wx'});
 try{
  if(process.platform==='win32'){
   const sid=windowsSid();
   if(!sid)throw Error('Cannot identify the Windows service account');
   execFileSync(system32('icacls.exe'),[file,'/inheritance:r','/grant:r',`*${sid}:F`],{stdio:'pipe',windowsHide:true});
  }
  writeFileSync(file,privateKey.export({type:'pkcs8',format:'pem'}),{flag:'r+'});
 }catch(error){unlinkSync(file);throw error;}
 return {kid,file};
}
export function loadSigningKey(file){
 const m=/^signing-([0-9a-f-]{36})\.pem$/.exec(basename(file));if(!m)throw Error('Signing key files must be named signing-<uuid>.pem');
 const privateKey=createPrivateKey(readFileSync(file));
 if(privateKey.asymmetricKeyType!=='ed25519')throw Error('Signing keys must be Ed25519');
 return {kid:m[1],privateKey,publicKey:createPublicKey(privateKey)};
}
