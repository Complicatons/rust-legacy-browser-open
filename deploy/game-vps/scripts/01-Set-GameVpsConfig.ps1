<#
.SYNOPSIS
  ON THE OVH GAME VPS (public eu1), after deploy\host-test\scripts\02-Prepare-Server.ps1. Points the host-test kit at the
  public setup (deploy\game-vps\README.md):
    - renders deploy\game-vps\config into C:\RLB-host\config-templates (host-test scripts 10 and 13 use these): the
      gateway listens on this VPS's public IPv4 address, port 443, with the Cloudflare Origin certificate
      (secrets\gateway-tls.pfx, from 02/03 here), trusts Cloudflare's forwarding headers, and admits players from
      https://your-domain.example only. The website (central) is NOT run here: it lives on the web VPS.
    - Windows Firewall group "RLB game vps": inbound TCP 443 for node.exe from Cloudflare's address ranges only
      (fetched from cloudflare.com, or the list built into bridge/client-ip.mjs if that fails).
    - limits Windows' own Remote Desktop rules and the OpenSSH server rule to -OwnerIp.
  The original server stays blocked in and out by host-test 03-Set-Firewall.ps1; nothing opens UDP 29015 (browser
  players reach it through the gateway on loopback; LauncherOnly=true refuses plain native logins).
  Nothing here starts any process. Elevated PowerShell. Dry run unless -Apply.
#>
param([Parameter(Mandatory = $true)][string]$OwnerIp, [string]$PublicIp, [switch]$Apply, [switch]$Json)
. (Join-Path $PSScriptRoot '..\..\host-test\scripts\_Common.ps1')
$p = Get-RlbPaths
$isPrivate = { param($a) $a -match '^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|169\.254\.)' }
if (-not ($OwnerIp -as [Net.IPAddress]) -or (& $isPrivate $OwnerIp)) { throw "-OwnerIp $OwnerIp must be your home public IPv4 address (search 'what is my IP')." }
if (-not $PublicIp) {
    $found = @(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | ForEach-Object { $_.IPv4Address.IPAddress } | Where-Object { -not (& $isPrivate $_) })
    if ($found.Count -ne 1) { throw "Expected one public IPv4 address on this VPS, found: $($found -join ', ') (pass -PublicIp)" }
    $PublicIp = $found[0]
}
if (-not ($PublicIp -as [Net.IPAddress]) -or (& $isPrivate $PublicIp)) { throw "-PublicIp $PublicIp must be this VPS's public IPv4 address." }
if (-not (Get-NetIPAddress -IPAddress $PublicIp -ErrorAction SilentlyContinue)) { throw "$PublicIp is not an address of this machine." }
$templates = Join-Path $p.Root 'config-templates'
$node = try { Get-NodeExe } catch { $null }
$group = 'RLB game vps'
Write-Plan 'Point the host-test kit at the public game VPS (eu1.your-domain.example)' @(
    "Public address $PublicIp; your address $OwnerIp",
    "Write $templates\{gateway,sidecar}.host-test.json and rustlegacybrowser.cfg.template from deploy\game-vps\config (gateway on ${PublicIp}:443, LauncherOnly=true)",
    "Windows Firewall group '$group': allow inbound TCP 443 for $node from Cloudflare's address ranges only",
    "Limit the 'Remote Desktop' rules and 'OpenSSH-Server-In-TCP' to $OwnerIp"
) -ChangesSecurity
Confirm-OrExit $Apply.IsPresent 'Apply'
Assert-Admin
if (-not $node) { throw 'Install Node first (deploy\azure-test\scripts\00-Install-Node.ps1), then open a new PowerShell window.' }
if (-not (Test-Path -LiteralPath $p.Root)) { throw 'Run deploy\host-test\scripts\02-Prepare-Server.ps1 first.' }

# Cloudflare's ranges: live lists first, the gateway's built-in list (bridge/client-ip.mjs) as the fallback.
$ranges = @()
try {
    foreach ($u in @('https://www.cloudflare.com/ips-v4', 'https://www.cloudflare.com/ips-v6')) {
        $ranges += @((Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 20).Content -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    }
} catch { $ranges = @() }
$fallback = $ranges.Count -lt 10
if ($fallback) {
    Push-Location $script:RlbRepo
    try { $ranges = @(& $node -e "import('./bridge/client-ip.mjs').then(m=>console.log(m.CLOUDFLARE_RANGES.join('\n')))" | ForEach-Object { $_.Trim() } | Where-Object { $_ }) } finally { Pop-Location }
    Write-Host 'cloudflare.com unreachable: using the ranges built into bridge/client-ip.mjs.' -ForegroundColor Yellow
}
if ($ranges.Count -lt 10 -or ($ranges | Where-Object { $_ -notmatch '^[0-9a-f:.]+/\d{1,3}$' })) { throw "Cloudflare range list looks wrong: $($ranges -join ', ')" }

New-Item -ItemType Directory -Force -Path $templates | Out-Null
$src = Join-Path (Split-Path -Parent $PSScriptRoot) 'config'
foreach ($n in @('gateway', 'sidecar')) {
    $t = [IO.File]::ReadAllText((Join-Path $src "$n.game-vps.json")).Replace('__PUBLIC_IP__', $PublicIp)
    Write-RlbFileNoBom (Join-Path $templates "$n.host-test.json") $t
}
Copy-Item -LiteralPath (Join-Path $src 'rustlegacybrowser.cfg.template') -Destination (Join-Path $templates 'rustlegacybrowser.cfg.template') -Force
Set-Content -LiteralPath (Join-Path $templates 'public-ip.txt') -Value $PublicIp

Get-NetFirewallRule -Group $group -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -Group $group -DisplayName "$($group): gateway 443 from Cloudflare (node)" -Direction Inbound -Action Allow -Protocol TCP `
    -LocalPort 443 -LocalAddress $PublicIp -RemoteAddress $ranges -Program $node -Profile Any | Out-Null
Get-NetFirewallRule -DisplayGroup 'Remote Desktop' -ErrorAction SilentlyContinue | Where-Object Direction -eq 'Inbound' | Set-NetFirewallRule -RemoteAddress $OwnerIp
Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue | Set-NetFirewallRule -RemoteAddress $OwnerIp

Write-Host "Config templates written to $templates. Firewall: 443 from $($ranges.Count) Cloudflare ranges (node.exe); RDP/SSH from $OwnerIp only." -ForegroundColor Green
Write-Host 'Other enabled inbound allow rules on this VPS (review; Windows defaults such as Core Networking are expected):'
Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True | Where-Object { $_.Group -ne $group -and $_.DisplayGroup -ne 'Remote Desktop' -and $_.Name -ne 'OpenSSH-Server-In-TCP' } |
    Sort-Object DisplayGroup, DisplayName | ForEach-Object { '  {0} | {1}' -f $_.DisplayGroup, $_.DisplayName } | Select-Object -Unique
Write-RlbResult $(if ($fallback) { 'WARN' } else { 'PASS' }) $(if ($fallback) { "cloudflare.com unreachable: 443 open to the $($ranges.Count) Cloudflare ranges built into bridge/client-ip.mjs" } else { "443 open to $($ranges.Count) Cloudflare ranges; RDP/SSH from $OwnerIp only" })
Write-Host 'Next: host-test 03, 04, 08, then game-vps 02 (certificate request), see deploy\game-vps\README.md.'
