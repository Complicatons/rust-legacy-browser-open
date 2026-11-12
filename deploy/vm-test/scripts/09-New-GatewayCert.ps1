<#
.SYNOPSIS
  VM only. Test TLS certificate for the gateway (wss://192.168.56.10:28443/play), made with Windows' own
  New-SelfSignedCertificate inside the VM: ECDSA P-256, IP SAN 192.168.56.10, serverAuth, 90 days. The private key
  goes only into C:\RLB\secrets\gateway-tls.pfx (passphrase gateway-tls.pass) and is removed from the certificate
  store again. The public certificate is written to C:\RLB\export\gateway-cert.cer. Prints the certificate SHA-256
  fingerprint: the host's Start-TestBrowser.ps1 must be given it (-Fingerprint) and pins that key in the
  dedicated test browser profile only (nothing is added to any trust store). Dry run unless -Apply.
#>
param([switch]$Apply)
. (Join-Path $PSScriptRoot '_Common.ps1')
Assert-NotHost
$s = Get-RlbSettings
$p = Get-RlbPaths
$pfx = Join-Path $p.Secrets 'gateway-tls.pfx'
Write-Plan 'Create the gateway test certificate' @(
    "New-SelfSignedCertificate (CurrentUser\My) for IP $($s.network.vmAddress), ECDSA P-256, 90 days",
    "Export it with its key to $pfx (AES-256, passphrase from gateway-tls.pass), then delete it from the store",
    "Export the public certificate to $($p.Export)\gateway-cert.cer",
    'Print the SHA-256 fingerprint for the host test browser'
)
Confirm-OrExit $Apply.IsPresent 'Apply'
New-RlbDirs
$pass = ConvertTo-SecureString (Read-Secret 'gateway-tls.pass') -AsPlainText -Force
$cert = New-SelfSignedCertificate -Subject "CN=RLB vm-test gateway $($s.network.vmAddress)" -CertStoreLocation 'Cert:\CurrentUser\My' `
    -KeyAlgorithm ECDSA_nistP256 -KeyExportPolicy Exportable -NotAfter (Get-Date).AddDays(90) -Type Custom -KeyUsage DigitalSignature `
    -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.1', "2.5.29.17={text}IPAddress=$($s.network.vmAddress)")
try {
    Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pass -CryptoAlgorithmOption AES256_SHA256 | Out-Null
    Export-Certificate -Cert $cert -FilePath (Join-Path $p.Export 'gateway-cert.cer') -Type CERT | Out-Null
    $sha = [Security.Cryptography.SHA256]::Create()
    $fp = (($sha.ComputeHash($cert.RawData) | ForEach-Object { $_.ToString('X2') }) -join '')
} finally { Remove-Item -LiteralPath ("Cert:\CurrentUser\My\" + $cert.Thumbprint) -DeleteKey -ErrorAction SilentlyContinue }
Set-Content -LiteralPath (Join-Path $p.Export 'gateway-cert.sha256.txt') -Value $fp
Write-Host ''
Write-Host 'Gateway certificate SHA-256 fingerprint (type it into the host Start-TestBrowser.ps1 -Fingerprint):' -ForegroundColor Cyan
Write-Host ($fp -replace '(.{8})', '$1 ').Trim() -ForegroundColor Cyan
