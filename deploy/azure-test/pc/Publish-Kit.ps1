<#
.SYNOPSIS
  ON YOUR PC. Sends a kit update to the Azure test VM through the private storage container (no Remote Desktop copy):
    1. downloads the VM's own manifest vm-manifest.sha256 from the container (the VM uploads it with
       deploy\azure-test\scripts\02-Send-KitManifest.ps1; -Full skips this and sends every kit app file),
    2. builds the update tar with node tools\build-kit-update.mjs (only files that differ; central's own files stay
       out unless -WithCentral, the adapter unless -WithAdapter) into build\azure-test\updates\,
    3. uploads it: with the Azure CLI (`az storage blob upload --auth-mode key`) when az is installed and signed in and
       no SAS is given, otherwise with curl.exe and a SAS (one PUT; Node is not used for the network: see the RUNBOOK's
       VPN note). curl runs silent (-sS), so redirecting this script's output (*>&1) no longer stops it.
  Then install it on the VM with deploy\azure-test\scripts\03-Install-KitUpdate.ps1 (Cloud Shell Run Command; the
  RUNBOOK has the exact commands). The SAS URL comes from Cloud Shell (container scope, read/create/write, a few hours,
  bound to a stored access policy so it can be revoked); pass it in $env:RLB_KIT_SAS or -ContainerSasUrl. It is never
  printed or written to a file. Without a SAS, az needs `az login` on this PC (the account key is fetched by az and
  never shown). Assets and other ignored data come from this checkout (junctions to the main checkout
  work). Dry run (build only, nothing uploaded) unless -Apply.
#>
param([string]$ContainerSasUrl = $env:RLB_KIT_SAS, [string]$Account = 'rlbtestkitexample', [string]$Container = 'kits', [switch]$Full, [switch]$WithCentral, [switch]$WithAdapter, [switch]$Apply)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$az = if ($ContainerSasUrl) { $null } else { (Get-Command az -ErrorAction SilentlyContinue).Source }
if (-not $az -and ($ContainerSasUrl -notmatch '^https://[a-z0-9]+\.blob\.core\.windows\.net/[a-z0-9-]+\?.*sig=')) { throw 'Install and sign in to the Azure CLI (az login), or pass the container SAS URL in $env:RLB_KIT_SAS or -ContainerSasUrl.' }
$u = if ($ContainerSasUrl) { $ContainerSasUrl -split '\?', 2 } else { @("https://$Account.blob.core.windows.net/$Container", '') }
$blobUrl = { param($name) $u[0] + '/' + $name + '?' + $u[1] }
# Native tools write progress to stderr; with ErrorActionPreference Stop and redirected output PowerShell 5.1 would
# turn that into a terminating error, so they run with Continue and are judged by their exit code.
function Invoke-Native([scriptblock]$Block) { $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { & $Block } finally { $ErrorActionPreference = $old } }
$dir = Join-Path $repo 'build\azure-test\updates'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$name = 'rlb-kit-update-' + (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss') + '.tar'
$tar = Join-Path $dir $name

$buildArgs = @('tools\build-kit-update.mjs', '--out', $tar)
if (-not $Full) {
    $manifest = Join-Path $dir 'vm-manifest.sha256'
    if ($az) { Invoke-Native { & $az storage blob download --account-name $Account -c $Container -n 'vm-manifest.sha256' -f $manifest --auth-mode key --overwrite -o none --only-show-errors } }
    else { Invoke-Native { & curl.exe -fsS -o $manifest (& $blobUrl 'vm-manifest.sha256') } }
    if ($LASTEXITCODE) { throw "No vm-manifest.sha256 in $($u[0]) (curl $LASTEXITCODE): run 02-Send-KitManifest.ps1 on the VM first, or pass -Full." }
    Write-Host "VM manifest: $((Get-Content -LiteralPath $manifest).Count) files, from $((Get-Item -LiteralPath $manifest).LastWriteTime)"
    $buildArgs += @('--manifest', $manifest)
}
if ($WithCentral) { $buildArgs += '--with-central' }
if ($WithAdapter) { $buildArgs += '--with-adapter' }
Push-Location $repo
try { & node @buildArgs; if ($LASTEXITCODE) { throw 'build-kit-update failed.' } } finally { Pop-Location }
if (-not (Test-Path -LiteralPath $tar)) { Write-Host 'The VM already has every file; nothing to send.' -ForegroundColor Green; exit 0 }
$hash = ((Get-Content -LiteralPath "$tar.sha256") -split ' ')[0]
if (-not $Apply) { Write-Host "Built $tar (not uploaded). Re-run with -Apply to upload." -ForegroundColor Yellow; exit 0 }

if ($az) { Invoke-Native { & $az storage blob upload --account-name $Account -c $Container -n $name -f $tar --auth-mode key --overwrite --content-type application/x-tar -o none --only-show-errors } }
else { Invoke-Native { & curl.exe -fsS --retry 3 -X PUT -H 'x-ms-blob-type: BlockBlob' -H 'x-ms-version: 2021-08-06' -H 'Content-Type: application/x-tar' -T $tar (& $blobUrl $name) } }
if ($LASTEXITCODE) { throw "Upload failed (exit $LASTEXITCODE)." }
Write-Host "Uploaded $name ($((Get-Item -LiteralPath $tar).Length) bytes) to $($u[0])" -ForegroundColor Green
Write-Host "SHA-256 $hash"
Write-Host "Install on the VM: 03-Install-KitUpdate.ps1 -Name $name -Sha256 $hash -ContainerSasUrl <read SAS> -Apply (RUNBOOK, Kit updates)"
