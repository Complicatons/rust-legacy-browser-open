// Desktop launcher contracts that span languages (DESKTOP-LAUNCHER-PLAN.md): the window's WebView2 bridge
// (launcher/ui/hosts.mjs) against the C# host (launcher/host/MainForm.cs), the proxy pipe protocol between the C proxy
// and the C# TicketPipe, and the proxy's export list against what librust.dll imports. The native halves have their
// own tests (node tools/build-launcher.mjs --test); this keeps the pieces in step without building them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8').replace(/\r\n/g,'\n'); // CRLF on a Windows checkout
const hosts=read('launcher/ui/hosts.mjs'),form=read('launcher/host/MainForm.cs'),app=read('launcher/ui/app.mjs');
const proxy=read('launcher/proxy/steam_api_proxy.c'),pipe=read('launcher/host/TicketPipe.cs'),forwards=read('launcher/proxy/forwards.h');
const storage=read('launcher/host/Storage.cs'),hwid=read('launcher/host/HardwareId.cs'),hostTest=read('launcher/host/test/Program.cs');

test('launcher bridge: every call the window makes is handled by the host, and every host event is heard', ()=>{
 const webview=hosts.slice(hosts.indexOf('export function webviewHost'),hosts.indexOf('export function demoHost'));
 const calls=[...webview.matchAll(/call\('(\w+)'/g)].map(m=>m[1]);
 const posts=[...webview.matchAll(/postMessage\(\{method:'(\w+)'/g)].map(m=>m[1]);
 assert.deepEqual(new Set(calls),new Set(['settings','fetch','loadToken','saveToken','saveLogin','hardwareId','launchGame','chooseGameFolder','openUrl']));
 for(const m of calls)assert.ok(form.includes(`case "${m}":`),`MainForm handles ${m}`);
 for(const m of posts)assert.ok(form.includes(`method == "${m}"`),`MainForm handles posted ${m}`);
 for(const e of [...form.matchAll(/\["event"\] = "(\w+)"/g)].map(m=>m[1]))assert.ok(app.includes(`host.on('${e}'`),`window listens for ${e}`);
 // The ticket the window hands back is what OnTicket parses: backendId as a decimal string, envelope base64.
 assert.match(form,/ulong\.TryParse\(\(string\)t\["backendId"\]/);
 assert.match(form,/Convert\.FromBase64String\(\(string\)t\["envelope"\]/);
});

test('launcher pipe: the C proxy and the C# pipe speak the same frames', ()=>{
 // Reply: status byte (0 not armed, 1 ok, 2 refused), u64 id at 1, u16 length at 9, data at 11; tickets ≤ 1024.
 assert.match(proxy,/memcpy\(&backendId, r \+ 1, 8\)/);
 assert.match(proxy,/memcpy\(&n, r \+ 9, 2\)/);
 assert.match(proxy,/static unsigned char r\[11 \+ 1024\]/);
 assert.match(pipe,/BitConverter\.GetBytes\(id\)\.CopyTo\(b, 1\)/);
 assert.match(pipe,/BitConverter\.GetBytes\(\(ushort\)data\.Length\)\.CopyTo\(b, 9\)/);
 assert.match(pipe,/MaxTicket = 1024/);
 // AnswerCore returns (reply, log line) since the pipe log (16d809e).
 assert.match(pipe,/return \(new byte\[\] \{ 0 \}, "not armed/,'not armed');
 assert.match(pipe,/return \(new byte\[\] \{ 2 \}, "/,'refused');
 assert.match(proxy,/rlb-launcher-/);assert.match(pipe,/"rlb-launcher-" \+ WindowsIdentity\.GetCurrent\(\)\.User\.Value/);
 // The pipe answers inside the server's 10 s approval wait, and the proxy waits a little longer than the pipe.
 const wait=Number(pipe.match(/TimeSpan\.FromSeconds\(([\d.]+)\)/)[1]),proxyWait=Number(proxy.match(/PIPE_TICKET_TIMEOUT (\d+)/)[1])/1000;
 assert.ok(wait<proxyWait&&proxyWait<10,`pipe ${wait} s < proxy ${proxyWait} s < 10 s`);
});

test('launcher proxy: forwards every stock steam_api export except the two it wraps, including all of librust\'s imports', ()=>{
 const names=[...forwards.matchAll(/\/EXPORT:(\w+)=steam_api_upstream\.(\w+)/g)];
 assert.equal(names.length,65);
 for(const [,a,b] of names)assert.equal(a,b);
 const forwarded=new Set(names.map(m=>m[1]));
 assert.ok(!forwarded.has('SteamUser')&&!forwarded.has('SteamFriends'));
 assert.match(proxy,/__declspec\(dllexport\) void \*__cdecl SteamUser\(void\)/);
 assert.match(proxy,/__declspec\(dllexport\) void \*__cdecl SteamFriends\(void\)/);
 // librust.dll's steam_api imports (tools/pe-imports.mjs on the stock client, sha256 7cc1d293...f349b).
 const librust=['SteamAPI_WriteMiniDump','SteamAPI_SetMiniDumpComment','SteamGameServer_RunCallbacks','SteamGameServer_Init','SteamGameServer_Shutdown',
  'SteamGameServer','SteamMatchmakingServers','SteamAPI_UnregisterCallback','SteamAPI_RegisterCallback','SteamScreenshots','SteamAPI_Init','SteamMatchmaking',
  'SteamApps','SteamAPI_IsSteamRunning','SteamAPI_RunCallbacks','SteamAPI_RestartAppIfNecessary','SteamAPI_Shutdown','SteamUtils'];
 for(const n of librust)assert.ok(forwarded.has(n),n);
});

test('launcher bridge: the browser demo host offers everything the WebView2 host does', ()=>{
 // The object each host function returns: one property per line in webviewHost, several per line in demoHost.
 const returned=src=>src.slice(src.lastIndexOf('\n return {'));
 const webview=new Set([...returned(hosts.slice(0,hosts.indexOf('export function demoHost'))).matchAll(/^  (\w+):/gm)].map(m=>m[1]));
 const demo=new Set([...returned(hosts).matchAll(/(?:^|[\s,{])(\w+):/g)].map(m=>m[1]));
 assert.ok(webview.has('saveLogin')&&webview.has('hardwareId')&&webview.has('fetch'));
 for(const k of webview)assert.ok(demo.has(k),'demo host has '+k);
});

test('launcher settings: the remembered login is a name in settings.json, never a password', ()=>{
 assert.match(storage,/public string Login \{ get; set; \}/);
 assert.doesNotMatch(storage,/public string \w*Password/i);
 assert.match(form,/\["login"\] = settings\.Login/,'settings hands the page the remembered name');
 assert.match(form,/case "saveLogin":\s+settings\.Login = Storage\.CleanLogin\(\(string\)p\?\["login"\]\);\s+Storage\.SaveSettings\(settings\);/);
 assert.match(app,/settings\.login/,'the window prefills it');
});

// DESKTOP-LAUNCHER-PLAN.md "Hardware ID": the C# host and central agree on the shape; the formula is pinned by a vector
// computed here and checked by the C# host test.
test('launcher hardware ID: C# formula, test vector and central\'s pattern agree', async()=>{
 const id=(a,b,c)=>'v1:'+createHash('sha256').update('rlb-hwid-v1\0'+a+'\0'+b+'\0'+c,'utf8').digest('base64url');
 const parts=['6f1c0e2a-4b7d-4e8f-9a10-2b3c4d5e6f70','4C4C4544-0042-3510-8051-B4C04F4E4D32','1A2B3C4D'];
 assert.ok(hostTest.includes(`HardwareId.FromParts("${parts.join('", "')}") == "${id(...parts)}"`),'vector in test/Program.cs');
 assert.ok(hostTest.includes(`HardwareId.FromParts("", "", "") == "${id('','','')}"`),'empty-parts vector');
 const {HWID}=await import('../central/identity.mjs');
 assert.match(id(...parts),HWID);
 assert.match(hwid,/const string Salt = "rlb-hwid-v1\\0";/);
 assert.match(hwid,/Salt \+ \(machineGuid \?\? ""\) \+ "\\0" \+ \(systemUuid \?\? ""\) \+ "\\0" \+ \(volumeSerial \?\? ""\)/);
 assert.match(hwid,/"v1:" \+ Convert\.ToBase64String\(hash\)\.TrimEnd\('='\)\.Replace\('\+', '-'\)\.Replace\('\/', '_'\)/,'base64url, no padding');
 assert.match(hwid,/Win32_ComputerSystemProduct/);assert.match(hwid,/SOFTWARE\\Microsoft\\Cryptography/);assert.match(hwid,/RegistryView\.Registry64/);
 assert.match(hwid,/VolumeSerial\(@"C:\\"\)/);
 assert.match(form,/case "hardwareId":/);
 assert.match(read('launcher/host/test/LauncherHostTest.csproj'),/HardwareId\.cs/);
});
