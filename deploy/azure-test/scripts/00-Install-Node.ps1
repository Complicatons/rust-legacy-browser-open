<#
.SYNOPSIS
  ON THE AZURE TEST VM. Downloads the official Node.js installer and its SHA-256 list from nodejs.org, checks the
  hash, and installs it silently (Node runs our website, gateway and sidecar). Elevated PowerShell.
  Dry run unless -Apply.
#>
param([switch]$Apply, [string]$Version = '24.15.0')
. (Join-Path $PSScriptRoot '..\..\host-test\scripts\_Common.ps1')
$msi = "node-v$Version-x64.msi"
$base = "https://nodejs.org/dist/v$Version"
$dir = Join-Path $env:TEMP "rlb-node-$Version"
Write-Plan "Install Node.js $Version" @(
    "Download $base/$msi and $base/SHASUMS256.txt into $dir",
    'Check the installer SHA-256 against SHASUMS256.txt; stop on mismatch',
    "msiexec /i $msi /qn (installs to $env:ProgramFiles\nodejs and adds it to PATH)"
)
Confirm-OrExit $Apply.IsPresent 'Apply'
Assert-Admin
if (Get-Command node.exe -ErrorAction SilentlyContinue) { Write-Host "Node is already installed: $(node --version)"; exit 0 }
New-Item -ItemType Directory -Force -Path $dir | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt" -OutFile (Join-Path $dir 'SHASUMS256.txt')
Invoke-WebRequest -UseBasicParsing -Uri "$base/$msi" -OutFile (Join-Path $dir $msi)
$line = Get-Content -LiteralPath (Join-Path $dir 'SHASUMS256.txt') | Where-Object { $_ -match ('\s' + [regex]::Escape($msi) + '$') } | Select-Object -First 1
if (-not $line) { throw "$msi is not listed in SHASUMS256.txt." }
$want = ($line -split '\s+')[0].ToUpperInvariant()
if ((Get-Sha256 (Join-Path $dir $msi)) -ne $want) { throw 'Node installer hash mismatch; not installing.' }
$proc = Start-Process msiexec.exe -ArgumentList @('/i', ('"{0}"' -f (Join-Path $dir $msi)), '/qn', '/norestart') -Wait -PassThru
if ($proc.ExitCode -ne 0) { throw "msiexec failed ($($proc.ExitCode))." }
Write-Host "Node.js $Version installed. Open a NEW PowerShell window so PATH includes node." -ForegroundColor Green
