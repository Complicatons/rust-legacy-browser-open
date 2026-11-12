// LauncherOnly (OFFSHOOT-COMPATIBILITY-PLAN.md "Our servers: launcher only"): both adapters must read the same
// option, default it off, and refuse non-envelope logins with the same error when it is on. The plugins are never
// run here (that would load game DLLs), so this pins their source.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const oxide=readFileSync(new URL('../adapter/RustLegacyBrowser.cs',import.meta.url),'utf8');
const vanilla=readFileSync(new URL('../adapter/vanilla/RustLegacyBrowserVanilla.cs',import.meta.url),'utf8');
const template=readFileSync(new URL('../deploy/azure-test/config/rustlegacybrowser.cfg.template',import.meta.url),'utf8');

function nativeBranch(src){
  const at=src.indexOf('if (!IsEnvelope(connection.SteamTicket))');
  assert.ok(at>0,'envelope check in OnUserApprove');
  return src.slice(at,src.indexOf('}',at)+1);
}

test('launcher only: off by default in both adapters and the shipped config', ()=>{
  assert.match(oxide,/Config\["LauncherOnly"\] = false;/);
  assert.match(oxide,/Config\["LauncherOnly"\] != null && Convert\.ToBoolean/,'older Oxide configs without the key stay open');
  assert.match(vanilla,/Get\(config, "LauncherOnly", "false"\)/);
  assert.match(vanilla,/PluginKeyHex=\\nLauncherOnly=false\\n/,'the vanilla default file writes it off');
  assert.match(template,/^LauncherOnly=false$/m);
});

test('launcher only: native logins fall through when off and get Authorization failed when on', ()=>{
  for(const [name,src,open] of [['oxide',oxide,'return null;'],['vanilla',vanilla,'return false;']]){
    const branch=nativeBranch(src);
    assert.ok(branch.includes(`if (!launcherOnly) ${open}`),`${name}: off leaves the native path`);
    assert.ok(branch.includes('return Deny(approval, NetError.Facepunch_Connector_AuthFailure);'),`${name}: on refuses`);
  }
  // The vanilla option is read by Load(), which must run before the envelope check.
  const approve=vanilla.slice(vanilla.indexOf('public static bool OnUserApprove'));
  assert.ok(approve.indexOf('Load();')<approve.indexOf('IsEnvelope('),'vanilla loads its config first');
});
