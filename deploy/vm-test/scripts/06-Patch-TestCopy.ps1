<#
.SYNOPSIS
  VM only. Applies the vanilla patcher (tools/vanilla-patcher, Mono.Cecil, SHA-256 allowlist) to the TEST COPY's
  Assembly-CSharp.dll. The pristine C:\RLB\server\original is never touched; the patcher also keeps
  Assembly-CSharp.dll.rlb-original next to the patched file. The patcher reads/rewrites IL as data and does not
  load or run game code. Writes rust_server_Data\cfg\rustlegacybrowser.cfg with the plugin key. Dry run unless -Apply.
#>
param([switch]$Apply)
. (Join-Path $PSScriptRoot '_Common.ps1')
Assert-NotHost
$s = Get-RlbSettings
$p = Get-RlbPaths
$managed = Join-Path $p.TestCopy 'rust_server_Data\Managed'
$adapterDll = Join-Path $p.App 'adapter\RustLegacyBrowser.Vanilla.dll'
$patcher = Join-Path $p.App 'adapter\patcher\VanillaPatcher.exe'

Write-Plan 'Patch the test copy for browser admission' @(
    "Refuse unless the test copy's Assembly-CSharp.dll is the allowlisted build $($s.server.assemblyCSharpSha256)",
    "Copy $adapterDll into $managed",
    "Run VanillaPatcher check, then patch, then verify on $managed (our tool; reads IL as data)",
    'Check Assembly-CSharp.dll.rlb-original still has the allowlisted hash and the pristine original is unchanged',
    'Write rust_server_Data\cfg\rustlegacybrowser.cfg (SidecarUrl on 127.0.0.1, PluginKeyHex from C:\RLB\secrets\plugin.key)'
)
Confirm-OrExit $Apply.IsPresent 'Apply'
foreach ($f in @($adapterDll, $patcher)) { if (-not (Test-Path -LiteralPath $f)) { throw "Missing $f. Build it on the host (deploy\vm-test\host\Build-AdapterOutputs.ps1) and rebuild the tools ISO." } }
if (@(Get-Process rust_server -ErrorAction SilentlyContinue).Count) { throw 'Stop the server first (08-Stop-Server.ps1).' }
$target = Join-Path $managed 'Assembly-CSharp.dll'
$h = Get-Sha256 $target
if ($h -ne $s.server.assemblyCSharpSha256.ToUpperInvariant()) { throw "Test copy Assembly-CSharp.dll is $h, not the allowlisted build. Recreate the copy with 05-New-TestCopy.ps1." }

Copy-Item -LiteralPath $adapterDll -Destination $managed -Force
$log = Join-Path $p.Logs ("patcher-{0}.log" -f (Get-Stamp))
foreach ($verb in @('check', 'patch', 'verify')) {
    $out = & $patcher $verb $managed 2>&1
    $code = $LASTEXITCODE
    ("== {0} (exit {1})" -f $verb, $code) | Add-Content -LiteralPath $log
    $out | Add-Content -LiteralPath $log
    $out | Write-Host
    if ($code -ne 0) { throw "VanillaPatcher $verb failed (exit $code); see $log" }
}
$backup = Join-Path $managed 'Assembly-CSharp.dll.rlb-original'
if ((Get-Sha256 $backup) -ne $s.server.assemblyCSharpSha256.ToUpperInvariant()) { throw 'Backup copy does not have the allowlisted hash.' }
if ((Get-Sha256 (Join-Path $p.Original 'rust_server_Data\Managed\Assembly-CSharp.dll')) -ne $s.server.assemblyCSharpSha256.ToUpperInvariant()) { throw 'The pristine original changed. Stop and investigate.' }

$cfgDir = Join-Path $p.TestCopy 'rust_server_Data\cfg'
if (-not (Test-Path -LiteralPath $cfgDir)) { New-Item -ItemType Directory -Path $cfgDir | Out-Null }
$template = [IO.File]::ReadAllText((Join-Path $script:RlbDeployDir 'config\rustlegacybrowser.cfg.template'))
$pluginKey = Read-Secret 'plugin.key'
if ($pluginKey -notmatch '^([0-9a-f]{2}){32,}$') { throw 'plugin.key must hold 32+ bytes of hex.' }
[IO.File]::WriteAllText((Join-Path $cfgDir 'rustlegacybrowser.cfg'), $template.Replace('__PLUGIN_KEY_HEX__', $pluginKey), (New-Object Text.ASCIIEncoding))
("patched Assembly-CSharp.dll SHA-256 {0}" -f (Get-Sha256 $target)) | Tee-Object -FilePath $log -Append | Write-Host
Write-Host "Patched test copy ready. Patcher log: $log" -ForegroundColor Green
