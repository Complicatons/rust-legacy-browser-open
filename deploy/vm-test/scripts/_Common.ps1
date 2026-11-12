# Shared helpers for the VM runbook scripts (dot-sourced; Windows PowerShell 5.1 compatible).
# These scripts run INSIDE the isolated test VM only, started by the owner. Never run them on the host PC.
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

$script:RlbScriptsDir = $PSScriptRoot
$script:RlbDeployDir = Split-Path -Parent $PSScriptRoot
$script:RlbSettings = Get-Content -Raw -LiteralPath (Join-Path $script:RlbDeployDir 'settings.json') | ConvertFrom-Json

function Get-RlbSettings { return $script:RlbSettings }

function Get-RlbPaths {
    $root = $script:RlbSettings.vm.root
    return [pscustomobject]@{
        Root      = $root
        App       = Join-Path $root 'app'
        Config    = Join-Path $root 'config'
        Secrets   = Join-Path $root 'secrets'
        Data      = Join-Path $root 'data'
        Logs      = Join-Path $root 'logs'
        Captures  = Join-Path $root 'captures'
        Run       = Join-Path $root 'run'
        Export    = Join-Path $root 'export'
        Tools     = Join-Path $root 'tools'
        Server    = Join-Path $root 'server'
        Original  = Join-Path $root 'server\original'
        TestCopy  = Join-Path $root 'server\test'
        Manifests = Join-Path $root 'server\manifests'
    }
}

function Assert-InVm {
    # VM-only scripts: refuse on physical hardware (the host PC). VMware guests report "VMware..." as the model.
    $cs = Get-CimInstance Win32_ComputerSystem
    if (("{0} {1}" -f $cs.Manufacturer, $cs.Model) -notmatch 'VMware') {
        throw "This is not a VMware virtual machine ($($cs.Manufacturer) $($cs.Model)). These scripts run only inside the isolated test VM, never on the host."
    }
}

function Assert-NotHost {
    # Refuse to run on a machine that does not carry the VM's host-only address: the scripts are VM-only.
    Assert-InVm
    $vm = $script:RlbSettings.network.vmAddress
    $mine = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { $_.IPAddress })
    if ($mine -notcontains $vm -and -not $env:RLB_VM_SETUP) {
        throw "This machine does not have the VM address $vm. These scripts run only inside the isolated test VM (run scripts\01-Configure-Guest.ps1 first; it sets RLB_VM_SETUP for itself)."
    }
}

function Write-Plan {
    param([string]$Title, [string[]]$Steps, [switch]$RunsOriginalBinaries)
    Write-Host ''
    Write-Host "== $Title ==" -ForegroundColor Cyan
    Write-Host 'This script will:'
    $i = 1
    foreach ($s in $Steps) { Write-Host ("  {0}. {1}" -f $i, $s); $i++ }
    if ($RunsOriginalBinaries) {
        Write-Host ''
        Write-Host '  !! This EXECUTES ORIGINAL GAME/SERVER BINARIES (inside this VM only).' -ForegroundColor Yellow
        Write-Host '  !! Only continue if the owner approved this phase and a snapshot was taken.' -ForegroundColor Yellow
    }
    Write-Host ''
}

function Confirm-OrExit {
    param([bool]$Confirmed, [string]$SwitchName)
    if (-not $Confirmed) {
        Write-Host "Dry run only. Nothing was changed. Re-run with -$SwitchName to perform the steps above." -ForegroundColor Yellow
        exit 0
    }
}

function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run this script from an elevated PowerShell (Run as administrator).'
    }
}

function New-RlbDirs {
    $p = Get-RlbPaths
    foreach ($d in @($p.Root, $p.Config, $p.Secrets, $p.Data, $p.Logs, $p.Captures, $p.Run, $p.Export, $p.Tools, $p.Server, $p.Manifests)) {
        if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d | Out-Null }
    }
}

function Get-Stamp { return (Get-Date).ToString('yyyyMMdd-HHmmss') }

function Get-Sha256([string]$Path) { return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToUpperInvariant() }

