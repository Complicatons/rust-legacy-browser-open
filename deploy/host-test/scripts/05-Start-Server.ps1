<#
.SYNOPSIS
  EXECUTES THE ORIGINAL rust_server.exe from the locked-down test copy, as the standard test account, with the
  shipped "Run Server.bat" arguments (-batchmode -cfg cfg/server.cfg -maxplayers 100 -port 29015
  -datadir "rust_server_Data/" -nographics). Refuses unless every lock-down check passes and you pass
  -ConfirmRunOriginalBinaries. Starts Process Monitor first (unless -NoProcmon); its licence dialog appears the
  first time and is yours to accept. Asks for the test account's password.
  The server's console window starts hidden (-ShowConsole shows it): librust writes every log line to that console
  on the main thread (LibRust.CaptureLog -> ConsoleLog), so a click into a visible console (QuickEdit selection)
  freezes the whole server until the selection ends. Server output is in rust_server_Data\output_log.txt.
  -ViaTask starts the scheduled task from 17-Register-ServerTask.ps1 instead of asking for the password (same exe,
  arguments, folder and account; the task's definition is checked first, and it has no console window), so it also
  works unattended (Cloud Shell Run Command, the boot task). Every other step is the same.
  Elevated PowerShell (Process Monitor needs it; the server itself runs as the test account, not as administrator).
#>
param([switch]$ConfirmRunOriginalBinaries, [switch]$NoProcmon, [string]$ProcmonExe, [int]$WaitSeconds = 180, [switch]$ShowConsole, [switch]$ViaTask, [switch]$Json)
. (Join-Path $PSScriptRoot '_Common.ps1')
$s = Get-RlbSettings
$p = Get-RlbPaths
$exe = Join-Path $p.TestCopy $s.server.exe
$argLine = Get-ServerArgLine
$stamp = Get-Stamp
$procmon = Get-ProcmonExe $ProcmonExe
$pml = Join-Path $p.Captures "procmon-$stamp.pml"

$steps = @('Run every lock-down check; refuse on any FAIL')
if (-not $NoProcmon) { $steps += "Start Process Monitor: $procmon /Quiet /Minimized /BackingFile $pml" }
if ($ViaTask) { $steps += "Check scheduled task $(Get-ServerTaskName) still runs exactly $($s.server.exe) $argLine in $($p.TestCopy) as $($s.account) (not elevated), then start it (no console window)" }
else { $steps += "As $($s.account), in $($p.TestCopy) run: $($s.server.exe) $argLine (console window $(if ($ShowConsole) { 'shown: do not click into it' } else { 'hidden' }))" }
$steps += "Wait up to $WaitSeconds s for UDP $($s.ports.server) on 127.0.0.1; record the PID in $($p.Run)\server.pid"
Write-Plan 'Start the original server (firewall-locked, test account)' $steps -RunsOriginalBinaries
Confirm-OrExit $ConfirmRunOriginalBinaries.IsPresent 'ConfirmRunOriginalBinaries'
Assert-Admin

$rows = Test-RlbLockdown
$fails = @($rows | Where-Object { $_.Status -eq 'FAIL' })
if ($fails.Count) { $rows | Format-Table -AutoSize -Wrap | Out-String -Width 220 | Write-Host; Write-RlbResult -Rows $rows; throw 'Lock-down check failed; refusing to start (04-Test-Isolation.ps1 shows details).' }
if (@(Get-Process rust_server -ErrorAction SilentlyContinue).Count) { throw 'rust_server.exe is already running.' }
if ($ViaTask) { $bad = Test-ServerTask; if ($bad.Count) { throw ('Server task check failed; refusing to start: ' + ($bad -join '; ')) } }
New-RlbDirs

if (-not $NoProcmon) {
    if (-not (Test-Path -LiteralPath $procmon)) { throw "Process Monitor not found at $procmon (download it from learn.microsoft.com/sysinternals, or pass -ProcmonExe <path>)." }
    if (-not @(Get-Process Procmon, Procmon64 -ErrorAction SilentlyContinue).Count) {
        Start-Process -FilePath $procmon -ArgumentList @('/Quiet', '/Minimized', '/BackingFile', $pml) | Out-Null
        Write-Host 'Waiting for Process Monitor (accept its licence dialog if it appears)...'
        $deadline = (Get-Date).AddSeconds(120)
        while (-not (Test-Path -LiteralPath $pml) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 1 }
        if (-not (Test-Path -LiteralPath $pml)) { throw 'Process Monitor did not start recording; not starting the server.' }
        Set-Content -LiteralPath (Join-Path $p.Run 'procmon.pml') -Value $pml
    }
}

if ($ViaTask) {
    Start-ScheduledTask -TaskName (Get-ServerTaskName)
    $deadline = (Get-Date).AddSeconds(30)
    $ids = @()
    while ((Get-Date) -lt $deadline) { $ids = Get-TestServerPids; if ($ids.Count) { break }; Start-Sleep -Milliseconds 500 }
    if ($ids.Count -ne 1) {
        $info = Get-ScheduledTaskInfo -TaskName (Get-ServerTaskName)
        throw "Task started but found $($ids.Count) rust_server.exe processes as $($s.account) (last task result $($info.LastTaskResult)). See $($p.TestCopy)\rust_server_Data\output_log.txt"
    }
    $proc = Get-Process -Id $ids[0]
    $null = $proc.Handle  # keep a handle so ExitCode is readable if it exits early
} else {
    $cred = Get-Credential -UserName $s.account -Message "Password of the test account $($s.account) (the server runs as this account)"
    $proc = Start-Process -FilePath $exe -ArgumentList $argLine -WorkingDirectory $p.TestCopy -Credential $cred -LoadUserProfile -PassThru -WindowStyle $(if ($ShowConsole) { 'Normal' } else { 'Hidden' })
}
Set-Content -LiteralPath (Join-Path $p.Run 'server.pid') -Value $proc.Id
Set-Content -LiteralPath (Join-Path $p.Run 'server.started') -Value $stamp
Write-Host "Started rust_server.exe PID $($proc.Id) as $($s.account). Waiting for UDP $($s.ports.server)..."
$deadline = (Get-Date).AddSeconds($WaitSeconds)
$listening = $false
while ((Get-Date) -lt $deadline) {
    if ($proc.HasExited) { break }
    if (@(Get-NetUDPEndpoint -LocalPort $s.ports.server -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $proc.Id }).Count) { $listening = $true; break }
    Start-Sleep -Seconds 2
}
$log = Join-Path $p.TestCopy 'rust_server_Data\output_log.txt'
if ($proc.HasExited) { Write-Host "Server exited early (code $($proc.ExitCode)). See $log" -ForegroundColor Red; Write-RlbResult 'FAIL' "Server exited early (code $($proc.ExitCode)). See $log"; exit 1 }
if ($listening) { Write-Host "Server listening on UDP $($s.ports.server)." -ForegroundColor Green; Write-RlbResult 'PASS' "PID $($proc.Id), listening on UDP $($s.ports.server)" } else { Write-Host "UDP $($s.ports.server) not listening after $WaitSeconds s; check $log" -ForegroundColor Yellow; Write-RlbResult 'WARN' "PID $($proc.Id) runs, but UDP $($s.ports.server) is not listening after $WaitSeconds s; check $log" }
Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $proc.Id } | Format-Table LocalAddress, LocalPort -AutoSize | Out-String | Write-Host
Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $proc.Id } | Format-Table LocalAddress, LocalPort, RemoteAddress, RemotePort, State -AutoSize | Out-String | Write-Host
if (Test-Path -LiteralPath $log) { Write-Host '--- last lines of output_log.txt ---'; Get-Content -LiteralPath $log -Tail 15 | Write-Host }
Write-Host 'Stop with 06-Stop-Server.ps1, then 07-Collect.ps1 -Apply.'
