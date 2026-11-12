<#
.SYNOPSIS
  Opens Microsoft Edge (or Chrome with -Chrome) with a DEDICATED test profile (C:\RLB-host\browser-profile) that
  trusts the gateway's self-signed test certificate and nothing else:
   --ignore-certificate-errors-spki-list=<gateway key hash>  (Chromium honours it only with a separate --user-data-dir)
  http://127.0.0.1 is already a secure context, so voice works without extra flags. Nothing is added to any
  Windows certificate store; your normal browser profile is untouched. The script reads the certificate the gateway
  presents and refuses to continue unless it matches the fingerprint written by 09-New-GatewayCert.ps1.
#>
param([switch]$Chrome)
. (Join-Path $PSScriptRoot '_Common.ps1')
$s = Get-RlbSettings
$p = Get-RlbPaths
$fpFile = Join-Path $p.Config 'gateway-cert.sha256.txt'
if (-not (Test-Path -LiteralPath $fpFile)) { throw 'Run 09-New-GatewayCert.ps1 -Apply first.' }
$want = ((Get-Content -Raw -LiteralPath $fpFile) -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()
$site = "http://127.0.0.1:$($s.ports.central)"
Write-Plan 'Start the test browser profile' @(
    "Read the TLS certificate presented by 127.0.0.1:$($s.ports.gateway) (node probe, nothing sent)",
    'Compare its SHA-256 fingerprint with the one from 09-New-GatewayCert.ps1; stop on mismatch',
    "Launch $(if ($Chrome) { 'Chrome' } else { 'Edge' }) with --user-data-dir=$($p.Browser) and the key pin, at $site/"
)
$probe = Join-Path $script:RlbRepo 'deploy\vm-test\host\probe-gateway-cert.mjs'
$json = & (Get-NodeExe) $probe '127.0.0.1' $s.ports.gateway
if ($LASTEXITCODE) { throw 'Could not read the gateway certificate (is the gateway running? 14-Start-Bridge.ps1).' }
$cert = $json | ConvertFrom-Json
if ($cert.fingerprint -ne $want) { throw "Fingerprint mismatch: gateway presents $($cert.fingerprint). Do not continue." }
Write-Host "Gateway certificate matches ($($cert.subject); valid to $($cert.validTo))." -ForegroundColor Green
if ($Chrome) { $exe = @((Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'), (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1 }
else { $exe = @((Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'), (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1 }
if (-not $exe) { throw 'Browser not found.' }
if (-not (Test-Path -LiteralPath $p.Browser)) { New-Item -ItemType Directory -Path $p.Browser | Out-Null }
Start-Process -FilePath $exe -ArgumentList @(('--user-data-dir="{0}"' -f $p.Browser), "--ignore-certificate-errors-spki-list=$($cert.spki)", '--no-first-run', '--no-default-browser-check', "$site/")
Write-Host "Opened $site/ in the test profile. Use only this window for the host test."
