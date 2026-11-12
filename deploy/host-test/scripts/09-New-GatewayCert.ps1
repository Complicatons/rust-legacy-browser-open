<#
.SYNOPSIS
  Test TLS certificate for the gateway (wss://127.0.0.1:28443/play, or -IpAddress <public IP> on a cloud VM), made with
  Windows' own New-SelfSignedCertificate: ECDSA P-256, IP SAN (plus DNS localhost for 127.0.0.1), serverAuth, 90 days. The private key goes only into
  C:\RLB-host\secrets\gateway-tls.pfx (passphrase gateway-tls.pass) and is deleted from the certificate store again.
  Nothing is added to any trust store: 16-Start-TestBrowser.ps1 pins this one key in a dedicated test browser
  profile only. Prints the certificate's SHA-256 fingerprint. Our code only. Dry run unless -Apply.
#>
param([switch]$Apply, [string]$IpAddress = '127.0.0.1', [switch]$Json)
if (-not ($IpAddress -as [Net.IPAddress])) { throw "-IpAddress $IpAddress is not an IP address." }
. (Join-Path $PSScriptRoot '_Common.ps1')
$p = Get-RlbPaths
$pfx = Join-Path $p.Secrets 'gateway-tls.pfx'
Write-Plan 'Create the gateway test certificate' @(
    "New-SelfSignedCertificate (CurrentUser\My) for $IpAddress$(if ($IpAddress -eq '127.0.0.1') { ' / localhost' }), ECDSA P-256, 90 days",
    "Export it with its key to $pfx (AES-256, passphrase from gateway-tls.pass), then delete it from the store",
    "Write the public certificate and its SHA-256 fingerprint to $($p.Config)"
)
Confirm-OrExit $Apply.IsPresent 'Apply'
New-RlbDirs
$pass = ConvertTo-SecureString (Read-Secret 'gateway-tls.pass') -AsPlainText -Force
$cert = New-SelfSignedCertificate -Subject "CN=RLB host-test gateway $IpAddress" -CertStoreLocation 'Cert:\CurrentUser\My' `
    -KeyAlgorithm ECDSA_nistP256 -KeyExportPolicy Exportable -NotAfter (Get-Date).AddDays(90) -Type Custom -KeyUsage DigitalSignature `
    -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.1', "2.5.29.17={text}IPAddress=$IpAddress$(if ($IpAddress -eq '127.0.0.1') { '&DNS=localhost' })")
try {
    Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pass -CryptoAlgorithmOption AES256_SHA256 | Out-Null
    Export-Certificate -Cert $cert -FilePath (Join-Path $p.Config 'gateway-cert.cer') -Type CERT | Out-Null
    $sha = [Security.Cryptography.SHA256]::Create()
    $fp = (($sha.ComputeHash($cert.RawData) | ForEach-Object { $_.ToString('X2') }) -join '')
} finally { Remove-Item -LiteralPath ('Cert:\CurrentUser\My\' + $cert.Thumbprint) -DeleteKey -ErrorAction SilentlyContinue }
Set-Content -LiteralPath (Join-Path $p.Config 'gateway-cert.sha256.txt') -Value $fp
Write-Host 'Gateway certificate SHA-256 (16-Start-TestBrowser.ps1 reads it from the config folder):' -ForegroundColor Cyan
Write-Host ($fp -replace '(.{8})', '$1 ').Trim() -ForegroundColor Cyan
Write-RlbResult 'PASS' "certificate for $IpAddress, SHA-256 $fp"
Write-Host 'Next: 10-Patch-TestCopy.ps1 -Apply.'
