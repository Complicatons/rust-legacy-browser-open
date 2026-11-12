<#
.SYNOPSIS
  Undoes the host-test setup: removes the "RLB host test" firewall rules and restores the firewall logging settings
  saved by 03-Set-Firewall.ps1. -RemoveAccount also deletes the test account (and its profile folder);
  -RemoveFiles also deletes C:\RLB-host (export it first if you want the evidence). Server must be stopped.
  Elevated PowerShell. Dry run unless -Apply.
#>
param([switch]$Apply, [switch]$RemoveAccount, [switch]$RemoveFiles)
. (Join-Path $PSScriptRoot '_Common.ps1')
$s = Get-RlbSettings
$p = Get-RlbPaths
$steps = @("Remove the firewall rules in group '$($s.firewallGroup)'", "Restore firewall logging from $($p.Run)\firewall-logging-before.json", "Unregister the scheduled tasks $(Get-ServerTaskName) and $(Get-BootTaskName) (17-Register-ServerTask.ps1) and the test account's batch logon right")
if ($RemoveAccount) { $steps += "Delete the local account $($s.account), its profile folder and its sign-in screen entry" }
if ($RemoveFiles) { $steps += "Delete $($p.Root)" }
Write-Plan 'Remove the host-test setup' $steps -ChangesSecurity
Confirm-OrExit $Apply.IsPresent 'Apply'
Assert-Admin
if (Get-PidFromFile 'server.pid') { throw 'The test server is still running; stop it with 06-Stop-Server.ps1 first.' }

foreach ($n in @((Get-ServerTaskName), (Get-BootTaskName))) { if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $n -Confirm:$false; Write-Host "Removed task $n." } }
$u = Get-TestAccount
if ($u -and (Get-AccountRights $u.SID.Value) -contains 'SeBatchLogonRight') { Revoke-AccountRight $u.SID.Value 'SeBatchLogonRight'; Write-Host "Removed 'Log on as a batch job' from $($s.account)." }
Get-FirewallRules | Remove-NetFirewallRule
$before = Join-Path $p.Run 'firewall-logging-before.json'
if (Test-Path -LiteralPath $before) {
    foreach ($b in @(Get-Content -Raw -LiteralPath $before | ConvertFrom-Json)) {
        $blocked = if ("$($b.LogBlocked)" -match '^(1|True)$') { 'True' } elseif ("$($b.LogBlocked)" -match '^(2|NotConfigured)$') { 'NotConfigured' } else { 'False' }
        Set-NetFirewallProfile -Name $b.Name -LogBlocked $blocked -LogMaxSizeKilobytes $b.LogMaxSizeKilobytes
    }
    Remove-Item -LiteralPath $before
}
Write-Host 'Firewall rules removed and logging restored.'

if ($RemoveAccount) {
    $u = Get-TestAccount
    if ($u) {
        $prof = Get-CimInstance Win32_UserProfile | Where-Object { $_.SID -eq $u.SID.Value }
        if ($prof) { $prof | Remove-CimInstance }
        Remove-LocalUser -Name $s.account
    }
    Remove-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList' -Name $s.account -ErrorAction SilentlyContinue
    Write-Host "Account $($s.account) removed."
}
if ($RemoveFiles -and (Test-Path -LiteralPath $p.Root)) { Remove-Item -LiteralPath $p.Root -Recurse -Force; Write-Host "$($p.Root) deleted." }
