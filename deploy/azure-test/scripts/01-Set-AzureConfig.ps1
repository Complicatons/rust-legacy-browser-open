<#
.SYNOPSIS
  ON THE AZURE TEST VM, after deploy\host-test\scripts\02-Prepare-Server.ps1. Points the host-test kit at this VM:
    - renders deploy\azure-test\config into C:\RLB-host\config-templates (the host-test scripts 10, 11 and 13 use
      these instead of their loopback templates): website and gateway listen on this VM's private address, browsers
      reach them on the public address -PublicIp (printed by the Cloud Shell script),
    - opens Windows Firewall inbound TCP 8080 (website) and 28443 (gateway) for node.exe only, group "RLB azure test".
      Azure's network security group already limits those ports (and RDP) to your own IP address.
  The original server stays blocked in and out by 03-Set-Firewall.ps1; nothing opens UDP 29015.
  Elevated PowerShell. Dry run unless -Apply.
#>
param([Parameter(Mandatory = $true)][string]$PublicIp, [string]$PrivateIp, [switch]$Apply)
. (Join-Path $PSScriptRoot '..\..\host-test\scripts\_Common.ps1')
$p = Get-RlbPaths
$s = Get-RlbSettings
if (-not ($PublicIp -as [Net.IPAddress]) -or $PublicIp -match '^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.)') { throw "-PublicIp $PublicIp must be the VM's public IPv4 address." }
$private = if ($PrivateIp) { @($PrivateIp) } else { @(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | ForEach-Object { $_.IPv4Address.IPAddress }) }
if ($private.Count -ne 1) { throw "Expected one network adapter with a default gateway, found: $($private -join ', ') (pass -PrivateIp)" }
$private = $private[0]
if (-not (Test-LocalListenAddress $private)) { throw "$private is not a private address of this machine." }
$templates = Join-Path $p.Root 'config-templates'
$node = try { Get-NodeExe } catch { $null }
Write-Plan 'Point the host-test kit at this Azure VM' @(
    "Private address $private, public address $PublicIp",
    "Write $templates\{central,gateway,sidecar}.host-test.json and rustlegacybrowser.cfg.template from deploy\azure-test\config",
    "Windows Firewall: allow inbound TCP $($s.ports.central) and $($s.ports.gateway) for $node (group 'RLB azure test')"
) -ChangesSecurity
Confirm-OrExit $Apply.IsPresent 'Apply'
Assert-Admin
if (-not $node) { throw 'Install Node first (00-Install-Node.ps1), then open a new PowerShell window.' }
if (-not (Test-Path -LiteralPath $p.Root)) { throw 'Run deploy\host-test\scripts\02-Prepare-Server.ps1 first.' }
New-Item -ItemType Directory -Force -Path $templates | Out-Null
$src = Join-Path (Split-Path -Parent $PSScriptRoot) 'config'
foreach ($n in @('central', 'gateway', 'sidecar')) {
    $t = [IO.File]::ReadAllText((Join-Path $src "$n.azure-test.json")).Replace('__PRIVATE_IP__', $private).Replace('__PUBLIC_IP__', $PublicIp)
    Write-RlbFileNoBom (Join-Path $templates "$n.host-test.json") $t
}
Copy-Item -LiteralPath (Join-Path $src 'rustlegacybrowser.cfg.template') -Destination (Join-Path $templates 'rustlegacybrowser.cfg.template') -Force
Set-Content -LiteralPath (Join-Path $templates 'public-ip.txt') -Value $PublicIp

Get-NetFirewallRule -Group 'RLB azure test' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -Group 'RLB azure test' -DisplayName 'RLB azure test: website and gateway (node)' -Direction Inbound -Action Allow -Protocol TCP `
    -LocalPort @($s.ports.central, $s.ports.gateway) -Program $node -Profile Any | Out-Null
Write-Host "Config templates written to $templates; firewall allows node.exe on TCP $($s.ports.central), $($s.ports.gateway)." -ForegroundColor Green
Write-Host "Next: host-test scripts 03, 04, then 08, 09 -IpAddress $PublicIp, 10, 11 (see deploy\azure-test\RUNBOOK.md)."
