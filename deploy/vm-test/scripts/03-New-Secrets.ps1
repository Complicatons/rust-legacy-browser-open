<#
.SYNOPSIS
  VM only. Generates the test secrets inside the VM (they never leave it and are never committed):
  control.key and plugin.key (32 random bytes as hex, shared by gateway/sidecar/adapter), metrics.token,
  rcon.password (the server's rcon/admin password for this test), gateway-tls.pass (PFX passphrase).
  Existing files are kept unless -Rotate. -ShowRcon prints the rcon password (needed for rcon.login from the browser).
#>
param([switch]$Apply, [switch]$Rotate, [switch]$ShowRcon)
. (Join-Path $PSScriptRoot '_Common.ps1')
Assert-NotHost
$p = Get-RlbPaths

function New-RandomHex([int]$Bytes) {
    $b = New-Object byte[] $Bytes
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($b); $rng.Dispose()
    return (($b | ForEach-Object { $_.ToString('x2') }) -join '')
}
function New-RandomPassword([int]$Length) {
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
    $b = New-Object byte[] ($Length * 2)
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($b); $rng.Dispose()
    $out = ''
    foreach ($x in $b) { if ($x -lt (256 - (256 % $alphabet.Length))) { $out += $alphabet[$x % $alphabet.Length] }; if ($out.Length -eq $Length) { break } }
    return $out
}

$secrets = [ordered]@{
    'control.key'      = { New-RandomHex 32 }
    'plugin.key'       = { New-RandomHex 32 }
    'metrics.token'    = { New-RandomHex 24 }
    'rcon.password'    = { New-RandomPassword 16 }
    'gateway-tls.pass' = { New-RandomHex 24 }
}
$todo = @($secrets.Keys | Where-Object { $Rotate -or -not (Test-Path -LiteralPath (Join-Path $p.Secrets $_)) })
if (-not $Apply -and $ShowRcon -and $todo.Count -eq 0) { Write-Host ('rcon.password: ' + (Read-Secret 'rcon.password')); exit 0 }
Write-Plan 'Generate VM test secrets' (@("Write into $($p.Secrets) (owner, SYSTEM and Administrators only): " + ($(if ($todo.Count) { $todo -join ', ' } else { 'nothing (all present; use -Rotate to replace)' }))) + @('Never print key values; -ShowRcon prints only the rcon password'))
Confirm-OrExit $Apply.IsPresent 'Apply'
New-RlbDirs
Protect-SecretsDir
foreach ($name in $todo) { Write-RlbFileNoBom (Join-Path $p.Secrets $name) ((& $secrets[$name]) + "`n"); Write-Host "wrote $name" }
if ($Rotate) { Write-Host 'Rotated: rebuild the test copy (05/06) so server.cfg and rustlegacybrowser.cfg pick up the new values.' -ForegroundColor Yellow }
if ($ShowRcon) { Write-Host ('rcon.password: ' + (Read-Secret 'rcon.password')) }