function Find-RlbVolume([string]$Label) {
    $v = Get-Volume -ErrorAction SilentlyContinue | Where-Object { $_.FileSystemLabel -eq $Label -and $_.DriveLetter } | Select-Object -First 1
    if ($v) { return ($v.DriveLetter + ':\') }
    return $null
}

function Find-ToolsMedia {
    # The read-only tools ISO (label RLB_VMTEST); falls back to the copy under C:\RLB\app.
    $iso = Find-RlbVolume $script:RlbSettings.vm.isoVolumeLabel
    if ($iso) { return $iso }
    $p = Get-RlbPaths
    if (Test-Path -LiteralPath (Join-Path $p.App 'README.txt')) { return ($p.App + '\') }
    throw "Tools ISO (volume label $($script:RlbSettings.vm.isoVolumeLabel)) is not mounted. Attach it in VMware (CD/DVD, Use ISO image, Connected)."
}

function Read-Secret([string]$Name) {
    $f = Join-Path (Get-RlbPaths).Secrets $Name
    if (-not (Test-Path -LiteralPath $f)) { throw "Missing secret $f (run scripts\03-New-Secrets.ps1)." }
    return (Get-Content -Raw -LiteralPath $f).Trim()
}

function Get-NodeExe {
    $n = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($n) { return $n.Source }
    $default = Join-Path $env:ProgramFiles 'nodejs\node.exe'
    if (Test-Path -LiteralPath $default) { return $default }
    throw 'Node.js is not installed in the VM (scripts\02-Install-Tools.ps1 installs it from the ISO installers slot).'
}

function Test-TcpReachable([string]$HostName, [int]$Port, [int]$TimeoutMs = 1500) {
    $c = New-Object Net.Sockets.TcpClient
    try {
        $ar = $c.BeginConnect($HostName, $Port, $null, $null)
        if (-not $ar.AsyncWaitHandle.WaitOne($TimeoutMs)) { return $false }
        $c.EndConnect($ar); return $true
    } catch { return $false } finally { $c.Close() }
}

function Test-Ping([string]$Address) {
    try { return [bool](Test-Connection -ComputerName $Address -Count 1 -Quiet -ErrorAction SilentlyContinue) } catch { return $false }
}

# Isolation checks shared by 00-Test-Isolation.ps1 and every script that starts something.
function Test-RlbIsolation {
    $s = $script:RlbSettings
    $results = New-Object System.Collections.Generic.List[object]
    function Add-Check([string]$Check, [string]$Status, [string]$Detail) { $results.Add([pscustomobject]@{ Check = $Check; Status = $Status; Detail = $Detail }) }

    $up = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' })
    if ($up.Count -eq 1) { Add-Check 'one network adapter up' 'PASS' $up[0].Name } else { Add-Check 'one network adapter up' 'FAIL' ("{0} adapters up: {1}" -f $up.Count, (($up | ForEach-Object { $_.Name }) -join ', ')) }

    $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne '127.0.0.1' })
    $vmIp = @($ips | Where-Object { $_.IPAddress -eq $s.network.vmAddress -and $_.PrefixLength -eq $s.network.prefixLength })
    $other = @($ips | Where-Object { $_.IPAddress -ne $s.network.vmAddress })
    if ($vmIp.Count -eq 1 -and $other.Count -eq 0) { Add-Check 'static host-only IPv4' 'PASS' ("{0}/{1}" -f $s.network.vmAddress, $s.network.prefixLength) }
    else { Add-Check 'static host-only IPv4' 'FAIL' ("addresses: " + (($ips | ForEach-Object { "$($_.IPAddress)/$($_.PrefixLength)" }) -join ', ')) }

    $gw4 = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue)
    $gw6 = @(Get-NetRoute -DestinationPrefix '::/0' -ErrorAction SilentlyContinue)
    if ($gw4.Count -eq 0 -and $gw6.Count -eq 0) { Add-Check 'no default gateway' 'PASS' 'no 0.0.0.0/0 or ::/0 route' } else { Add-Check 'no default gateway' 'FAIL' ("default routes: " + (($gw4 + $gw6 | ForEach-Object { "$($_.NextHop) on $($_.InterfaceAlias)" }) -join ', ')) }

    $dns = @(Get-DnsClientServerAddress -ErrorAction SilentlyContinue | Where-Object { $_.ServerAddresses -and $_.ServerAddresses.Count -gt 0 -and $_.InterfaceAlias -notmatch 'Loopback' })
    if ($dns.Count -eq 0) { Add-Check 'no DNS servers' 'PASS' 'none configured' } else { Add-Check 'no DNS servers' 'FAIL' (($dns | ForEach-Object { "$($_.InterfaceAlias): $($_.ServerAddresses -join ' ')" }) -join '; ') }

    $resolved = $false
    try { [void][Net.Dns]::GetHostAddresses('www.microsoft.com'); $resolved = $true } catch { }
    if (-not $resolved) { Add-Check 'DNS resolution fails' 'PASS' 'www.microsoft.com did not resolve' } else { Add-Check 'DNS resolution fails' 'FAIL' 'www.microsoft.com resolved' }

    $outside = @()
    foreach ($t in @(@('1.1.1.1', 443), @('8.8.8.8', 53), @('13.107.4.52', 80), @('192.168.0.1', 80), @('192.168.1.1', 80), @('10.0.0.1', 80))) {
        if (Test-TcpReachable $t[0] $t[1] 1500) { $outside += ("{0}:{1}" -f $t[0], $t[1]) }
        if (Test-Ping $t[0]) { $outside += ("ping {0}" -f $t[0]) }
    }
    if ($outside.Count -eq 0) { Add-Check 'internet and LAN unreachable' 'PASS' 'no reply from 1.1.1.1, 8.8.8.8, 13.107.4.52, 192.168.0.1, 192.168.1.1, 10.0.0.1' } else { Add-Check 'internet and LAN unreachable' 'FAIL' ("reachable: " + ($outside -join ', ')) }

    if (Test-Ping $s.network.hostAddress) { Add-Check 'host-only host reachable' 'PASS' "ping $($s.network.hostAddress)" }
    elseif (Test-TcpReachable $s.network.hostAddress $s.ports.central 1500) { Add-Check 'host-only host reachable' 'PASS' "tcp $($s.network.hostAddress):$($s.ports.central)" }
    else { Add-Check 'host-only host reachable' 'WARN' "no ping/tcp reply from $($s.network.hostAddress) (host firewall may block ICMP; central may not be running)" }

    try {
        $mp = Get-MpComputerStatus
        if ($mp.AntivirusEnabled -and $mp.RealTimeProtectionEnabled) { Add-Check 'Defender on' 'PASS' ("real-time on, signatures {0}" -f $mp.AntivirusSignatureVersion) } else { Add-Check 'Defender on' 'FAIL' ("AntivirusEnabled={0} RealTimeProtectionEnabled={1}" -f $mp.AntivirusEnabled, $mp.RealTimeProtectionEnabled) }
    } catch { Add-Check 'Defender on' 'FAIL' ("Get-MpComputerStatus failed: " + $_.Exception.Message) }

    $shares = $false
    try { $shares = Test-Path -LiteralPath '\\vmware-host\Shared Folders' -ErrorAction SilentlyContinue } catch { }
    $netDrives = @(Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | Where-Object { $_.DisplayRoot -like '\\*' })
    if (-not $shares -and $netDrives.Count -eq 0) { Add-Check 'no shared folders / network drives' 'PASS' 'none visible' } else { Add-Check 'no shared folders / network drives' 'FAIL' 'VMware shared folders or mapped network drives are visible' }

    $proxy = (netsh winhttp show proxy) -join ' '
    if ($proxy -match 'Direct access') { Add-Check 'no WinHTTP proxy' 'PASS' 'direct' } else { Add-Check 'no WinHTTP proxy' 'WARN' $proxy.Trim() }

    return ,$results
}

function Assert-RlbIsolation {
    $r = Test-RlbIsolation
    $fails = @($r | Where-Object { $_.Status -eq 'FAIL' })
    if ($fails.Count -gt 0) {
        $r | Format-Table -AutoSize | Out-String | Write-Host
        throw 'Isolation check failed; refusing to continue (scripts\00-Test-Isolation.ps1 shows details).'
    }
    Write-Host 'Isolation check passed.' -ForegroundColor Green
}

function Get-PidFromFile([string]$Name) {
    $f = Join-Path (Get-RlbPaths).Run $Name
    if (-not (Test-Path -LiteralPath $f)) { return $null }
    $id = [int](Get-Content -Raw -LiteralPath $f).Trim()
    $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($proc) { return $proc }
    return $null
}

function Write-RlbFileNoBom([string]$Path, [string]$Text) {
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}

function Protect-SecretsDir {
    $dir = (Get-RlbPaths).Secrets
    # Owner account + SYSTEM + Administrators only; no inheritance.
    & icacls.exe $dir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null
}

function Get-SecretValues {
    # Values to redact from exported logs.
    $dir = (Get-RlbPaths).Secrets
    $vals = @()
    if (Test-Path -LiteralPath $dir) {
        foreach ($f in Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue) {
            if ($f.Extension -eq '.pfx') { continue }
            $v = (Get-Content -Raw -LiteralPath $f.FullName).Trim()
            if ($v.Length -ge 8) { $vals += $v }
        }
    }
    return $vals
}
