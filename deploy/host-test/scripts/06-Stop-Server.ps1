<#
.SYNOPSIS
  Stops the test server started by 05-Start-Server.ps1 (the PID in C:\RLB-host\run\server.pid, and only if that
  PID is rust_server.exe from the test copy). Leaves Process Monitor running so 07-Collect.ps1 can save its log.
  Elevated PowerShell. Dry run unless -Apply.
#>
param([switch]$Apply)
. (Join-Path $PSScriptRoot '_Common.ps1')
$s = Get-RlbSettings
$p = Get-RlbPaths
$exe = Join-Path $p.TestCopy $s.server.exe
Write-Plan 'Stop the test server' @(
    "Read $($p.Run)\server.pid and check the process is $exe",
    'Stop it and wait for it to exit'
)
Confirm-OrExit $Apply.IsPresent 'Apply'
Assert-Admin
$proc = Get-PidFromFile 'server.pid'
if (-not $proc) { Write-Host 'No running test server recorded.'; exit 0 }
$path = (Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.Id)").ExecutablePath
if ($path -ne $exe) { throw "PID $($proc.Id) is $path, not the test server; not stopping it." }
# Tells the host app (host/, if it runs) that this stop is on purpose, so it does not restart the server as a crash.
Set-Content -LiteralPath (Join-Path $p.Run 'server.stop') -Value $proc.Id
Stop-Process -Id $proc.Id -Force
$proc.WaitForExit(30000) | Out-Null
Remove-Item -LiteralPath (Join-Path $p.Run 'server.pid') -ErrorAction SilentlyContinue
Write-Host "Stopped PID $($proc.Id)." -ForegroundColor Green
