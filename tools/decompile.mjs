// Decompiles the original managed game code to C# with ILSpy (`dotnet tool install -g ilspycmd`).
// ILSpy reads PE/CLI metadata and IL statically; the assemblies are never loaded or executed.
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sides={client:'analysis/client-audit/rust_Data/Managed',server:'analysis/server-audit/rust_server_Data/Managed'};
const assemblies=['Assembly-CSharp','Assembly-CSharp-firstpass','Assembly-UnityScript','Assembly-UnityScript-firstpass','Facepunch.Movement','Facepunch.Utility','Facepunch.HitBox','Facepunch.MeshBatch','Facepunch.Geometry','Facepunch.ID','Facepunch.Actor','Facepunch.Prefetch'];
for(const [side,dir] of Object.entries(sides))for(const name of assemblies){
 const input=path.join(root,dir,name+'.dll');if(!existsSync(input))continue;
 const output=path.join(root,'analysis/decompiled',side,name);mkdirSync(output,{recursive:true});
 const log=execFileSync('ilspycmd',['-p','-o',output,'-r',path.join(root,dir),input],{encoding:'utf8',maxBuffer:1<<28});
 writeFileSync(path.join(root,'analysis/decompiled',`${side}-${name}.log`),log);console.log(`${side} ${name}`);
}
