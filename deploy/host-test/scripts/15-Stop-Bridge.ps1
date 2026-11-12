<#
.SYNOPSIS
  Stops the gateway and sidecar started by 14-Start-Bridge.ps1 (only if the recorded PIDs are node.exe).
  Dry run unless -Apply.
#>
param([switch]$Apply)
. (Join-Path $PSScriptRoot '_Common.ps1')
$p = Get-RlbPaths
Write-Plan 'Stop gateway and sidecar' @("Stop the node processes recorded in $($p.Run)\gateway.pid and sidecar.pid")
Confirm-OrExit $Apply.IsPresent 'Apply'
foreach ($n in @('gateway', 'sidecar')) {
    $proc = Get-PidFromFile "$n.pid"
    # The .stop marker tells the host app (host/, if it runs) that this stop is on purpose, not a crash to restart.
    if ($proc -and $proc.ProcessName -eq 'node') { Set-Content -LiteralPath (Join-Path $p.Run "$n.stop") -Value $proc.Id; Stop-Process -Id $proc.Id -Force; Write-Host "$n stopped (PID $($proc.Id))." } else { Write-Host "$n not running." }
    Remove-Item -LiteralPath (Join-Path $p.Run "$n.pid") -ErrorAction SilentlyContinue
}
