<#
.SYNOPSIS
  VM only. Read-only isolation check: one host-only adapter with the static VM address, no default gateway, no DNS,
  nothing outside the host-only subnet reachable, Defender real-time protection on, no shared folders.
  Writes a JSON report to C:\RLB\logs. Exit code 1 when any check fails. Changes nothing.
#>
param()
. (Join-Path $PSScriptRoot '_Common.ps1')
Assert-InVm

Write-Plan 'Isolation check (read-only)' @(
    'List network adapters, IPv4 addresses, default routes and DNS servers',
    'Try to resolve www.microsoft.com and to reach public and common LAN addresses (all must fail)',
    "Ping / connect to the host-only host $($script:RlbSettings.network.hostAddress) (should answer)",
    'Read Windows Defender status and look for VMware shared folders / network drives',
    'Write the report to C:\RLB\logs\isolation-<time>.json'
)
New-RlbDirs
$r = Test-RlbIsolation
$r | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
$file = Join-Path (Get-RlbPaths).Logs ("isolation-{0}.json" -f (Get-Stamp))
Write-RlbFileNoBom $file ($r | ConvertTo-Json -Depth 3)
Write-Host "Report: $file"
if (@($r | Where-Object { $_.Status -eq 'FAIL' }).Count -gt 0) { Write-Host 'ISOLATION FAILED. Do not run anything else; fix the VM settings (RUNBOOK.md, phase P0).' -ForegroundColor Red; exit 1 }
Write-Host 'ISOLATION OK.' -ForegroundColor Green
