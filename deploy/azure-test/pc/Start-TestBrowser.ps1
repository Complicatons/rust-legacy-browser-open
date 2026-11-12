<#
.SYNOPSIS
  ON YOUR PC. Opens Microsoft Edge (or Chrome with -Chrome) with a DEDICATED test profile
  (%LOCALAPPDATA%\RLB-azure-test\browser-profile) for the Azure test VM:
   --ignore-certificate-errors-spki-list=<gateway key hash>  trusts the VM gateway's self-signed key and nothing else
   --unsafely-treat-insecure-origin-as-secure=http://<VM IP>:8080  secure context (voice) for the http test website
  Nothing is added to any Windows certificate store; your normal browser profile is untouched.
  -Fingerprint is the SHA-256 printed by 09-New-GatewayCert.ps1 on the VM (spaces allowed). The script reads the
  certificate the gateway presents (Windows' own TLS, no Node needed) and refuses to continue if it does not match.
#>
param([Parameter(Mandatory = $true)][string]$VmIp, [Parameter(Mandatory = $true)][string]$Fingerprint, [switch]$Chrome, [switch]$ProbeOnly)
$ErrorActionPreference = 'Stop'
if (-not ($VmIp -as [Net.IPAddress])) { throw "-VmIp $VmIp is not an IP address." }
$want = ($Fingerprint -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()
if ($want.Length -ne 64) { throw 'Give the full 64-hex-digit fingerprint printed by 09-New-GatewayCert.ps1 on the VM.' }

# DER walk: Certificate -> tbsCertificate -> [0] version?, serial, signature, issuer, validity, subject, subjectPublicKeyInfo.
function Get-Tlv([byte[]]$b, [int]$i) {
    $len = [int]$b[$i + 1]; $hdr = 2
    if ($len -band 0x80) { $n = $len -band 0x7f; $len = 0; for ($k = 0; $k -lt $n; $k++) { $len = ($len -shl 8) -bor $b[$i + 2 + $k] }; $hdr = 2 + $n }
    return @{ Tag = $b[$i]; Start = $i; Header = $hdr; Length = $len; End = $i + $hdr + $len }
}
function Get-SpkiBytes([byte[]]$der) {
    $cert = Get-Tlv $der 0; $tbs = Get-Tlv $der ($cert.Start + $cert.Header); $i = $tbs.Start + $tbs.Header
    $e = Get-Tlv $der $i; if ($e.Tag -eq 0xA0) { $i = $e.End }
    for ($k = 0; $k -lt 5; $k++) { $i = (Get-Tlv $der $i).End }
    $spki = Get-Tlv $der $i
    return [byte[]]$der[$spki.Start..($spki.End - 1)]
}
function Get-GatewayCertificate([string]$HostIp, [int]$Port) {
    $tcp = New-Object Net.Sockets.TcpClient
    try {
        $ar = $tcp.BeginConnect($HostIp, $Port, $null, $null)
        if (-not $ar.AsyncWaitHandle.WaitOne(10000)) { throw "TCP $($HostIp):$Port timed out." }
        $tcp.EndConnect($ar)
        # Accept any certificate only to read it; trust is decided by comparing the fingerprint below. Nothing is sent.
        $ssl = New-Object Net.Security.SslStream($tcp.GetStream(), $false, ({ $true } -as [Net.Security.RemoteCertificateValidationCallback]))
        $ssl.ReadTimeout = 10000
        $ssl.AuthenticateAsClient($HostIp, $null, [Security.Authentication.SslProtocols]::Tls12, $false)
        return New-Object Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
    } finally { $tcp.Close() }
}

$site = "http://$($VmIp):8080"
$profileDir = Join-Path $env:LOCALAPPDATA 'RLB-azure-test\browser-profile'
$cert = Get-GatewayCertificate $VmIp 28443
$sha = [Security.Cryptography.SHA256]::Create()
$fp = (($sha.ComputeHash($cert.RawData) | ForEach-Object { $_.ToString('X2') }) -join '')
$spki = [Convert]::ToBase64String($sha.ComputeHash((Get-SpkiBytes $cert.RawData)))
if ($fp -ne $want) { throw "Fingerprint mismatch: the gateway presents $fp. Do not continue." }
Write-Host "Gateway certificate matches ($($cert.Subject); valid to $($cert.NotAfter))." -ForegroundColor Green
if ($ProbeOnly) { [pscustomobject]@{ fingerprint = $fp; spki = $spki } | ConvertTo-Json; return }
if ($Chrome) { $exe = @((Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'), (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1 }
else { $exe = @((Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'), (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1 }
if (-not $exe) { throw 'Browser not found.' }
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
Start-Process -FilePath $exe -ArgumentList @(('--user-data-dir="{0}"' -f $profileDir), "--ignore-certificate-errors-spki-list=$spki",
    "--unsafely-treat-insecure-origin-as-secure=$site", '--no-first-run', '--no-default-browser-check', "$site/")
Write-Host "Opened $site/ in the Azure test profile. Use only this window for the test."
