<#
.SYNOPSIS
  Runs the central service (website + accounts + join tickets) in this console on http://127.0.0.1:8080/ only.
  Account mail (verification/reset links) is printed here. Ctrl+C stops it. Our code only.
  Then: open http://127.0.0.1:8080/ in any browser, register an account, add a server on /owner with the endpoint
  wss://127.0.0.1:28443/play and copy its server id and enrolment code for 13-Enrol-Gateway.ps1. Play through the
  test browser (16-Start-TestBrowser.ps1) once the bridge runs: only that profile trusts the gateway's certificate.
#>
param()
. (Join-Path $PSScriptRoot '_Common.ps1')
$p = Get-RlbPaths
$cfg = Join-Path $p.Central 'central.json'
if (-not (Test-Path -LiteralPath $cfg)) { throw 'Run 11-Initialize-Central.ps1 -Apply first.' }
$c = Get-Content -Raw -LiteralPath $cfg | ConvertFrom-Json
if (-not (Test-LocalListenAddress $c.listen.host)) { throw "central.json listens on $($c.listen.host); only 127.0.0.1 or a private address of this machine is allowed." }
Write-Host "Central on http://$($c.listen.host):$($c.listen.port)/ (public address: $($c.publicUrl)). Ctrl+C to stop." -ForegroundColor Cyan
Push-Location $script:RlbRepo
try { & (Get-NodeExe) 'tools\central.mjs' 'run' $cfg } finally { Pop-Location }
