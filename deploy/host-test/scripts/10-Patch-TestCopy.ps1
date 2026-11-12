<#
.SYNOPSIS
  Applies the vanilla patcher (our tools/vanilla-patcher: Mono.Cecil, SHA-256 allowlist) to the TEST COPY's
  Assembly-CSharp.dll so browser players are admitted through the sidecar. The patcher reads and rewrites IL as data;
  it never loads or runs game code. The pristine original is never touched, and the patcher keeps
  Assembly-CSharp.dll.rlb-original next to the patched file. Also writes rust_server_Data\cfg\rustlegacybrowser.cfg
  (sidecar URL on 127.0.0.1, plugin key) and refreshes manifests\test-baseline.csv.
  Uses build\vm-test\adapter (deploy\vm-test\host\Build-AdapterOutputs.ps1); refuses an adapter DLL older than its
  source unless -AllowStaleAdapter. Server must be stopped. Dry run unless -Apply.
#>
param([switch]$Apply, [switch]$AllowStaleAdapter, [switch]$Json)
. (Join-Path $PSScriptRoot '_Common.ps1')
$s = Get-RlbSettings
$p = Get-RlbPaths
$managed = Join-Path $p.TestCopy 'rust_server_Data\Managed'
$adapterDll = Join-Path $script:RlbRepo 'build\vm-test\adapter\RustLegacyBrowser.Vanilla.dll'
$patcher = Join-Path $script:RlbRepo 'build\vm-test\adapter\patcher\VanillaPatcher.exe'

Write-Plan 'Patch the test copy for browser admission' @(
    "Refuse unless the test copy's Assembly-CSharp.dll is the allowlisted build $($s.server.assemblyCSharpSha256)",
    "Refuse if $adapterDll is older than adapter\vanilla\*.cs",
    "Copy the adapter DLL into $managed",
    "Run VanillaPatcher check, patch and verify on $managed (our tool; reads IL as data)",
    'Check the backup and the pristine original still have the allowlisted hash',
    'Write rust_server_Data\cfg\rustlegacybrowser.cfg and refresh the test-copy baseline'
)
Confirm-OrExit $Apply.IsPresent 'Apply'
foreach ($f in @($adapterDll, $patcher)) { if (-not (Test-Path -LiteralPath $f)) { throw "Missing $f. Build it with deploy\vm-test\host\Build-AdapterOutputs.ps1." } }
$newestSource = Get-ChildItem -LiteralPath (Join-Path $script:RlbRepo 'adapter\vanilla') -Filter '*.cs' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($newestSource.LastWriteTime -gt (Get-Item -LiteralPath $adapterDll).LastWriteTime -and -not $AllowStaleAdapter) { throw "$adapterDll is older than $($newestSource.Name). Rebuild it (Build-AdapterOutputs.ps1) or pass -AllowStaleAdapter." }
if (Get-PidFromFile 'server.pid') { throw 'Stop the server first (06-Stop-Server.ps1).' }
$target = Join-Path $managed 'Assembly-CSharp.dll'
$h = Get-Sha256 $target
if ($h -ne $s.server.assemblyCSharpSha256) { throw "Test copy Assembly-CSharp.dll is $h, not the allowlisted build. Recreate the copy with 02-Prepare-Server.ps1." }

New-RlbDirs
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
if ((Get-Sha256 $backup) -ne $s.server.assemblyCSharpSha256) { throw 'Backup copy does not have the allowlisted hash.' }
if ((Get-Sha256 (Join-Path $p.Original 'rust_server_Data\Managed\Assembly-CSharp.dll')) -ne $s.server.assemblyCSharpSha256) { throw 'The pristine original changed. Stop and investigate.' }

$cfgDir = Join-Path $p.TestCopy 'rust_server_Data\cfg'
if (-not (Test-Path -LiteralPath $cfgDir)) { New-Item -ItemType Directory -Path $cfgDir | Out-Null }
$template = [IO.File]::ReadAllText((Get-ConfigTemplate 'rustlegacybrowser.cfg.template'))
$pluginKey = Read-Secret 'plugin.key'
if ($pluginKey -notmatch '^([0-9a-f]{2}){32,}$') { throw 'plugin.key must hold 32+ bytes of hex (08-New-Secrets.ps1).' }
[IO.File]::WriteAllText((Join-Path $cfgDir 'rustlegacybrowser.cfg'), $template.Replace('__PLUGIN_KEY_HEX__', $pluginKey), (New-Object Text.ASCIIEncoding))

$rows = foreach ($f in Get-ChildItem -LiteralPath $p.TestCopy -Recurse -File) {
    [pscustomobject]@{ Path = $f.FullName.Substring($p.TestCopy.Length + 1); Bytes = $f.Length; Sha256 = Get-Sha256 $f.FullName }
}
$rows | Export-Csv -NoTypeInformation -LiteralPath (Join-Path $p.Manifests 'test-baseline.csv')
("patched Assembly-CSharp.dll SHA-256 {0}" -f (Get-Sha256 $target)) | Tee-Object -FilePath $log -Append | Write-Host
Write-Host "Patched test copy ready. Patcher log: $log" -ForegroundColor Green
Write-Host 'Next: 11-Initialize-Central.ps1 -Apply.'
