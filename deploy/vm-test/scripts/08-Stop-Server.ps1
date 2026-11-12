<#
.SYNOPSIS
  VM only. Stops rust_server.exe (the PID recorded by 07-Start-Server.ps1, plus any rust_server.exe running from
  C:\RLB\server), then Process Monitor and dumpcap if they were started. Stopping runs no original code.
  Dry run unless -Apply.
#>
param([switch]$Apply)
. (Join-Path $PSScriptRoot '_Common.ps1')
Assert-NotHost
$p = Get-RlbPaths
$procmonExe = Join-Path $p.Tools 'sysinternals\Procmon64.exe'
Write-Plan 'Stop the server and captures' @(
    'Stop rust_server.exe (recorded PID and any instance under C:\RLB\server); force after 15 s',
    "If Process Monitor runs: $procmonExe /Terminate (flushes the .pml)",
    'Stop dumpcap (recorded PID)'
)
Confirm-OrExit $Apply.IsPresent 'Apply'
$targets = @()
$recorded = Get-PidFromFile 'server.pid'
if ($recorded) { $targets += $recorded }
$targets += @(Get-Process rust_server -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($p.Server, [StringComparison]::OrdinalIgnoreCase) })
foreach ($t in ($targets | Sort-Object Id -Unique)) {
    Write-Host "Stopping rust_server.exe PID $($t.Id)"
    $null = $t.CloseMainWindow()
    if (-not $t.WaitForExit(15000)) { Stop-Process -Id $t.Id -Force }
}
Remove-Item -LiteralPath (Join-Path $p.Run 'server.pid') -ErrorAction SilentlyContinue
if (@(Get-Process Procmon64, Procmon -ErrorAction SilentlyContinue).Count -and (Test-Path -LiteralPath $procmonExe)) {
    Start-Process -FilePath $procmonExe -ArgumentList '/Terminate' -Wait
    Write-Host 'Process Monitor stopped.'
}
$cap = Get-PidFromFile 'dumpcap.pid'
if ($cap) { Stop-Process -Id $cap.Id; Write-Host 'dumpcap stopped.' }
Remove-Item -LiteralPath (Join-Path $p.Run 'dumpcap.pid') -ErrorAction SilentlyContinue
Write-Host 'Stopped. Next: 13-Collect-Logs.ps1.' -ForegroundColor Green
