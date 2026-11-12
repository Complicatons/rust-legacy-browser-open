// Game loader installer (deploy/launcher, copied into build/launcher/app by tools/build-launcher.mjs). There is no
// PowerShell off Windows, so the scripts are checked statically here: brackets and strings balance, nothing changes
// before the -Apply gate, the install stays inside this user's profile, and the uninstall removes the launch profile
// only through the loader's own --remove-profile. On Windows they are also parsed and dry-run by PowerShell itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {LAUNCHER_SCRIPTS} from '../tools/build-launcher.mjs';
import {psBalance,body,gate,CHANGES} from './helpers/powershell.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const install=read('deploy/launcher/Install-RustLegacyLauncher.ps1'),uninstall=read('deploy/launcher/Uninstall-RustLegacyLauncher.ps1');
const windows=process.platform==='win32';

test('lexer: catches what it is for', ()=>{
 assert.ok(psBalance(`$a = "x $(if ($b) { "y)" } else { 'z(' })" # (\n<# { #>\n@{ k = 'it''s' }`));
 for(const bad of ['if ($a) {','"open','$x = @(1, 2]','"$(1 + (2)"'])assert.throws(()=>psBalance(bad),bad);
});

test('loader installer scripts: balanced, and nothing changes before the -Apply gate', ()=>{
 for(const [name,src] of [['install',install],['uninstall',uninstall]]){
  assert.ok(psBalance(src),name);
  const run=body(src),at=run.search(gate);
  assert.ok(at>0,name+': dry-run gate');
  const first=run.search(CHANGES);
  assert.ok(first>at,`${name}: first change (${run.slice(first,first+40)}) comes after the gate`);
  assert.match(src,/param\([^\n]*\[switch\]\$Apply\)\r?\n/,name+' takes -Apply');
  assert.match(src,/Set-StrictMode -Version 2\r?\n\$ErrorActionPreference = 'Stop'/);
  assert.match(src,/Join-Path \$env:LOCALAPPDATA 'Programs\\RustLegacyLauncher'/,name+': per-user default folder');
  assert.doesNotMatch(run,/IsInRole|RunAs|Program Files|ProgramData/,name+': no administrator rights, nothing machine-wide');
 }
});

test('loader install: checks WebView2 and .NET 8 before changing anything, writes only to this user', ()=>{
 const run=body(install),at=run.search(gate);
 assert.match(install,/\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5\}/,'WebView2 Runtime client key');
 assert.match(install,/Microsoft\.WindowsDesktop\.App/);assert.match(install,/'8\.\*'/);
 assert.match(install,/coreclr\.dll/,'a self-contained build skips the .NET check');
 const refuse=run.indexOf("if ($missing.Count -gt 0) { throw");
 assert.ok(refuse>at&&refuse<run.slice(at+1).search(CHANGES)+at+1,'a missing runtime stops -Apply before any change');
 // Registry writes go to HKCU only (HKLM is only read, for the machine-wide WebView2 install).
 assert.match(install,/\$appsKey = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RustLegacyLauncher'/);
 for(const m of run.matchAll(/(New-Item|New-ItemProperty|Set-ItemProperty)\b[^\n]*-Path (\S+)/g))assert.ok(['$appsKey','$InstallDir'].includes(m[2]),m[0]);
 assert.match(install,/\$programsDir = Get-UserFolder 'Programs' /);assert.match(install,/\$startMenu = Join-Path \$programsDir 'Rust Legacy Launcher\.lnk'/,'Start menu shortcut');
 assert.match(install,/UninstallString = \$uninstall/);assert.match(install,/\$InstallDir\\Uninstall-RustLegacyLauncher\.ps1/);
 // Running loader: refuse instead of copying over its files.
 assert.match(install,/Get-Process -Name 'RustLegacyLauncher'/);
});

test('loader uninstall: the launch profile goes only through the loader, then shortcuts, files and (if asked) data', ()=>{
 const run=body(uninstall);
 assert.match(read('launcher/host/Program.cs'),/args\[0\] == "--remove-profile"/,'the switch the exe understands');
 const removeProfile=run.indexOf("Start-Process -FilePath $exe -ArgumentList '--remove-profile' -Wait -PassThru");
 assert.ok(removeProfile>0);
 assert.ok(removeProfile<run.indexOf('Remove-Item'),'nothing is deleted before the profile is gone');
 assert.doesNotMatch(run,/Remove-Item[^\n]*\$profileDir/,'PowerShell never deletes the profile (junctions into the game)');
 assert.match(run,/if \(\$p\.ExitCode -ne 0 -or \(Test-Path -LiteralPath \$profileDir\)\) \{ throw/);
 assert.match(run,/if \(Test-Path -LiteralPath \$profileDir\) \{ throw "\$profileDir is still there; \$dataDir was kept\." \}\s+Remove-Item -Recurse -Force -LiteralPath \$dataDir/,'data only after the profile is gone');
 assert.match(run,/foreach \(\$l in \$links\) \{ if \(Test-Path -LiteralPath \$l\) \{ Remove-Item/,'shortcuts');
 assert.match(run,/Remove-Item -Recurse -Force -LiteralPath \$appsKey/);
 assert.match(uninstall,/'Rust Legacy Launcher\.lnk'/);
});

test('loader build copies both scripts next to the exe', ()=>{
 assert.deepEqual(new Set(LAUNCHER_SCRIPTS),new Set(readdirSync(new URL('../deploy/launcher/',import.meta.url)).filter(f=>f.endsWith('.ps1'))));
 assert.match(read('tools/build-launcher.mjs'),/for\(const f of LAUNCHER_SCRIPTS\)copyFileSync\(path\.join\(root,'deploy\/launcher',f\),path\.join\(app,f\)\);/);
});

test('loader installer scripts parse and their dry run changes nothing',{skip:!windows},()=>{
 const ps=args=>spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',...args],{encoding:'utf8',windowsHide:true});
 for(const f of LAUNCHER_SCRIPTS){
  const path=join('deploy','launcher',f).replace(/'/g,"''");
  const parse=ps(['-Command',`$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path '${path}'),[ref]$null,[ref]$e);$e.Count`]);
  assert.equal(parse.stdout.trim(),'0',f+' parse errors');
  const dir=join(tmpdir(),'rlb-launcher-never-installed'),dry=ps(['-File',join('deploy','launcher',f),'-InstallDir',dir]);
  assert.equal(dry.status,0,dry.stderr);assert.match(dry.stdout,/Dry run only\. Nothing was changed/);assert.ok(!existsSync(dir));
 }
});
