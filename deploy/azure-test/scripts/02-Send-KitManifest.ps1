<#
.SYNOPSIS
  ON THE AZURE TEST VM. Hashes every file in the kit's app folder (C:\RLB-kit\app) into C:\RLB-host\run\vm-manifest.sha256
  ("<sha256> *<path>" lines, paths relative to app\) and uploads it as vm-manifest.sha256 to the kit container, so
  deploy\azure-test\pc\Publish-Kit.ps1 sends only what differs. -ContainerSasUrl is a short-lived container SAS URL
  with create+write permission (Cloud Shell makes it; see the RUNBOOK); it is never printed or saved.
  Read-only on the app folder. Dry run unless -Apply.
#>
param([string]$ContainerSasUrl, [string]$App = 'C:\RLB-kit\app', [switch]$Apply)
. (Join-Path $PSScriptRoot '..\..\host-test\scripts\_Common.ps1')
$p = Get-RlbPaths
$out = Join-Path $p.Run 'vm-manifest.sha256'
$container = if ($ContainerSasUrl) { ($ContainerSasUrl -split '\?')[0] } else { '<container>' }
Write-Plan 'Send the VM kit manifest' @("SHA-256 of every file under $App -> $out", "PUT $container/vm-manifest.sha256 (SAS not shown)")
Confirm-OrExit $Apply.IsPresent 'Apply'
if (-not $ContainerSasUrl -or $ContainerSasUrl -notmatch '^https://[a-z0-9]+\.blob\.core\.windows\.net/[a-z0-9-]+\?.*sig=') { throw '-ContainerSasUrl must be an https container SAS URL.' }
New-RlbDirs
$root = (Resolve-Path -LiteralPath $App).Path.TrimEnd('\') + '\'
$lines = foreach ($f in Get-ChildItem -LiteralPath $App -Recurse -File -Force) {
    '{0} *{1}' -f (Get-Sha256 $f.FullName).ToLowerInvariant(), $f.FullName.Substring($root.Length).Replace('\', '/')
}
Write-RlbFileNoBom $out (($lines | Sort-Object { $_.Substring(66) }) -join "`n")
$u = ($ContainerSasUrl -split '\?', 2)
& curl.exe -fsS -X PUT -H 'x-ms-blob-type: BlockBlob' -H 'x-ms-version: 2021-08-06' -H 'Content-Type: text/plain' -T $out ($u[0] + '/vm-manifest.sha256?' + $u[1])
if ($LASTEXITCODE) { throw "Upload failed (curl $LASTEXITCODE)." }
Write-Host "Sent vm-manifest.sha256: $(@($lines).Count) files." -ForegroundColor Green
