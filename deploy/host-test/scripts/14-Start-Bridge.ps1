<#
.SYNOPSIS
  Starts our adapter sidecar (127.0.0.1:28090) and gateway (wss://127.0.0.1:28443/play) with Node, logging to
  C:\RLB-host\logs. Our code only; it does not start the original server. -NoLineOfSight skips the ~0.5 GB
  collision world (faster start, no line-of-sight anti-cheat). Dry run unless -Apply.
#>
param([switch]$Apply, [switch]$NoLineOfSight)
. (Join-Path $PSScriptRoot '_Common.ps1')
$p = Get-RlbPaths
$s = Get-RlbSettings
$stamp = Get-Stamp
$gwConfig = Join-Path $p.Config 'gateway.json'
$sideConfig = Join-Path $p.Config 'sidecar.json'
$listenHost = if (Test-Path -LiteralPath $gwConfig) { (Get-Content -Raw -LiteralPath $gwConfig | ConvertFrom-Json).listen.host } else { '127.0.0.1' }
Write-Plan 'Start sidecar and gateway (our code)' @(
    "node tools\adapter-sidecar.mjs $sideConfig  -> $($p.Logs)\sidecar-$stamp.log",
    "node tools\gateway.mjs run $gwConfig  -> $($p.Logs)\gateway-$stamp.log$(if ($NoLineOfSight) { ' (line of sight off)' })",
    "Wait for TCP $($listenHost):$($s.ports.gateway) to listen; record the PIDs in $($p.Run)"
)
Confirm-OrExit $Apply.IsPresent 'Apply'
foreach ($f in @($gwConfig, $sideConfig)) { if (-not (Test-Path -LiteralPath $f)) { throw "Missing $f (run 13-Enrol-Gateway.ps1)." } }
if ((Get-PidFromFile 'gateway.pid') -or (Get-PidFromFile 'sidecar.pid')) { throw 'Sidecar or gateway already running (15-Stop-Bridge.ps1).' }
# Without 10-Patch-TestCopy the server sends browser logins down the native Steam path, which never answers offline.
$managed = Join-Path $p.TestCopy 'rust_server_Data\Managed'
foreach ($f in @((Join-Path $managed 'Assembly-CSharp.dll.rlb-original'), (Join-Path $managed 'RustLegacyBrowser.Vanilla.dll'), (Join-Path $p.TestCopy 'rust_server_Data\cfg\rustlegacybrowser.cfg'))) {
    if (-not (Test-Path -LiteralPath $f)) { throw "The test copy is not patched for browser joins ($f missing). Stop the server (06-Stop-Server.ps1 -Apply), run 10-Patch-TestCopy.ps1 -Apply, then start it again (05)." }
}
if (-not (Test-LocalListenAddress $listenHost)) { throw "gateway.json listens on $listenHost; only 127.0.0.1 or a private address of this machine is allowed." }
New-RlbDirs
if ($NoLineOfSight) {
    $j = Get-Content -Raw -LiteralPath $gwConfig | ConvertFrom-Json
    $j.anticheat | Add-Member -NotePropertyName lineOfSight -NotePropertyValue $false -Force
    $gwConfig = Join-Path $p.Config 'gateway.nolos.json'
    Write-RlbFileNoBom $gwConfig ($j | ConvertTo-Json -Depth 6)
}
$node = Get-NodeExe
$side = Start-Process -FilePath $node -ArgumentList @('tools\adapter-sidecar.mjs', ('"{0}"' -f $sideConfig)) -WorkingDirectory $script:RlbRepo -RedirectStandardOutput (Join-Path $p.Logs "sidecar-$stamp.log") -RedirectStandardError (Join-Path $p.Logs "sidecar-$stamp.err.log") -WindowStyle Hidden -PassThru
Set-Content -LiteralPath (Join-Path $p.Run 'sidecar.pid') -Value $side.Id
Start-Sleep -Seconds 2
$gw = Start-Process -FilePath $node -ArgumentList @('tools\gateway.mjs', 'run', ('"{0}"' -f $gwConfig)) -WorkingDirectory $script:RlbRepo -RedirectStandardOutput (Join-Path $p.Logs "gateway-$stamp.log") -RedirectStandardError (Join-Path $p.Logs "gateway-$stamp.err.log") -WindowStyle Hidden -PassThru
Set-Content -LiteralPath (Join-Path $p.Run 'gateway.pid') -Value $gw.Id
$deadline = (Get-Date).AddSeconds(240)
while ((Get-Date) -lt $deadline -and -not $gw.HasExited) {
    if (@(Get-NetTCPConnection -State Listen -LocalAddress $listenHost -LocalPort $s.ports.gateway -ErrorAction SilentlyContinue).Count) { break }
    Start-Sleep -Seconds 2
}
if ($gw.HasExited -or $side.HasExited) { Write-Host 'Sidecar or gateway exited; see the logs:' -ForegroundColor Red; Get-ChildItem -LiteralPath $p.Logs -Filter "*-$stamp*.log" | ForEach-Object { Write-Host "--- $($_.Name)"; Get-Content -LiteralPath $_.FullName -Tail 20 | Write-Host }; exit 1 }
Get-Content -LiteralPath (Join-Path $p.Logs "gateway-$stamp.err.log") -ErrorAction SilentlyContinue | Write-Host
Get-Content -LiteralPath (Join-Path $p.Logs "gateway-$stamp.log") -Tail 5 -ErrorAction SilentlyContinue | Write-Host
Write-Host "Sidecar PID $($side.Id), gateway PID $($gw.Id). Listening on $($listenHost):$($s.ports.gateway) (path /play)" -ForegroundColor Green
