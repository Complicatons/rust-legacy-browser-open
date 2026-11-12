<#
.SYNOPSIS
  VM only. Starts our adapter sidecar (127.0.0.1:28090) and gateway (vm-test mode, wss on 192.168.56.10:28443) with
  Node, logging to C:\RLB\logs. Our code only; it does not start the original server. Requires a passing isolation
  check. -NoLineOfSight skips the ~0.5 GB collision world (faster start, no line-of-sight anti-cheat).
  Dry run unless -Apply.
#>
param([switch]$Apply, [switch]$NoLineOfSight)
. (Join-Path $PSScriptRoot '_Common.ps1')
Assert-NotHost
$p = Get-RlbPaths
$s = Get-RlbSettings
$stamp = Get-Stamp
$gwConfig = Join-Path $p.Config 'gateway.json'
Write-Plan 'Start sidecar and gateway (our code)' @(
    'Run the isolation check; refuse on any FAIL',
    "node tools\adapter-sidecar.mjs $($p.Config)\sidecar.json  -> $($p.Logs)\sidecar-$stamp.log",
    "node tools\gateway.mjs run $gwConfig  -> $($p.Logs)\gateway-$stamp.log$(if ($NoLineOfSight) { ' (line of sight off)' })",
    "Wait for TCP $($s.network.vmAddress):$($s.ports.gateway) to listen; record PIDs in C:\RLB\run"
)
Confirm-OrExit $Apply.IsPresent 'Apply'
Assert-RlbIsolation
foreach ($f in @($gwConfig, (Join-Path $p.Config 'sidecar.json'))) { if (-not (Test-Path -LiteralPath $f)) { throw "Missing $f (run 10-Enrol-Gateway.ps1)." } }
if ((Get-PidFromFile 'gateway.pid') -or (Get-PidFromFile 'sidecar.pid')) { throw 'Sidecar or gateway already running (12-Stop-Bridge.ps1).' }
if ($NoLineOfSight) {
    $j = Get-Content -Raw -LiteralPath $gwConfig | ConvertFrom-Json
    $j.anticheat | Add-Member -NotePropertyName lineOfSight -NotePropertyValue $false -Force
    $gwConfig = Join-Path $p.Config 'gateway.nolos.json'
    Write-RlbFileNoBom $gwConfig ($j | ConvertTo-Json -Depth 6)
}
$node = Get-NodeExe
$side = Start-Process -FilePath $node -ArgumentList @('tools\adapter-sidecar.mjs', ('"{0}"' -f (Join-Path $p.Config 'sidecar.json'))) -WorkingDirectory $p.App -RedirectStandardOutput (Join-Path $p.Logs "sidecar-$stamp.log") -RedirectStandardError (Join-Path $p.Logs "sidecar-$stamp.err.log") -WindowStyle Hidden -PassThru
Set-Content -LiteralPath (Join-Path $p.Run 'sidecar.pid') -Value $side.Id
Start-Sleep -Seconds 2
$gw = Start-Process -FilePath $node -ArgumentList @('tools\gateway.mjs', 'run', ('"{0}"' -f $gwConfig)) -WorkingDirectory $p.App -RedirectStandardOutput (Join-Path $p.Logs "gateway-$stamp.log") -RedirectStandardError (Join-Path $p.Logs "gateway-$stamp.err.log") -WindowStyle Hidden -PassThru
Set-Content -LiteralPath (Join-Path $p.Run 'gateway.pid') -Value $gw.Id
$deadline = (Get-Date).AddSeconds(240)
while ((Get-Date) -lt $deadline -and -not $gw.HasExited) {
    if (@(Get-NetTCPConnection -State Listen -LocalPort $s.ports.gateway -ErrorAction SilentlyContinue).Count) { break }
    Start-Sleep -Seconds 2
}
if ($gw.HasExited -or $side.HasExited) { Write-Host 'Sidecar or gateway exited; see the logs:' -ForegroundColor Red; Get-ChildItem -LiteralPath $p.Logs -Filter "*-$stamp*.log" | ForEach-Object { Write-Host "--- $($_.Name)"; Get-Content -LiteralPath $_.FullName -Tail 20 | Write-Host }; exit 1 }
Get-Content -LiteralPath (Join-Path $p.Logs "gateway-$stamp.err.log") -ErrorAction SilentlyContinue | Write-Host
Get-Content -LiteralPath (Join-Path $p.Logs "gateway-$stamp.log") -Tail 5 -ErrorAction SilentlyContinue | Write-Host
Write-Host "Sidecar PID $($side.Id), gateway PID $($gw.Id). Endpoint for the owner panel: wss://$($s.network.vmAddress):$($s.ports.gateway)/play" -ForegroundColor Green
