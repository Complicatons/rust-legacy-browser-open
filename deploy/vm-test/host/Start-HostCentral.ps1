<#
.SYNOPSIS
  HOST. Runs the central service (website + accounts + join tickets) in this console, bound only to the host-only
  address 192.168.56.1:8080 so only the host and the test VM can reach it. Account mail (verification/reset links)
  is printed here. Ctrl+C stops it. Our code only.
#>
param()
. (Join-Path $PSScriptRoot '_HostCommon.ps1')
$cfg = Join-Path (Expand-RlbPath $script:RlbSettings.host.stateDir) 'central.json'
if (-not (Test-Path -LiteralPath $cfg)) { throw 'Run Initialize-HostCentral.ps1 -Apply first.' }
Assert-HostOnlyAddress | Out-Null
$c = Get-Content -Raw -LiteralPath $cfg | ConvertFrom-Json
if ($c.listen.host -ne $script:RlbSettings.network.hostAddress) { throw "central.json listens on $($c.listen.host); the VM test expects $($script:RlbSettings.network.hostAddress) only." }
Write-Host "Central on http://$($c.listen.host):$($c.listen.port)/ (host-only). Ctrl+C to stop." -ForegroundColor Cyan
Push-Location $script:RlbRepo
try { & (Get-NodeExe) 'tools\central.mjs' 'run' $cfg } finally { Pop-Location }
