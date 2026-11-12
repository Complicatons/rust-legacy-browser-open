// Authenticode signing for what we ship to owners (HOST-APP-PLAN.md "Code signing"). Signs only when the project owner
// has set one of these up; otherwise everything is built unsigned and says so. Microsoft's signtool.exe (Windows SDK)
// does the signing; RLB_SIGNTOOL overrides where it is.
//   RLB_SIGN_DLIB + RLB_SIGN_DLIB_METADATA   Azure Trusted Signing (Artifact Signing): signtool's /dlib with
//                                            Azure.CodeSigning.Dlib.dll and the account's metadata.json
//   RLB_SIGN_THUMBPRINT                      a certificate in the Windows certificate store, e.g. an OV certificate on a
//                                            hardware token (its driver puts it in the store); signtool /sha1
//   RLB_SIGN_PFX + RLB_SIGN_PASSWORD_FILE    a .pfx file (older certificates; new ones come on tokens or in the cloud)
//   RLB_SIGN_TIMESTAMP                       RFC 3161 time stamp server (default per method)
// Time stamping keeps a signature valid after the certificate expires.
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

export function signingConfig(env=process.env){
 if(env.RLB_SIGN_DLIB&&env.RLB_SIGN_DLIB_METADATA)return {method:'azure',args:['/fd','SHA256','/tr',env.RLB_SIGN_TIMESTAMP??'http://timestamp.acs.microsoft.com','/td','SHA256','/dlib',env.RLB_SIGN_DLIB,'/dmdf',env.RLB_SIGN_DLIB_METADATA]};
 if(env.RLB_SIGN_THUMBPRINT)return {method:'store',args:['/fd','SHA256','/tr',env.RLB_SIGN_TIMESTAMP??'http://timestamp.digicert.com','/td','SHA256','/sha1',env.RLB_SIGN_THUMBPRINT]};
 if(env.RLB_SIGN_PFX){
  const pw=env.RLB_SIGN_PASSWORD_FILE?readFileSync(env.RLB_SIGN_PASSWORD_FILE,'utf8').trim():null;
  return {method:'pfx',args:['/fd','SHA256','/tr',env.RLB_SIGN_TIMESTAMP??'http://timestamp.digicert.com','/td','SHA256','/f',env.RLB_SIGN_PFX,...(pw?['/p',pw]:[])]};
 }
 return null;
}

export function findSigntool(env=process.env){
 if(env.RLB_SIGNTOOL)return existsSync(env.RLB_SIGNTOOL)?env.RLB_SIGNTOOL:null;
 const kits=join(env['ProgramFiles(x86)']??'C:\\Program Files (x86)','Windows Kits','10','bin');
 try{
  for(const v of readdirSync(kits).filter(d=>/^10\./.test(d)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))){const t=join(kits,v,'x64','signtool.exe');if(existsSync(t))return t;}
 }catch{}
 return null;
}

// Signs each file in place. Returns {signed: true, method} or {signed: false, reason}. A configured method that fails
// throws: a build that was meant to be signed must never go out unsigned by accident.
export function signFiles(files,{env=process.env,log=console.log}={}){
 const cfg=signingConfig(env);
 if(!cfg)return {signed:false,reason:'no code-signing certificate is configured (RLB_SIGN_*)'};
 const tool=findSigntool(env);if(!tool)throw Error('Code signing is configured but signtool.exe was not found (install the Windows SDK or set RLB_SIGNTOOL)');
 for(const f of files){
  const r=spawnSync(tool,['sign',...cfg.args,f],{encoding:'utf8',windowsHide:true});
  if(r.status!==0)throw Error(`signtool failed on ${f}: ${(r.stdout+r.stderr).trim().split(/\r?\n/).slice(-3).join(' / ')}`);
  const v=spawnSync(tool,['verify','/pa',f],{encoding:'utf8',windowsHide:true});
  if(v.status!==0)throw Error(`The signature on ${f} does not verify: ${(v.stdout+v.stderr).trim().split(/\r?\n/).at(-1)}`);
  log(`signed (${cfg.method}): ${f}`);
 }
 return {signed:true,method:cfg.method};
}
