<#
.SYNOPSIS
  HOST (elevated, owner decision). Adds or removes ONE inbound Windows Firewall rule so the test VM (192.168.56.10)
  can reach central on 192.168.56.1:8080, and nothing else can. -Apply adds it, -Remove deletes it (do this at P9).
#>
param([switch]$Apply, [switch]$Remove)
. (Join-Path $PSScriptRoot '_HostCommon.ps1')
$s = Get-RlbSettings
$name = 'RLB vm-test central from VM'
if ($Remove) {
    Write-Plan 'Remove the vm-test firewall rule' @("Delete inbound rule '$name'")
    Assert-Admin
    Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Write-Host 'Removed.' -ForegroundColor Green; exit 0
}
$node = Get-NodeExe
Write-Plan 'Allow the VM to reach central' @("Add inbound rule '$name': TCP $($s.ports.central), local $($s.network.hostAddress), remote $($s.network.vmAddress) only, program $node")
Confirm-OrExit $Apply.IsPresent 'Apply'
Assert-Admin
Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort $s.ports.central -LocalAddress $s.network.hostAddress -RemoteAddress $s.network.vmAddress -Program $node -Action Allow -Profile Any | Out-Null
Write-Host 'Rule added.' -ForegroundColor Green
