// Stand-in for tools/vanilla-patcher in tests (same verbs, files and exit codes): a fake "stock" Assembly-CSharp.dll holds
// the text STOCK, a patched one PATCHED. It never touches a real server file.
import {readFileSync,writeFileSync,copyFileSync,existsSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
const [verb,dir]=process.argv.slice(2);
const target=join(dir,'Assembly-CSharp.dll'),backup=target+'.rlb-original',adapter=join(dir,'RustLegacyBrowser.Vanilla.dll');
const text=f=>readFileSync(f,'utf8');
if(verb==='check'){if(text(target)!=='STOCK'){console.log('Unsupported build: refusing.');process.exit(1);}console.log(existsSync(adapter)?'Adapter present':'Adapter missing');process.exit(existsSync(adapter)?0:1);}
if(verb==='patch'){if(text(target)!=='STOCK'){console.error('Error: Already patched');process.exit(1);}copyFileSync(target,backup);writeFileSync(target,'PATCHED');console.log('Done. Original kept');process.exit(0);}
if(verb==='verify'){const ok=text(target)==='PATCHED'&&existsSync(adapter);console.log(ok?'Patched build looks complete.':'Patch incomplete');process.exit(ok?0:1);}
if(verb==='restore'){if(!existsSync(backup)){console.error('Error: No backup to restore.');process.exit(1);}copyFileSync(backup,target);unlinkSync(backup);console.log('Original restored.');process.exit(0);}
process.exit(2);
