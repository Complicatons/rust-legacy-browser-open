<#
.SYNOPSIS
  ON THE OVH GAME VPS, after 02-New-OriginCsr.ps1 and Cloudflare issuing the Origin Certificate for that request.
  Pairs the certificate (-CertFile, PEM, public) with the key 02 made (certreq -accept, LocalMachine store), checks
  it is a Cloudflare Origin CA certificate for -Hostname, exports certificate + key to <root>\secrets\gateway-tls.pfx
  (AES-256, passphrase from gateway-tls.pass, made by host-test 08-New-Secrets.ps1), then deletes both from the
  certificate store again, so the key exists only in that PFX. The gateway template (deploy\game-vps\config) reads
  exactly these two files. Prints subject, names, expiry and SHA-256 fingerprint.
  Our code only. Elevated PowerShell. Dry run unless -Apply.
#>
param([Parameter(Mandatory = $true)][string]$CertFile, [string]$Hostname = 'eu1.your-domain.example', [switch]$Apply, [switch]$Json)
. (Join-Path $PSScriptRoot '..\..\host-test\scripts\_Common.ps1')
$p = Get-RlbPaths
if (-not (Test-Path -LiteralPath $CertFile)) { throw "$CertFile not found." }
$pfx = Join-Path $p.Secrets 'gateway-tls.pfx'
Write-Plan 'Install the Cloudflare Origin certificate for the gateway' @(
    "certreq -accept $CertFile (pairs it with the key from 02-New-OriginCsr.ps1, LocalMachine\My)",
    "Check: issued by CloudFlare Origin CA, valid for $Hostname, has its private key",
    "Export certificate + key to $pfx (AES-256, passphrase gateway-tls.pass), then delete both from the store",
    "Write the public certificate to $($p.Config)\origin.pem"
)
Confirm-OrExit $Apply.IsPresent 'Apply'
Assert-Admin
New-RlbDirs
if (-not (Test-Path -LiteralPath (Join-Path $p.Secrets 'gateway-tls.pass'))) { throw 'Run deploy\host-test\scripts\08-New-Secrets.ps1 -Apply first (it makes gateway-tls.pass).' }
$pub = New-Object Security.Cryptography.X509Certificates.X509Certificate2 (Resolve-Path -LiteralPath $CertFile).Path
if ($pub.Issuer -notmatch 'CloudFlare Origin') { throw "This is not a Cloudflare Origin certificate (issuer: $($pub.Issuer))." }
$names = @($pub.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.17' } | ForEach-Object { $_.Format($false) -split ',\s*' } | ForEach-Object { $_ -replace '^DNS Name=', '' })
$wild = '*.' + ($Hostname -replace '^[^.]+\.', '')
if (-not ($names -contains $Hostname -or $names -contains $wild)) { throw "The certificate is for $($names -join ', '), not $Hostname." }
& certreq.exe -accept -machine -q (Resolve-Path -LiteralPath $CertFile).Path | Out-Null
if ($LASTEXITCODE -ne 0) { throw "certreq -accept failed ($LASTEXITCODE): was the CSR made by 02-New-OriginCsr.ps1 on this VPS?" }
$cert = Get-Item -LiteralPath ('Cert:\LocalMachine\My\' + $pub.Thumbprint) -ErrorAction SilentlyContinue
try {
    if (-not $cert -or -not $cert.HasPrivateKey) { throw 'The certificate did not pair with a key in this machine store (wrong CSR?).' }
    $pass = ConvertTo-SecureString (Read-Secret 'gateway-tls.pass') -AsPlainText -Force
    Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pass -CryptoAlgorithmOption AES256_SHA256 | Out-Null
    Copy-Item -LiteralPath $CertFile -Destination (Join-Path $p.Config 'origin.pem') -Force
} finally { if ($cert) { Remove-Item -LiteralPath ('Cert:\LocalMachine\My\' + $cert.Thumbprint) -DeleteKey -ErrorAction SilentlyContinue } }
$sha = [Security.Cryptography.SHA256]::Create()
$fp = (($sha.ComputeHash($pub.RawData) | ForEach-Object { $_.ToString('X2') }) -join '')
Write-Host "Gateway certificate: $($pub.Subject); names $($names -join ', '); valid until $($pub.NotAfter.ToString('yyyy-MM-dd'))" -ForegroundColor Green
Write-Host ('SHA-256 ' + (($fp -replace '(.{8})', '$1 ').Trim()))
Write-Host "Key and certificate are only in $pfx now. Next: host-test 10-Patch-TestCopy.ps1 -Apply, then 13-Enrol-Gateway.ps1 (deploy\game-vps\README.md)."
