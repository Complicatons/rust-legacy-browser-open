<#
.SYNOPSIS
  Installs the Rust Legacy game loader (DESKTOP-LAUNCHER-PLAN.md) for the current Windows user from the folder this
  script is in (build\launcher\app from tools/build-launcher.mjs: RustLegacyLauncher.exe, web\, proxy\, launcher.json):
    1. checks the Microsoft Edge WebView2 Runtime and the .NET 8 Desktop Runtime are installed (a self-contained build
       needs no .NET), and stops with the download links when one is missing,
    2. copies the loader to -InstallDir (default %LOCALAPPDATA%\Programs\RustLegacyLauncher),
    3. adds a Start menu shortcut (and a desktop one with -DesktopShortcut),
    4. lists it in Settings > Apps for this user, with Uninstall-RustLegacyLauncher.ps1 as its uninstaller.
  No administrator rights: nothing outside this user's profile is changed, no service, no driver. The loader never
  downloads or changes the game: it starts the player's own copy through a launch profile under
  %LOCALAPPDATA%\RustLegacyLauncher\profile, which the uninstaller removes.
  Normal (not elevated) PowerShell. Dry run unless -Apply. Uninstall-RustLegacyLauncher.ps1 undoes it.
#>
param([string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\RustLegacyLauncher'), [switch]$DesktopShortcut, [switch]$Apply)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$kit = $PSScriptRoot
$exeName = 'RustLegacyLauncher.exe'
$exe = Join-Path $InstallDir $exeName
# The user's Start menu Programs and Desktop folders. GetFolderPath answers "" when the folder does not exist yet (a new
# profile, or an account that never signed in interactively); then the folder Windows would use is named instead.
function Get-UserFolder([string]$Name, [string]$Fallback) { $d = [Environment]::GetFolderPath($Name); if ($d) { $d } else { $Fallback } }
$programsDir = Get-UserFolder 'Programs' (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')
$desktopDir = Get-UserFolder 'DesktopDirectory' (Join-Path $env:USERPROFILE 'Desktop')
$startMenu = Join-Path $programsDir 'Rust Legacy Launcher.lnk'
$desktop = Join-Path $desktopDir 'Rust Legacy Launcher.lnk'
$appsKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\RustLegacyLauncher'

# Microsoft's documented WebView2 Runtime check: the EdgeUpdate client key's "pv" (version) value, per machine (64- or
# 32-bit view) or per user. Edge itself does not count; the Evergreen Runtime ships with Windows 11 and most Windows 10.
function Get-WebView2Version {
    $client = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    foreach ($k in @("HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$client", "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$client", "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$client")) {
        $pv = (Get-ItemProperty -LiteralPath $k -Name pv -ErrorAction SilentlyContinue)
        if ($pv -and $pv.pv -and $pv.pv -ne '0.0.0.0') { return $pv.pv }
    }
    return $null
}
# The x64 .NET 8 Windows Desktop Runtime (WinForms), from the shared framework folder dotnet itself uses.
function Get-DesktopRuntime8 {
    $root = Join-Path $env:ProgramFiles 'dotnet\shared\Microsoft.WindowsDesktop.App'
    if (-not (Test-Path -LiteralPath $root)) { return $null }
    $v = Get-ChildItem -LiteralPath $root -Directory | Where-Object { $_.Name -like '8.*' } | Sort-Object Name | Select-Object -Last 1
    if ($v) { return $v.Name } else { return $null }
}

$selfContained = Test-Path -LiteralPath (Join-Path $kit 'coreclr.dll')
$webView2 = Get-WebView2Version
$dotnet = if ($selfContained) { 'bundled (self-contained build)' } else { Get-DesktopRuntime8 }
$missing = @()
if (-not $webView2) { $missing += 'Microsoft Edge WebView2 Runtime: https://go.microsoft.com/fwlink/p/?LinkId=2124703' }
if (-not $dotnet) { $missing += '.NET 8 Desktop Runtime (x64): https://dotnet.microsoft.com/download/dotnet/8.0 (".NET Desktop Runtime 8")' }

Write-Host ''
Write-Host '== Install the Rust Legacy game loader ==' -ForegroundColor Cyan
Write-Host "  WebView2 Runtime:     $(if ($webView2) { $webView2 } else { 'MISSING' })"
Write-Host "  .NET Desktop Runtime: $(if ($dotnet) { $dotnet } else { 'MISSING' })"
Write-Host 'This script will:'
$steps = @(
    "Copy $kit to $InstallDir (for $env:USERNAME only)",
    "Add the Start menu shortcut $startMenu$(if ($DesktopShortcut) { " and the desktop shortcut $desktop" })",
    "List 'Rust Legacy Launcher' in Settings > Apps for this user (uninstall runs $InstallDir\Uninstall-RustLegacyLauncher.ps1)")
$i = 1; foreach ($s in $steps) { Write-Host ("  {0}. {1}" -f $i, $s); $i++ }
Write-Host ''
if ($missing.Count -gt 0) {
    Write-Host '  !! Install these first (free, from Microsoft), then run this script again:' -ForegroundColor Yellow
    foreach ($m in $missing) { Write-Host "     - $m" -ForegroundColor Yellow }
    Write-Host ''
}
if (-not $Apply) { Write-Host 'Dry run only. Nothing was changed. Re-run with -Apply to perform the steps above.' -ForegroundColor Yellow; exit 0 }
if ($missing.Count -gt 0) { throw 'A required Microsoft runtime is missing (listed above). Nothing was changed.' }
foreach ($need in @($exeName, 'web\ui\index.html', 'web\core.mjs', 'proxy\steam_api.dll', 'Uninstall-RustLegacyLauncher.ps1')) { if (-not (Test-Path -LiteralPath (Join-Path $kit $need))) { throw "The loader folder is incomplete: $need is missing next to this script." } }
$running = Get-Process -Name 'RustLegacyLauncher' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like "$InstallDir\*" }
if ($running) { throw 'The loader is running. Quit it from its tray icon, then run this script again.' }
if (Test-Path -LiteralPath (Join-Path $InstallDir 'rust.exe')) { throw "$InstallDir holds the game. Give the loader a folder of its own (the default is fine)." }

# 1. Files. Each folder of the kit (web\, proxy\, runtimes\) replaces the installed one as a whole, so nothing from an
#    older version is left behind. The install folder holds only our files (the launch profile lives elsewhere).
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
foreach ($item in (Get-ChildItem -LiteralPath $kit | Where-Object { $_.Name -ne 'Install-RustLegacyLauncher.ps1' })) {
    $target = Join-Path $InstallDir $item.Name
    if ($item.PSIsContainer -and (Test-Path -LiteralPath $target)) { Remove-Item -Recurse -Force -LiteralPath $target }
    Copy-Item -Recurse -Force -LiteralPath $item.FullName -Destination $InstallDir
}
# 2. Shortcuts
$shell = New-Object -ComObject WScript.Shell
$links = @($startMenu); if ($DesktopShortcut) { $links += $desktop }
foreach ($l in $links) {
    $s = $shell.CreateShortcut($l)
    $s.TargetPath = $exe; $s.WorkingDirectory = $InstallDir; $s.IconLocation = "$exe,0"
    $s.Description = 'Sign in with your Rust Legacy account and play'
    $s.Save()
}
# 3. Settings > Apps entry (per user: HKCU, no administrator rights)
$version = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
$uninstall = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$InstallDir\Uninstall-RustLegacyLauncher.ps1`" -InstallDir `"$InstallDir`" -Apply"
New-Item -Force -Path $appsKey | Out-Null
$entry = [ordered]@{ DisplayName = 'Rust Legacy Launcher'; DisplayVersion = "$version"; Publisher = 'Rust Legacy'; InstallLocation = $InstallDir; DisplayIcon = "$exe,0"; UninstallString = $uninstall }
foreach ($k in $entry.Keys) { New-ItemProperty -Force -Path $appsKey -Name $k -Value $entry[$k] -PropertyType String | Out-Null }
foreach ($k in @('NoModify', 'NoRepair')) { New-ItemProperty -Force -Path $appsKey -Name $k -Value 1 -PropertyType DWord | Out-Null }
Write-Host "Installed. Start it from the Start menu: Rust Legacy Launcher ($exe)." -ForegroundColor Green
