<#
.SYNOPSIS
  Windows Defender Firewall rules (group "RLB host test"), all profiles:
    - block every OUTBOUND connection from the test copy's rust_server.exe,
    - block every INBOUND connection to it (nothing on your network or the internet can reach the server),
    - block every OUTBOUND connection from any program running as the test account (covers anything the server
      might start).
  Loopback (127.0.0.1) is not filtered by Windows Firewall, so our gateway on this PC still reaches the server on
  UDP 29015; 04-Test-Isolation.ps1 proves both halves. Also turns on logging of dropped packets for every profile
  (pfirewall.log) and records the previous logging settings so 99-Remove.ps1 can restore them.
  Elevated PowerShell. Dry run unless -Apply.
#>
param([switch]$Apply, [switch]$Json)
. (Join-Path $PSScriptRoot '_Common.ps1')
$s = Get-RlbSettings
$p = Get-RlbPaths
$exe = Join-Path $p.TestCopy $s.server.exe
$group = $s.firewallGroup

Write-Plan 'Firewall lock-down for the test server' @(
    "Remove any existing rules in group '$group'",
    "Outbound BLOCK, program $exe, all profiles",
    "Inbound BLOCK, program $exe, all profiles",
    "Outbound BLOCK for every program running as $($s.account) (rule condition: local user SID)",
    "Save the current firewall logging settings to $($p.Run)\firewall-logging-before.json",
    'Turn on dropped-packet logging (LogBlocked) for Domain, Private and Public, 16 MB log'
) -ChangesSecurity
Confirm-OrExit $Apply.IsPresent 'Apply'
Assert-Admin
New-RlbDirs
$sid = Get-TestAccountSid

Get-FirewallRules | Remove-NetFirewallRule
$common = @{ Group = $group; Profile = 'Any'; Action = 'Block'; Enabled = 'True' }
New-NetFirewallRule @common -DisplayName 'RLB host test: block server outbound' -Direction Outbound -Program $exe | Out-Null
New-NetFirewallRule @common -DisplayName 'RLB host test: block server inbound' -Direction Inbound -Program $exe | Out-Null
New-NetFirewallRule @common -DisplayName 'RLB host test: block test account outbound' -Direction Outbound -LocalUser ("D:(A;;CC;;;{0})" -f $sid) | Out-Null

$before = Join-Path $p.Run 'firewall-logging-before.json'
if (-not (Test-Path -LiteralPath $before)) {
    Get-NetFirewallProfile | Select-Object Name, LogBlocked, LogAllowed, LogFileName, LogMaxSizeKilobytes | ConvertTo-Json | Set-Content -LiteralPath $before
}
Set-NetFirewallProfile -All -LogBlocked True -LogMaxSizeKilobytes 16384
Get-FirewallRules | Format-Table DisplayName, Direction, Action, Enabled, Profile -AutoSize | Out-String | Write-Host
Write-Host 'Firewall rules in place. Next: 04-Test-Isolation.ps1 -Apply.' -ForegroundColor Green
