<#
.SYNOPSIS
  Generates the bridge secrets into C:\RLB-host\secrets (closed to the test account and other users since
  02-Prepare-Server.ps1): control.key and plugin.key (32 random bytes as hex; gateway, sidecar and the patched
  server share them), metrics.token, gateway-tls.pass (passphrase of the gateway's test certificate).
  Existing files are kept unless -Rotate. Values are never printed. Our code only. Dry run unless -Apply.
#>
param([switch]$Apply, [switch]$Rotate, [switch]$Json)
. (Join-Path $PSScriptRoot '_Common.ps1')
$p = Get-RlbPaths

function New-RandomHex([int]$Bytes) {
    $b = New-Object byte[] $Bytes
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($b); $rng.Dispose()
    return (($b | ForEach-Object { $_.ToString('x2') }) -join '')
}
$secrets = [ordered]@{
    'control.key'      = { New-RandomHex 32 }
    'plugin.key'       = { New-RandomHex 32 }
    'metrics.token'    = { New-RandomHex 24 }
    'gateway-tls.pass' = { New-RandomHex 24 }
}
$todo = @($secrets.Keys | Where-Object { $Rotate -or -not (Test-Path -LiteralPath (Join-Path $p.Secrets $_)) })
Write-Plan 'Generate the bridge secrets' @(
    ("Write into $($p.Secrets): " + $(if ($todo.Count) { $todo -join ', ' } else { 'nothing (all present; -Rotate replaces them)' })),
    'Never print the values'
)
Confirm-OrExit $Apply.IsPresent 'Apply'
if (-not (Test-Path -LiteralPath $p.Secrets)) { throw 'Run 02-Prepare-Server.ps1 first (it creates and locks C:\RLB-host).' }
New-RlbDirs
foreach ($name in $todo) { Write-RlbFileNoBom (Join-Path $p.Secrets $name) ((& $secrets[$name]) + "`n"); Write-Host "wrote $name" }
if ($Rotate) { Write-Host 'Rotated: re-run 10-Patch-TestCopy.ps1 and 13-Enrol-Gateway.ps1 so the server and gateway pick up the new keys.' -ForegroundColor Yellow }
Write-Host 'Next: 09-New-GatewayCert.ps1 -Apply.'
