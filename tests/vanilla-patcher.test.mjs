// Automated regression guard for the Fougerite/stock-agnostic admission hook (tools/vanilla-patcher/Program.cs,
// OFFSHOOT-COMPATIBILITY-PLAN.md work item 4): builds a from-scratch synthetic Assembly-CSharp/uLink/Hooks fixture
// (tools/vanilla-patcher/tests/fixture) twice, once in each shape the hook must patch — stock, and Fougerite's own
// 4-instruction delegate-everything body — and runs probe/check/patch/verify plus a driver executable against each
// build. Skips if the dotnet SDK isn't on PATH, same convention as tests/helpers/assets.mjs for private assets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,cpSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot=fileURLToPath(new URL('../',import.meta.url));
const patcherDir=join(repoRoot,'tools','vanilla-patcher');
const fixtureDir=join(patcherDir,'tests','fixture');
const driverProj=join(fixtureDir,'Driver','Driver.csproj');
const stockOut=join(fixtureDir,'Driver','bin','Debug','net8.0');
const fougeriteOut=join(fixtureDir,'out-fougerite');

const dotnetProbe=spawnSync('dotnet',['--version'],{encoding:'utf8'});
const DOTNET_SKIP=dotnetProbe.error||dotnetProbe.status!==0?'dotnet SDK not on PATH':null;
const withDotnet=(opts={})=>DOTNET_SKIP&&!opts.skip?{...opts,skip:DOTNET_SKIP}:opts;

function dotnet(args){
 const r=spawnSync('dotnet',args,{encoding:'utf8',timeout:120000});
 if(r.error)throw r.error;
 return r;
}
const sha256=path=>createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();

// Stock builds in place (tools/vanilla-patcher/tests/fixture/Driver/bin, obj — gitignored); Fougerite builds to its
// own output dir so the two shapes never share a build output. Both are rebuilt at the start of every test, so each
// test starts from a clean, unpatched fixture regardless of what an earlier test in this file did to it.
function buildStock(){
 rmSync(stockOut,{recursive:true,force:true}); // drop any previous run's patch backup/output before rebuilding
 const r=dotnet(['build',driverProj,'--nologo']);
 assert.equal(r.status,0,`dotnet build (stock) failed:\n${r.stdout}\n${r.stderr}`);
 assert.ok(existsSync(join(stockOut,'Assembly-CSharp.dll')));
 return stockOut;
}
function buildFougerite(){
 rmSync(fougeriteOut,{recursive:true,force:true});
 const r=dotnet(['build',driverProj,'--nologo','-p:DefineConstants=FOUGERITE_SHAPE','-o',fougeriteOut]);
 assert.equal(r.status,0,`dotnet build (fougerite) failed:\n${r.stdout}\n${r.stderr}`);
 assert.ok(existsSync(join(fougeriteOut,'Assembly-CSharp.dll')));
 return fougeriteOut;
}
const buildFixture=shape=>shape==='stock'?buildStock():buildFougerite();

// probe never needs the allowlist, so it runs against the real tools/vanilla-patcher project as-is.
const probe=dir=>dotnet(['run','--project',patcherDir,'--','probe',dir]);

// check/patch/verify refuse any build that isn't in Program.cs's allowlist. Running them against the fixture
// without permanently allowlisting a fake hash means building a throwaway copy of just Program.cs + its csproj with
// the fixture's own hash spliced in, and running VanillaPatcher from there — the real committed file is never
// written to.
const ALLOWLIST_LINE=/(^[ \t]*\["CE0DD83271472454FC27CE137A9FA9D042B3A5F12FB26F1C7A67D61EEA3ACFBB"\] = "Rust Legacy server \(community package, May 2015 bundles\)",\r?\n)/m;
function patcherCopyAllowing(hash,label){
 const original=readFileSync(join(patcherDir,'Program.cs'),'utf8');
 const m=original.match(ALLOWLIST_LINE);
 assert.ok(m,'Program.cs allowlist line changed shape; update ALLOWLIST_LINE in this test');
 const eol=m[1].endsWith('\r\n')?'\r\n':'\n';
 const tmp=mkdtempSync(join(tmpdir(),'rlb-patcher-src-'));
 cpSync(join(patcherDir,'VanillaPatcher.csproj'),join(tmp,'VanillaPatcher.csproj'));
 writeFileSync(join(tmp,'Program.cs'),original.replace(ALLOWLIST_LINE,`$1    ["${hash}"] = "${label}",${eol}`));
 return tmp;
}

for(const shape of ['stock','fougerite']){
 test(`probe: finds all 17 admission/evidence hook sites (${shape} shape)`,withDotnet(),()=>{
  const dir=buildFixture(shape);
  const r=probe(dir);
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/17 site\(s\) found, 0 not found\./);
 });

 test(`check, patch, verify round-trip, then the hook fires with correctly-parsed fields (${shape} shape)`,withDotnet(),()=>{
  const dir=buildFixture(shape);
  const hash=sha256(join(dir,'Assembly-CSharp.dll'));
  const tmp=patcherCopyAllowing(hash,`test fixture (${shape})`);
  try{
   const check=dotnet(['run','--project',tmp,'--','check',dir]);
   assert.equal(check.status,0,check.stdout+check.stderr);
   assert.match(check.stdout,/Supported: test fixture/);
   assert.doesNotMatch(check.stdout,/Adapter missing/);

   const patch=dotnet(['run','--project',tmp,'--','patch',dir]);
   assert.equal(patch.status,0,patch.stdout+patch.stderr);
   assert.match(patch.stdout,/Done\./);

   const verify=dotnet(['run','--project',tmp,'--','verify',dir]);
   assert.equal(verify.status,0,verify.stdout+verify.stderr);
   assert.match(verify.stdout,/Patched build looks complete\./);
  }finally{rmSync(tmp,{recursive:true,force:true});}

  // Craft the same loginData bytes ClientConnection.ReadConnectionData reads, run the now-patched method, and check
  // the hook was called with a ClientConnection built from the hook's own independent copy of approval.loginData.
  const runDriver=returnValue=>{
   const r=dotnet(['exec',join(dir,'Driver.dll'),String(returnValue)]);
   assert.equal(r.status,0,r.stdout+r.stderr);
   return JSON.parse(r.stdout.trim());
  };
  const results={false:runDriver(false),true:runDriver(true)};
  for(const returnValue of [false,true]){
   const result=results[returnValue];
   assert.equal(result.hookCalled,true);
   assert.equal(result.protocol,1069);
   assert.equal(result.connectionMode,2);
   assert.equal(result.userId,'76561197960287930');
   assert.equal(result.userName,'tester');
   assert.equal(result.steamTicketHex,'524C4241010203');
  }
  // Stock's own body only runs when the hook lets it through (returnValue=false): proves the hook's independent
  // BitStream copy over loginData never disturbs the original field's own, separate read position, and that
  // returnValue=true correctly skips the original body instead. Fougerite's stand-in body is a no-op either way,
  // so this distinction only shows up for the stock shape.
  if(shape==='stock'){
   assert.equal(results[false].connectionsAfter,1);
   assert.equal(results[true].connectionsAfter,0);
  }
 });
}
