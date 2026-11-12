<#
.SYNOPSIS
  One-time setup so the original server can start without anyone typing the test account's password: registers the
  on-demand scheduled task RLB-OriginalServer, which runs exactly what 05-Start-Server.ps1 runs (rust_server.exe with
  the shipped "Run Server.bat" arguments, in the test copy) as the standard test account, "whether the user is logged
  on or not". You type the test account's password into the Windows prompt; Task Scheduler keeps it (encrypted, as
  for any task with a stored password). It is never written to a file or log by these scripts. The script grants the
  account the "Log on as a batch job" right such a task needs (Register-ScheduledTask does not, unlike the Task
  Scheduler window; without it the task never starts: LastTaskResult 267011). The task runs in the non-interactive session, so the
  server has no console window at all (nothing to click into; see 05's QuickEdit note).
  The task has no trigger and starts nothing now. 05-Start-Server.ps1 -ConfirmRunOriginalBinaries -ViaTask runs every
  lock-down check first and then starts it; 06-Stop-Server.ps1 -Apply stops it as before.
  -AtBoot also registers RLB-OriginalServer-AtBoot (SYSTEM, at startup + 2 min): it runs
  05-Start-Server.ps1 -ConfirmRunOriginalBinaries -ViaTask -NoProcmon, so the server comes back after the VM's nightly
  shutdown and a start. The checks still run then and refuse on any FAIL; output goes to <root>\logs\boot-start-*.log.
  -Remove unregisters both tasks (the stored password goes with them) and takes the batch logon right back.
  Elevated PowerShell. Dry run unless -Apply.
#>
param([switch]$Apply, [switch]$AtBoot, [switch]$Remove, [switch]$Json)
. (Join-Path $PSScriptRoot '_Common.ps1')
$s = Get-RlbSettings
$p = Get-RlbPaths
$exe = Join-Path $p.TestCopy $s.server.exe
$argLine = Get-ServerArgLine
$task = Get-ServerTaskName
$boot = Get-BootTaskName
$start05 = Join-Path $PSScriptRoot '05-Start-Server.ps1'

if ($Remove) {
    Write-Plan 'Remove the server scheduled tasks' @("Unregister $task and $boot (if present); a running server keeps running (06-Stop-Server.ps1 stops it)", "Remove 'Log on as a batch job' (SeBatchLogonRight) from $($s.account)")
    Confirm-OrExit $Apply.IsPresent 'Apply'
    Assert-Admin
    foreach ($n in @($task, $boot)) { if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $n -Confirm:$false; Write-Host "Removed $n." } }
    $u = Get-TestAccount
    if ($u) { Revoke-AccountRight $u.SID.Value 'SeBatchLogonRight'; Write-Host "Removed 'Log on as a batch job' from $($s.account)." }
    exit 0
}

$steps = @(
    "Refuse unless $($s.account) exists and is a standard user (Users only)",
    "Grant $($s.account) 'Log on as a batch job' (SeBatchLogonRight, local security policy), which a task with a stored password needs",
    "Ask for the password of $($s.account) in a Windows prompt (kept by Task Scheduler only)",
    "Register task $task (no trigger, starts nothing now): as $($s.account), password stored, not elevated, run whether logged on or not; action: $exe $argLine; start in $($p.TestCopy); no time limit; normal priority"
)
if ($AtBoot) { $steps += "Register task $boot as SYSTEM, at startup + 2 min: powershell -File $start05 -ConfirmRunOriginalBinaries -ViaTask -NoProcmon (log in $($p.Logs))" }
Write-Plan 'Register the password-free server start' $steps -ChangesSecurity
Confirm-OrExit $Apply.IsPresent 'Apply'
Assert-Admin

$u = Get-TestAccount
if (-not $u -or -not $u.Enabled) { throw "$($s.account) missing or disabled (01-New-ServerAccount.ps1)." }
$std = Test-TestAccountIsStandard
if (-not $std.Standard) { throw "$($s.account) is in: $($std.Groups -join ', '). It must be in Users only." }
if (-not (Test-Path -LiteralPath $exe)) { throw "Missing $exe (02-Prepare-Server.ps1)." }
if ((Get-AccountRights $u.SID.Value) -notcontains 'SeBatchLogonRight') { Grant-AccountRight $u.SID.Value 'SeBatchLogonRight'; Write-Host "Granted $($s.account) 'Log on as a batch job'." }

$cred = Get-Credential -UserName $s.account -Message "Password of the test account $($s.account) (Task Scheduler keeps it to start the server)"
if (-not $cred) { throw 'No password given; nothing registered.' }
$action = New-ScheduledTaskAction -Execute $exe -Argument $argLine -WorkingDirectory $p.TestCopy
# Task Scheduler's default priority (7) is below normal; 4 is normal, as Start-Process gave the server before.
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -Priority 4 -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable:$false
$desc = 'Rust Legacy test: the original server as the locked-down test account. Start it only with 05-Start-Server.ps1 -ViaTask (lock-down checks first); stop with 06-Stop-Server.ps1.'
Register-ScheduledTask -TaskName $task -Description $desc -Action $action -Settings $settings -User $s.account -Password $cred.GetNetworkCredential().Password -RunLevel Limited -Force | Out-Null
$cred = $null
$bad = Test-ServerTask
if ($bad.Count) { throw ('Task registered but not as expected: ' + ($bad -join '; ')) }
Write-Host "Registered $task (runs as $($s.account), password stored by Task Scheduler)." -ForegroundColor Green

if ($AtBoot) {
    New-RlbDirs
    $cmd = "& '$start05' -ConfirmRunOriginalBinaries -ViaTask -NoProcmon *>&1 | Out-File -Encoding utf8 -FilePath (Join-Path '$($p.Logs)' ('boot-start-' + (Get-Date).ToString('yyyyMMdd-HHmmss') + '.log'))"
    $bootAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -Command "' + $cmd + '"') -WorkingDirectory $PSScriptRoot
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $trigger.Delay = 'PT2M'
    $bootSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $boot -Description 'Rust Legacy test: after the VM starts, 05-Start-Server.ps1 -ViaTask (lock-down checks, then the server task).' -Action $bootAction -Trigger $trigger -Settings $bootSettings -Principal $principal -Force | Out-Null
    Write-Host "Registered $boot (SYSTEM, at startup + 2 min)." -ForegroundColor Green
}
Write-Host 'Start the server with: .\05-Start-Server.ps1 -ConfirmRunOriginalBinaries -ViaTask   (stop: .\06-Stop-Server.ps1 -Apply)'
