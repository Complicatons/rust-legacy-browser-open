<#
.SYNOPSIS
  HOST. Opens Microsoft Edge (or Chrome) with a DEDICATED test profile (%LOCALAPPDATA%\RLB-vm-test\browser-profile)
  that trusts the VM gateway's self-signed test certificate and nothing else:
   --ignore-certificate-errors-spki-list=<gateway key hash>  (Chromium honours it only with a separate --user-data-dir)
   --unsafely-treat-insecure-origin-as-secure=http://192.168.56.1:8080  (secure context for voice on the http test site)
  Nothing is added to any Windows certificate store; your normal browser profile is untouched.
  -Fingerprint is the SHA-256 printed by 09-New-GatewayCert.ps1 in the VM (spaces allowed, at least 16 hex digits).
  The script reads the certificate the gateway actually presents and refuses to continue if it does not match.
#>
param([Parameter(Mandatory = $true)][string]$Fingerprint, [switch]$Chrome)
. (Join-Path $PSScriptRoot '_HostCommon.ps1')
$s = Get-RlbSettings
$want = ($Fingerprint -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()
if ($want.Length -lt 16) { throw 'Give at least 16 hex digits of the fingerprint shown in the VM.' }
$profileDir = Expand-RlbPath $s.host.browserProfileDir
$site = "http://$($s.network.hostAddress):$($s.ports.central)"
Write-Plan 'Start the test browser profile' @(
    "Read the TLS certificate presented by $($s.network.vmAddress):$($s.ports.gateway) (node probe, nothing sent)",
    'Compare its SHA-256 fingerprint with the one you typed; stop on mismatch',
    "Launch $(if ($Chrome) { 'Chrome' } else { 'Edge' }) with --user-data-dir=$profileDir, the key pin and the secure-origin flag for $site"
)
$json = & (Get-NodeExe) (Join-Path $PSScriptRoot 'probe-gateway-cert.mjs') $s.network.vmAddress $s.ports.gateway
if ($LASTEXITCODE) { throw 'Could not read the gateway certificate (gateway running? VM reachable?).' }
$cert = $json | ConvertFrom-Json
if (-not $cert.fingerprint.StartsWith($want) -and -not $cert.fingerprint.EndsWith($want)) { throw "Fingerprint mismatch: gateway presents $($cert.fingerprint). Do not continue." }
Write-Host "Gateway certificate matches ($($cert.subject); valid to $($cert.validTo))." -ForegroundColor Green
if ($Chrome) { $exe = @((Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'), (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1 }
else { $exe = @((Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'), (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1 }
if (-not $exe) { throw 'Browser not found.' }
if (-not (Test-Path -LiteralPath $profileDir)) { New-Item -ItemType Directory -Path $profileDir | Out-Null }
Start-Process -FilePath $exe -ArgumentList @(
    ('--user-data-dir="{0}"' -f $profileDir), "--ignore-certificate-errors-spki-list=$($cert.spki)",
    "--unsafely-treat-insecure-origin-as-secure=$site", '--no-first-run', '--no-default-browser-check', "$site/")
Write-Host "Opened $site/ in the test profile. Use only this window for the VM test."
