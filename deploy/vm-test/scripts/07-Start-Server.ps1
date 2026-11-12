<#
.SYNOPSIS
  VM only. EXECUTES THE ORIGINAL rust_server.exe from the test copy with the shipped "Run Server.bat" arguments
  (-batchmode -cfg cfg/server.cfg -maxplayers 100 -port 29015 -datadir "rust_server_Data/" -nographics).
  Requires -ConfirmRunOriginalBinaries and a passing isolation check. Optional: -Procmon (Sysinternals Process
  Monitor backing file; accepts the Sysinternals EULA on the owner's behalf), -Capture (dumpcap on all interfaces
  incl. the Npcap loopback adapter). -Phase labels the output files (P1..P8).
#>
param([switch]$ConfirmRunOriginalBinaries, [switch]$Procmon, [switch]$Capture, [ValidatePattern('^P[0-9]$')][string]$Phase = 'P1', [int]$WaitSeconds = 180)
. (Join-Path $PSScriptRoot '_Common.ps1')
Assert-NotHost
$s = Get-RlbSettings
$p = Get-RlbPaths
$exe = Join-Path $p.TestCopy $s.server.exe
$argLine = ($s.server.args | ForEach-Object { if ($_ -match '[\s/]$|\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
$stamp = Get-Stamp
$procmonExe = Join-Path $p.Tools 'sysinternals\Procmon64.exe'
$dumpcap = Join-Path $env:ProgramFiles 'Wireshark\dumpcap.exe'

$steps = @('Run the isolation check; refuse to continue on any FAIL')
if ($Procmon) { $steps += "Start Process Monitor: $procmonExe /AcceptEula /Quiet /Minimized /BackingFile $($p.Captures)\procmon-$Phase-$stamp.pml" }
if ($Capture) { $steps += "Start dumpcap on every capture interface (incl. Npcap loopback) -> $($p.Captures)\vm-$Phase-$stamp.pcapng" }
$steps += "In $($p.TestCopy) run: $($s.server.exe) $argLine"
$steps += "Wait up to $WaitSeconds s for UDP $($s.ports.server) to be listening; record the PID in C:\RLB\run\server.pid"
Write-Plan "Start the original server ($Phase)" $steps -RunsOriginalBinaries
Confirm-OrExit $ConfirmRunOriginalBinaries.IsPresent 'ConfirmRunOriginalBinaries'

Assert-RlbIsolation
if (-not (Test-Path -LiteralPath $exe)) { throw "Missing $exe (run 05-New-TestCopy.ps1)." }
if (@(Get-Process rust_server -ErrorAction SilentlyContinue).Count) { throw 'rust_server.exe is already running.' }
New-RlbDirs

if ($Procmon) {
    if (-not (Test-Path -LiteralPath $procmonExe)) { throw "Process Monitor not found at $procmonExe (installers slot + 02-Install-Tools.ps1)." }
    Start-Process -FilePath $procmonExe -ArgumentList @('/AcceptEula', '/Quiet', '/Minimized', '/BackingFile', (Join-Path $p.Captures "procmon-$Phase-$stamp.pml")) | Out-Null
    Start-Sleep -Seconds 5
}
if ($Capture) {
    if (-not (Test-Path -LiteralPath $dumpcap)) { throw "dumpcap not found at $dumpcap (install Wireshark + Npcap with loopback support)." }
    $list = & $dumpcap -D 2>$null
    $ifArgs = @()
    foreach ($l in $list) { if ($l -match '^(\d+)\.') { $ifArgs += @('-i', $Matches[1]) } }
    if (-not $ifArgs.Count) { throw 'dumpcap lists no interfaces.' }
    $cap = Start-Process -FilePath $dumpcap -ArgumentList ($ifArgs + @('-w', (Join-Path $p.Captures "vm-$Phase-$stamp.pcapng"))) -WindowStyle Minimized -PassThru
    Set-Content -LiteralPath (Join-Path $p.Run 'dumpcap.pid') -Value $cap.Id
    Start-Sleep -Seconds 3
}

$proc = Start-Process -FilePath $exe -ArgumentList $argLine -WorkingDirectory $p.TestCopy -PassThru
Set-Content -LiteralPath (Join-Path $p.Run 'server.pid') -Value $proc.Id
Set-Content -LiteralPath (Join-Path $p.Run 'server.phase') -Value "$Phase $stamp"
Write-Host "Started rust_server.exe PID $($proc.Id). Waiting for UDP $($s.ports.server)..."
$deadline = (Get-Date).AddSeconds($WaitSeconds)
$listening = $false
while ((Get-Date) -lt $deadline) {
    if ($proc.HasExited) { break }
    if (@(Get-NetUDPEndpoint -LocalPort $s.ports.server -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $proc.Id }).Count) { $listening = $true; break }
    Start-Sleep -Seconds 2
}
$log = Join-Path $p.TestCopy 'rust_server_Data\output_log.txt'
if ($proc.HasExited) { Write-Host "Server exited early (code $($proc.ExitCode)). See $log" -ForegroundColor Red; exit 1 }
if ($listening) { Write-Host "Server listening on UDP $($s.ports.server)." -ForegroundColor Green } else { Write-Host "UDP $($s.ports.server) not listening after $WaitSeconds s; check $log" -ForegroundColor Yellow }
Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $proc.Id } | Format-Table LocalAddress, LocalPort -AutoSize | Out-String | Write-Host
Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $proc.Id } | Format-Table LocalAddress, LocalPort, RemoteAddress, RemotePort, State -AutoSize | Out-String | Write-Host
if (Test-Path -LiteralPath $log) { Write-Host '--- last lines of output_log.txt ---'; Get-Content -LiteralPath $log -Tail 15 | Write-Host }
