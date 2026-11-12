// Practice stand-ins for the setup scripts (host/wizard.mjs), for the demo, the dashboard check and the tests: the same
// output as the PowerShell scripts with -Json (the plan, "Dry run only", the '##rlb' lines, PowerShell's error report),
// and nothing on the PC changes. Never used for a real setup.
//   node host/wizard-practice.mjs <script name> [-Apply|-ConfirmRunOriginalBinaries] [-Name value ...] -Json
// RLB_PRACTICE (JSON): {elevated: false, steps: {'<script name>': 'pass'|'warn'|'fail'|'denied'|'slow'|'rows-fail'}}
import {basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {STEPS,powershellCommand} from './wizard.mjs';

export const PRACTICE=fileURLToPath(import.meta.url);
// Demo and dashboard check: run these instead of the real scripts. The owner's line runs the practice script too.
export function practiceSetup({elevated=false,steps={},node=process.execPath}={}){
 const env={RLB_PRACTICE:JSON.stringify({elevated,steps})};
 return {practice:true,launch:(file,args)=>({command:node,args:[PRACTICE,basename(file),...args.map(a=>typeof a==='string'?a:a.value)],env}),
  command:(file,args,result)=>powershellCommand(node,[{value:PRACTICE},{value:basename(file)},...args],result)};
}

const PLANS={
 '01-New-ServerAccount.ps1':['Create the test account rlbserver',['Refuse if rlbserver already exists and is in any group other than Users','New-LocalUser rlbserver (password typed by you, never expires), member of Users only','Hide rlbserver from the sign-in screen','Print the account SID'],true],
 '02-Prepare-Server.ps1':['Prepare the original server and the locked-down test copy',['Check the zip is 543636040 bytes with the verified SHA-256','Extract it to C:\\RLB-host\\server\\original and check rust_server.exe','Replace C:\\RLB-host\\server\\test with a fresh copy of the original','Move VAC2.dll to C:\\RLB-host\\quarantine','Set LumaEmu.ini Offline=1, Master=0, UnlockDLC=2','Set folder permissions: rlbserver may change the test copy only'],true],
 '01-Set-GameVpsConfig.ps1':['Point the host-test kit at the public game VPS (eu1.your-domain.example)',['Public address 203.0.113.83; your address 203.0.113.7','Write the gateway and sidecar templates (gateway on 203.0.113.83:443, LauncherOnly=true)',"Windows Firewall group 'RLB game vps': allow inbound TCP 443 for node.exe from Cloudflare's ranges only","Limit 'Remote Desktop' and 'OpenSSH-Server-In-TCP' to 203.0.113.7"],true],
 '03-Set-Firewall.ps1':['Firewall lock-down for the test server',["Remove any existing rules in group 'RLB host test'",'Outbound BLOCK, program rust_server.exe in the test copy, all profiles','Inbound BLOCK, program rust_server.exe in the test copy, all profiles','Outbound BLOCK for every program running as rlbserver','Turn on dropped-packet logging for every profile'],true],
 '04-Test-Isolation.ps1':['Isolation check',['Static checks (account, firewall rules, verified exe, removed files, LumaEmu settings, secrets folder)','Open a test listener on 127.0.0.1 (random port) in this session','Run a probe as rlbserver: the internet and your router must fail, 127.0.0.1 must work','Warn if this PC has a default route to the internet']],
 '08-New-Secrets.ps1':['Generate the bridge secrets',['Write into C:\\RLB-host\\secrets: control.key, plugin.key, metrics.token, gateway-tls.pass','Never print the values']],
 '09-New-GatewayCert.ps1':['Create the gateway test certificate',['New-SelfSignedCertificate for 127.0.0.1 / localhost, ECDSA P-256, 90 days','Export it with its key to C:\\RLB-host\\secrets\\gateway-tls.pfx, then delete it from the store','Write the public certificate and its SHA-256 fingerprint to C:\\RLB-host\\config']],
 '02-New-OriginCsr.ps1':['Create the gateway key and a Cloudflare Origin certificate request',['certreq -new: ECDSA P-256 key in the LocalMachine store, CN=eu1.your-domain.example','Write the request to C:\\RLB-host\\config\\origin.csr and print it']],
 '03-Install-OriginCert.ps1':['Install the Cloudflare Origin certificate for the gateway',['certreq -accept (pairs it with the key from the request)','Check: issued by CloudFlare Origin CA, valid for eu1.your-domain.example','Export certificate and key to C:\\RLB-host\\secrets\\gateway-tls.pfx, then delete both from the store']],
 '10-Patch-TestCopy.ps1':['Patch the test copy for browser admission',["Refuse unless the test copy's Assembly-CSharp.dll is the allowlisted build",'Copy the adapter DLL into the test copy','Run VanillaPatcher check, patch and verify (our tool; reads IL as data)','Write rustlegacybrowser.cfg and refresh the test-copy baseline']],
 '11-Initialize-Central.ps1':['Initialise central (127.0.0.1:8080)',['Create C:\\RLB-host\\central\\keys','If no signing key exists: node tools\\central.mjs new-key','Write C:\\RLB-host\\central\\central.json','node tools\\central.mjs check']],
 '13-Enrol-Gateway.ps1':['Enrol the gateway with central',['Write C:\\RLB-host\\config\\gateway.json and sidecar.json','node tools\\gateway.mjs enrol (stores C:\\RLB-host\\secrets\\gateway.credential)','node tools\\gateway.mjs check']],
 '17-Register-ServerTask.ps1':['Register the password-free server start',['Refuse unless rlbserver exists and is a standard user',"Grant rlbserver 'Log on as a batch job'",'Ask for the password of rlbserver in a Windows prompt (kept by Task Scheduler only)','Register task RLB-OriginalServer (no trigger, starts nothing now)'],true],
 '05-Start-Server.ps1':['Start the original server (firewall-locked, test account)',['Run every lock-down check; refuse on any FAIL','Start Process Monitor','Check scheduled task RLB-OriginalServer, then start it','Wait up to 180 s for UDP 29015 on 127.0.0.1'],false,true],
};
const DONE={'01-New-ServerAccount.ps1':'rlbserver SID: S-1-5-21-0-0-0-1001','02-Prepare-Server.ps1':'Test copy ready: C:\\RLB-host\\server\\test (1874 files).','01-Set-GameVpsConfig.ps1':'Config templates written. Firewall: 443 from 22 Cloudflare ranges (node.exe); RDP/SSH from 203.0.113.7 only.',
 '03-Set-Firewall.ps1':'Firewall rules in place. Next: 04-Test-Isolation.ps1 -Apply.','08-New-Secrets.ps1':'Next: 09-New-GatewayCert.ps1 -Apply.','09-New-GatewayCert.ps1':'Next: 10-Patch-TestCopy.ps1 -Apply.',
 '02-New-OriginCsr.ps1':'Then save the certificate Cloudflare shows (PEM) on this VPS and run 03-Install-OriginCert.ps1.','03-Install-OriginCert.ps1':'Key and certificate are only in C:\\RLB-host\\secrets\\gateway-tls.pfx now.',
 '10-Patch-TestCopy.ps1':'Patched test copy ready.','11-Initialize-Central.ps1':'Central ready: C:\\RLB-host\\central\\central.json.','13-Enrol-Gateway.ps1':'Gateway enrolled. Next: 14-Start-Bridge.ps1 -Apply.',
 '17-Register-ServerTask.ps1':'Registered RLB-OriginalServer (runs as rlbserver, password stored by Task Scheduler).','05-Start-Server.ps1':'Server listening on UDP 29015.'};
const ROWS=[['test account is a standard user','PASS','rlbserver groups: Users'],['RLB host test: block server outbound','PASS','enabled, block, all profiles'],['RLB host test: block server inbound','PASS','enabled, block, all profiles'],
 ['RLB host test: block test account outbound','PASS','enabled, block, all profiles'],['rust_server.exe is the verified Unity player','PASS','7D80D881AD9B7D45…'],['secrets folder closed to the test account','PASS','C:\\RLB-host\\secrets'],
 ['probe as rlbserver: outside blocked','PASS','1.1.1.1:443, 8.8.8.8:53, 13.107.4.52:80 all failed'],['probe as rlbserver: loopback works','PASS','127.0.0.1:50123'],
 ['PC offline during runs','WARN',"default route via 192.168.1.1: DNS lookups would still leave through Windows' DNS service"]];

async function main(){
 const [name,...args]=process.argv.slice(2),cfg=JSON.parse(process.env.RLB_PRACTICE??'{}'),step=STEPS.find(s=>s.script.endsWith('/'+name));
 const plan=PLANS[name];if(!step||!plan){console.error(`practice: unknown script ${name}`);process.exit(2);}
 const say=t=>process.stdout.write(t+'\n'),err=t=>process.stderr.write(t+'\n'),wait=ms=>new Promise(r=>setTimeout(r,ms)),mark=o=>say('##rlb '+JSON.stringify(o));
 const [title,steps,security,original]=plan,json=args.includes('-Json'),apply=args.includes(step.original?'-ConfirmRunOriginalBinaries':'-Apply');
 const outcome=cfg.steps?.[name]??'pass';
 // PowerShell's report of a terminating error (throw), on stderr, as powershell.exe -File prints it.
 const thrown=(msg,where=`C:\\RLB\\deploy\\host-test\\scripts\\${name}:40 char:5`)=>{err(msg);err(`At ${where}`);err(`+     throw '${msg.slice(0,40)}…'`);err('+     ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');err(`    + CategoryInfo          : OperationStopped: (${msg.slice(0,30)}…:String) [], RuntimeException`);process.exit(1);};
 say('');say(`== ${title} ==`);say('This script will:');steps.forEach((s,i)=>say(`  ${i+1}. ${s}`));
 if(security){say('');say('  !! This changes Windows security settings (accounts, firewall or folder permissions) on THIS PC.');say('  !! 99-Remove.ps1 undoes it.');}
 if(original){say('');say('  !! This EXECUTES THE ORIGINAL SERVER on this PC, as the locked-down test account.');}
 say('');
 if(json)mark({type:'plan',title,steps,changesSecurity:Boolean(security),runsOriginalBinaries:Boolean(original),elevated:cfg.elevated===true});
 if(!apply){say(`Dry run only. Nothing was changed. Re-run with -${step.original?'ConfirmRunOriginalBinaries':'Apply'} to perform the steps above.`);return;}
 say('Practice run: nothing on this PC changes.');
 if(step.admin&&cfg.elevated!==true){if(json)mark({type:'needs-admin'});thrown('Run this script from an elevated PowerShell (Run as administrator).','C:\\RLB\\deploy\\host-test\\scripts\\_Common.ps1:118 char:68');}
 await wait(150);
 if(outcome==='slow')for(let i=1;i<=12;i++){say(`working… ${i}/12`);await wait(150);}
 if(outcome==='fail')thrown(`${title} failed (practice): the server zip SHA-256 does not match. Stop.`);
 if(outcome==='denied')thrown("Access to the path 'C:\\RLB-host\\secrets\\control.key' is denied.");
 if(name==='04-Test-Isolation.ps1'){
  const rows=outcome==='rows-fail'?ROWS.map((r,i)=>i===1?[r[0],'FAIL','missing or changed (03-Set-Firewall.ps1)']:r):ROWS;
  say('');say('Check'.padEnd(46)+'Status Detail');say('-----'.padEnd(46)+'------ ------');for(const r of rows)say(r[0].padEnd(46)+r[1].padEnd(7)+r[2]);say('');
  if(json)mark({type:'result',status:rows.some(r=>r[1]==='FAIL')?'FAIL':rows.some(r=>r[1]==='WARN')?'WARN':'PASS',detail:'',rows:rows.map(([check,status,detail])=>({check,status,detail}))});
  if(rows.some(r=>r[1]==='FAIL')){say('1 check(s) failed. Do not start the server.');process.exit(1);}
  say('Isolation check passed.');return;
 }
 say(`${steps[0]}: done`);await wait(100);
 say(DONE[name]);
 if(outcome==='warn'&&json)mark({type:'result',status:'WARN',detail:'cloudflare.com unreachable: used the ranges built into bridge/client-ip.mjs (practice)',rows:[]});
 else if(name==='09-New-GatewayCert.ps1'&&json)mark({type:'result',status:'PASS',detail:'certificate for 127.0.0.1, SHA-256 3F2A…(practice)',rows:[]});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
