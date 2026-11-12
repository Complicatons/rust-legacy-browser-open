# Shared helpers for the HOST-side vm-test scripts (Windows PowerShell 5.1 compatible). These run on the host PC and
# never execute original game/server binaries; they run our own Node code, read VMware config files, and use
# Windows/Wireshark/Defender tooling.
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$script:RlbDeployDir = Split-Path -Parent $PSScriptRoot
$script:RlbRepo = (Resolve-Path (Join-Path $script:RlbDeployDir '..\..')).Path
$script:RlbSettings = Get-Content -Raw -LiteralPath (Join-Path $script:RlbDeployDir 'settings.json') | ConvertFrom-Json

function Get-RlbSettings { return $script:RlbSettings }
function Expand-RlbPath([string]$p) { return [Environment]::ExpandEnvironmentVariables($p) }
function Get-HostStateDir { $d = Expand-RlbPath $script:RlbSettings.host.stateDir; if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d | Out-Null }; return $d }
function Get-Stamp { return (Get-Date).ToString('yyyyMMdd-HHmmss') }

function Write-Plan {
    param([string]$Title, [string[]]$Steps)
    Write-Host ''
    Write-Host "== $Title (HOST) ==" -ForegroundColor Cyan
    Write-Host 'This script will:'
    $i = 1; foreach ($s in $Steps) { Write-Host ("  {0}. {1}" -f $i, $s); $i++ }
    Write-Host ''
}
function Confirm-OrExit([bool]$Confirmed, [string]$SwitchName) {
    if (-not $Confirmed) { Write-Host "Dry run only. Nothing was changed. Re-run with -$SwitchName to perform the steps above." -ForegroundColor Yellow; exit 0 }
}
function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this from an elevated PowerShell.' }
}
function Get-NodeExe {
    $n = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $n) { throw 'node.exe not found on PATH.' }
    return $n.Source
}
function Get-HostOnlyAdapter {
    $ip = $script:RlbSettings.network.hostAddress
    $a = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $ip -ErrorAction SilentlyContinue
    if (-not $a) { return $null }
    return $a
}
function Assert-HostOnlyAddress {
    $a = Get-HostOnlyAdapter
    if (-not $a) { throw "No host adapter has $($script:RlbSettings.network.hostAddress). Set VMnet1 to subnet $($script:RlbSettings.network.subnet) in VMware's Virtual Network Editor (RUNBOOK.md P0)." }
    if ($a.InterfaceAlias -notmatch 'VMnet1') { Write-Host "Warning: $($a.IPAddress) is on '$($a.InterfaceAlias)', not the VMware VMnet1 adapter." -ForegroundColor Yellow }
    return $a
}
function Get-Sha256([string]$Path) { return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToUpperInvariant() }
function Find-WiresharkTool([string]$Name) {
    foreach ($d in @((Join-Path $env:ProgramFiles 'Wireshark'), (Join-Path ${env:ProgramFiles(x86)} 'Wireshark'))) { $f = Join-Path $d $Name; if (Test-Path -LiteralPath $f) { return $f } }
    return $null
}
