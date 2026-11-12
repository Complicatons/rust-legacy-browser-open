<#
.SYNOPSIS
  Removes what Install-RustLegacyLauncher.ps1 added for this Windows user:
    1. the launch profile (%LOCALAPPDATA%\RustLegacyLauncher\profile), by the loader's own `--remove-profile`, which
       never follows its folder links into the game and never deletes through its file links: the player's game folder
       is left exactly as it was,
    2. the Start menu and desktop shortcuts and the Settings > Apps entry,
    3. -InstallDir (default %LOCALAPPDATA%\Programs\RustLegacyLauncher).
  The loader's own data (%LOCALAPPDATA%\RustLegacyLauncher: settings with the website address, game folder and the
  remembered login name; the "keep me signed in" token sealed for this user; the window's cache) is kept unless
  -RemoveData. Signing out in the loader first also ends the session on the website.
  Normal (not elevated) PowerShell. Dry run unless -Apply.
#>
param([string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\RustLegacyLauncher'), [switch]$RemoveData, [switch]$Apply)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$exe = Join-Path $InstallDir 'RustLegacyLauncher.exe'
$dataDir = Join-Path $env:LOCALAPPDATA 'RustLegacyLauncher'
$profileDir = Join-Path $dataDir 'profile'
# The user's Start menu Programs and Desktop folders. GetFolderPath answers "" when the folder does not exist yet (a new
# profile, or an account that never signed in interactively); then the folder Windows would use is named instead.
function Get-UserFolder([string]$Name, [string]$Fallback) { $d = [Environment]::GetFolderPath($Name); if ($d) { $d } else { $Fallback } }
$programsDir = Get-UserFolder 'Programs' (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')
$desktopDir = Get-UserFolder 'DesktopDirectory' (Join-Path $env:USERPROFILE 'Desktop')
$links = @((Join-Path $programsDir 'Rust Legacy Launcher.lnk'), (Join-Path $desktopDir 'Rust Legacy Launcher.lnk'))
$appsKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\RustLegacyLauncher'
Write-Host ''
Write-Host '== Uninstall the Rust Legacy game loader ==' -ForegroundColor Cyan
Write-Host 'This script will:'
$steps = @("Remove the launch profile $profileDir with `"$exe --remove-profile`" (your game folder is not touched)",
    'Remove the Start menu and desktop shortcuts and the Settings > Apps entry', "Delete $InstallDir",
    $(if ($RemoveData) { "Delete $dataDir (settings, remembered login name, saved sign-in, window cache)" } else { "Keep $dataDir (add -RemoveData to delete it)" }))
$i = 1; foreach ($s in $steps) { Write-Host ("  {0}. {1}" -f $i, $s); $i++ }
Write-Host ''
if (-not $Apply) { Write-Host 'Dry run only. Nothing was changed. Re-run with -Apply to perform the steps above.' -ForegroundColor Yellow; exit 0 }
if (Get-Process -Name 'RustLegacyLauncher' -ErrorAction SilentlyContinue) { throw 'The loader is running. Quit it from its tray icon (and close the game), then run this script again.' }

# 1. Launch profile: only the loader removes it. PowerShell's own recursive delete is never pointed at it, because the
#    profile holds junctions into the player's game folder.
if (Test-Path -LiteralPath $profileDir) {
    if (-not (Test-Path -LiteralPath $exe)) { throw "$exe is missing, so the launch profile cannot be removed safely. Reinstall the loader, then uninstall again." }
    $p = Start-Process -FilePath $exe -ArgumentList '--remove-profile' -Wait -PassThru -WindowStyle Hidden
    if ($p.ExitCode -ne 0 -or (Test-Path -LiteralPath $profileDir)) { throw "The loader could not remove $profileDir (exit code $($p.ExitCode)). Nothing else was changed." }
    Write-Host "Removed the launch profile $profileDir."
}
# 2. Shortcuts and the Settings > Apps entry
foreach ($l in $links) { if (Test-Path -LiteralPath $l) { Remove-Item -Force -LiteralPath $l; Write-Host "Removed $l." } }
if (Test-Path -LiteralPath $appsKey) { Remove-Item -Recurse -Force -LiteralPath $appsKey }
# 3. Program files (this script may be one of them: it is already loaded, and we step out of the folder first)
Set-Location -LiteralPath $env:TEMP
if (Test-Path -LiteralPath $InstallDir) { Remove-Item -Recurse -Force -LiteralPath $InstallDir; Write-Host "Deleted $InstallDir." }
# 4. Data, only when asked, and only once the profile (the one part with links into the game) is gone.
if ($RemoveData -and (Test-Path -LiteralPath $dataDir)) {
    if (Test-Path -LiteralPath $profileDir) { throw "$profileDir is still there; $dataDir was kept." }
    Remove-Item -Recurse -Force -LiteralPath $dataDir; Write-Host "Deleted $dataDir."
}
Write-Host 'Done.' -ForegroundColor Green
