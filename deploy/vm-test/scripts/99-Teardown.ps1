<#
.SYNOPSIS
  VM only (elevated). End of a test run (P9): stops gateway, sidecar, server and captures, collects a final export
  to the RLB_EXPORT disk, then deletes the test copy, generated configs, sidecar data and secrets and removes the
  RLB firewall rules. The real teardown is reverting the VM to the clean-tools snapshot afterwards (RUNBOOK.md).
  Dry run unless -Apply.
#>
param([switch]$Apply, [ValidatePattern('^P[0-9]$')][string]$Phase = 'P9')
. (Join-Path $PSScriptRoot '_Common.ps1')
Assert-NotHost
$p = Get-RlbPaths
Write-Plan 'Teardown' @(
    '12-Stop-Bridge.ps1 -Apply; 08-Stop-Server.ps1 -Apply',
    "13-Collect-Logs.ps1 -Apply -Phase $Phase -ToExportVolume",
    "Delete $($p.TestCopy), $($p.Config), $($p.Data), $($p.Secrets), $($p.Run)",
    'Remove the "RLB vm-test" firewall rules',
    'Remind you to power off and revert to the clean-tools snapshot'
)
Confirm-OrExit $Apply.IsPresent 'Apply'
Assert-Admin
& (Join-Path $PSScriptRoot '12-Stop-Bridge.ps1') -Apply
& (Join-Path $PSScriptRoot '08-Stop-Server.ps1') -Apply
& (Join-Path $PSScriptRoot '13-Collect-Logs.ps1') -Apply -Phase $Phase -ToExportVolume
foreach ($d in @($p.TestCopy, $p.Config, $p.Data, $p.Secrets, $p.Run)) { if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force; Write-Host "deleted $d" } }
Get-NetFirewallRule -DisplayName 'RLB vm-test*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host 'Teardown done. Now: shut down the VM, revert to the clean-tools snapshot, then read the export on the host (host\Read-VmExport.ps1).' -ForegroundColor Green
