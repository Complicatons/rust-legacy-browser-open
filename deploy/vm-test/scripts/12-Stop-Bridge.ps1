<#
.SYNOPSIS
  VM only. Stops the gateway and sidecar started by 11-Start-Bridge.ps1. Dry run unless -Apply.
#>
param([switch]$Apply)
. (Join-Path $PSScriptRoot '_Common.ps1')
Assert-NotHost
$p = Get-RlbPaths
Write-Plan 'Stop gateway and sidecar' @('Stop the node processes recorded in C:\RLB\run\gateway.pid and sidecar.pid')
Confirm-OrExit $Apply.IsPresent 'Apply'
foreach ($n in @('gateway', 'sidecar')) {
    $proc = Get-PidFromFile "$n.pid"
    if ($proc) { Stop-Process -Id $proc.Id -Force; Write-Host "$n stopped (PID $($proc.Id))." } else { Write-Host "$n not running." }
    Remove-Item -LiteralPath (Join-Path $p.Run "$n.pid") -ErrorAction SilentlyContinue
}
