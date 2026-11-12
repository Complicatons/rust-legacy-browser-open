<#
.SYNOPSIS
  ON THE OVH GAME VPS. Makes the gateway's TLS key on this machine and a certificate request (CSR) for a Cloudflare
  Origin Certificate, so the private key never leaves the VPS and nobody has to copy it (deploy\game-vps\README.md).
  Uses Windows' own certreq: ECDSA P-256, exportable, machine key store, subject and DNS name -Hostname. Writes the
  request to <root>\config\origin.csr and prints it. The key waits in the machine store as a pending request until
  03-Install-OriginCert.ps1 pairs it with the certificate Cloudflare issues for this CSR.
  Run it once; running it again makes a new key (the earlier pending request is then unused).
  Our code only. Elevated PowerShell. Dry run unless -Apply.
#>
param([string]$Hostname = 'eu1.your-domain.example', [switch]$Apply, [switch]$Json)
. (Join-Path $PSScriptRoot '..\..\host-test\scripts\_Common.ps1')
$p = Get-RlbPaths
if ($Hostname -notmatch '^[a-z0-9-]+(\.[a-z0-9-]+)+$') { throw "-Hostname $Hostname is not a host name." }
$csr = Join-Path $p.Config 'origin.csr'
Write-Plan 'Create the gateway key and a Cloudflare Origin certificate request' @(
    "certreq -new: ECDSA P-256 key in the LocalMachine store (exportable), subject CN=$Hostname, DNS $Hostname",
    "Write the request (public) to $csr and print it"
)
Confirm-OrExit $Apply.IsPresent 'Apply'
Assert-Admin
New-RlbDirs
$inf = Join-Path ([IO.Path]::GetTempPath()) ("rlb-origin-{0}.inf" -f (Get-Stamp))
@"
[Version]
Signature = "`$Windows NT`$"
[NewRequest]
Subject = "CN=$Hostname"
KeyAlgorithm = ECDSA_P256
KeyLength = 256
HashAlgorithm = SHA256
Exportable = TRUE
MachineKeySet = TRUE
ProviderName = "Microsoft Software Key Storage Provider"
KeyUsage = 0x80
RequestType = PKCS10
[EnhancedKeyUsageExtension]
OID = 1.3.6.1.5.5.7.3.1
[Extensions]
2.5.29.17 = "{text}"
_continue_ = "dns=$Hostname&"
"@ | Set-Content -LiteralPath $inf -Encoding ascii
try {
    & certreq.exe -new -q -f $inf $csr | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $csr)) { throw "certreq -new failed ($LASTEXITCODE)." }
} finally { Remove-Item -LiteralPath $inf -ErrorAction SilentlyContinue }
Write-Host "Certificate request for $Hostname (public; paste it into Cloudflare: SSL/TLS > Origin Server > Create Certificate > Use my private key and CSR, hostname $Hostname, 15 years):" -ForegroundColor Cyan
Get-Content -LiteralPath $csr
Write-Host "Then save the certificate Cloudflare shows (PEM) on this VPS and run 03-Install-OriginCert.ps1 -CertFile <that file> -Apply."
