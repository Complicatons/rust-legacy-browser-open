<#
.SYNOPSIS
  VM only (elevated). Sets the static host-only address with no gateway and no DNS, turns off IPv6 on the adapter,
  adds inbound firewall rules that admit only the host (gateway port and ping), creates C:\RLB, and optionally
  initialises the empty export disk (label RLB_EXPORT). Dry run unless -Apply.
.PARAMETER InitializeExportDisk
  Also partition and format the single RAW (never initialised) disk of 1..64 GB as NTFS, label RLB_EXPORT.
#>
param([switch]$Apply, [switch]$InitializeExportDisk)
$env:RLB_VM_SETUP = '1'
. (Join-Path $PSScriptRoot '_Common.ps1')
Assert-InVm
$s = Get-RlbSettings

$steps = @(
    "Set the only Up network adapter to $($s.network.vmAddress)/$($s.network.prefixLength) with NO default gateway",
    'Remove all DNS servers from it and turn off DNS registration',
    'Unbind IPv6 from the adapter (fewer ways out)',
    "Add firewall rules: inbound TCP $($s.ports.gateway) and ICMPv4 echo from $($s.network.hostAddress) only",
    'Create C:\RLB\{app,config,secrets,data,logs,captures,run,export,tools,server}'
)
if ($InitializeExportDisk) { $steps += 'Initialise the RAW export disk: GPT, one NTFS partition, label RLB_EXPORT' }
Write-Plan 'Configure guest network and folders' $steps
Confirm-OrExit $Apply.IsPresent 'Apply'
Assert-Admin

$up = @(Get-NetAdapter | Where-Object { $_.Status -eq 'Up' })
if ($up.Count -ne 1) { throw "Expected exactly one Up adapter (host-only); found $($up.Count). Fix the VM hardware first (RUNBOOK.md P0)." }
$nic = $up[0]
Set-NetIPInterface -InterfaceIndex $nic.ifIndex -Dhcp Disabled -AddressFamily IPv4
Get-NetIPAddress -InterfaceIndex $nic.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue
Get-NetRoute -InterfaceIndex $nic.ifIndex -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue
New-NetIPAddress -InterfaceIndex $nic.ifIndex -IPAddress $s.network.vmAddress -PrefixLength $s.network.prefixLength | Out-Null
Set-DnsClientServerAddress -InterfaceIndex $nic.ifIndex -ResetServerAddresses
Set-DnsClient -InterfaceIndex $nic.ifIndex -RegisterThisConnectionsAddress $false
Disable-NetAdapterBinding -Name $nic.Name -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue

foreach ($name in @('RLB vm-test gateway from host', 'RLB vm-test ping from host')) { Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule }
New-NetFirewallRule -DisplayName 'RLB vm-test gateway from host' -Direction Inbound -Protocol TCP -LocalPort $s.ports.gateway -LocalAddress $s.network.vmAddress -RemoteAddress $s.network.hostAddress -Action Allow -Profile Any | Out-Null
New-NetFirewallRule -DisplayName 'RLB vm-test ping from host' -Direction Inbound -Protocol ICMPv4 -IcmpType 8 -RemoteAddress $s.network.hostAddress -Action Allow -Profile Any | Out-Null
New-RlbDirs
Protect-SecretsDir

if ($InitializeExportDisk) {
    $raw = @(Get-Disk | Where-Object { $_.PartitionStyle -eq 'RAW' -and $_.Size -ge 1GB -and $_.Size -le 64GB })
    if ($raw.Count -ne 1) { throw "Expected exactly one RAW disk of 1..64 GB for exports; found $($raw.Count). Add it in VMware (RUNBOOK.md P0) or skip -InitializeExportDisk." }
    $d = $raw[0]
    Initialize-Disk -Number $d.Number -PartitionStyle GPT
    $part = New-Partition -DiskNumber $d.Number -UseMaximumSize -AssignDriveLetter
    Format-Volume -Partition $part -FileSystem NTFS -NewFileSystemLabel $s.vm.exportVolumeLabel -Confirm:$false | Out-Null
    Write-Host ("Export disk ready as {0}:\ ({1})" -f $part.DriveLetter, $s.vm.exportVolumeLabel)
}
Remove-Item Env:\RLB_VM_SETUP -ErrorAction SilentlyContinue
Write-Host 'Guest configured. Now run 00-Test-Isolation.ps1.' -ForegroundColor Green
