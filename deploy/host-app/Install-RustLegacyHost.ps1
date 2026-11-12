<#
.SYNOPSIS
  Installs or updates the Rust Legacy host app (HOST-APP-PLAN.md "Installer", "Owner installer") from the kit folder this
  script is in (tools/build-host-installer.mjs): app\, node\node.exe, service\RustLegacyHostService.exe,
  desktop\RustLegacyHost.exe. RustLegacyHostSetup.exe runs this script for owners; it also works on its own.
    1. copies the kit to -InstallDir (default C:\Program Files\Rust Legacy Host); when the service already exists it is
       stopped first and started again afterwards (an update keeps host.json, secrets, logs and backups),
    2. creates the data folder -DataDir (default C:\ProgramData\Rust Legacy Host): logs, backups, owner token, secrets,
    3. writes host.json there unless one exists or -HostConfig gives one: the deploy\host-test layout under -ScriptsRoot
       when it exists (scripts and app share run state), otherwise `node host\setup.mjs init` with -ServerDir as an
       existing server attached as it is (Setup's "An existing server", finished on the dashboard),
    4. registers the Windows service RustLegacyHost (automatic start, restarts on failure) under its own virtual account
       NT SERVICE\RustLegacyHost: no password, not an administrator, cannot sign in,
    5. lets that account read -ScriptsRoot\config and \secrets and write \logs, \run, \data (the gateway, sidecar and
       website it runs need their keys), change -DataDir, and change -ServerDir (an attached server: its saves, logs and
       our adapter),
    6. firewall (rule group "Rust Legacy Host"): copies the system node.exe's inbound allow rules for the kit's node.exe;
       -OpenGateway lets the kit's node.exe accept TCP from outside (the gateway browsers join); -BlockServerOutbound
       stops -ServerDir\rust_server.exe reaching the internet (a stock server never needs to),
    7. adds Rust Legacy Host to the installed apps list (uninstall through RustLegacyHostSetup.exe when -SetupExe gave it),
    8. starts the service,
    9. the desktop app (HOST-AND-LOADER-BUILD.md A1): lets -AppUser (default: the account running this script) read
       <DataDir>\owner.token, and only that file in the data folder, so the app signs that account in by itself; writes
       desktop\RustLegacyHost.json (data folder and port); adds the Start menu shortcut, a desktop one with
       -DesktopShortcut, and with -StartAtSignIn starts the app in the tray when this account signs in to Windows. A kit
       without the app gets a Start menu shortcut to RustLegacyHostSetup.exe /dashboard (the dashboard in a browser).
  The service runs our code only. It never starts the original server by itself: host.json kind "original" still needs
  your confirmation (HOST-APP-PLAN.md). The dashboard listens on 127.0.0.1 only. The desktop app is a window over the
  service: it needs the .NET 8 Desktop Runtime and the WebView2 Runtime (both from Microsoft, checked below); without
  them the service works the same and the dashboard opens in a browser.
  Elevated PowerShell. Dry run unless -Apply. Uninstall-RustLegacyHost.ps1 undoes it.
#>
param([string]$InstallDir = (Join-Path $env:ProgramFiles 'Rust Legacy Host'), [string]$DataDir = (Join-Path $env:ProgramData 'Rust Legacy Host'),
    [string]$ScriptsRoot = 'C:\RLB-host', [string]$HostConfig, [int]$Port = 28100,
    [string]$ServerDir, [switch]$AcceptServerBuild, [string]$Website = 'https://your-domain.example/', [switch]$OpenGateway, [switch]$BlockServerOutbound, [string]$SetupExe,
    [string]$AppUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name, [switch]$DesktopShortcut, [switch]$StartAtSignIn, [switch]$Apply)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$kit = $PSScriptRoot
$service = 'RustLegacyHost'
$account = "NT SERVICE\$service"
$exe = Join-Path $InstallDir 'service\RustLegacyHostService.exe'
$config = Join-Path $DataDir 'host.json'
$token = Join-Path $DataDir 'owner.token'
$shared = Test-Path -LiteralPath (Join-Path $ScriptsRoot 'config')
$existing = [bool](Get-Service -Name $service -ErrorAction SilentlyContinue)
$version = if (Test-Path -LiteralPath (Join-Path $kit 'version.txt')) { (Get-Content -Raw -LiteralPath (Join-Path $kit 'version.txt')).Trim() } else { '0.0.0' }
$hasApp = Test-Path -LiteralPath (Join-Path $kit 'desktop\RustLegacyHost.exe')
$appExe = Join-Path $InstallDir 'desktop\RustLegacyHost.exe'
$setupCopy = Join-Path $InstallDir 'RustLegacyHostSetup.exe'
$startMenu = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'Rust Legacy Host.lnk'
$desktopLink = Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Rust Legacy Host.lnk'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$uninstallKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$service"
$fwGroup = 'Rust Legacy Host'

# Microsoft's documented WebView2 Runtime check: the EdgeUpdate client key's "pv" (version) value, per machine (64- or
# 32-bit view) or per user. The Evergreen Runtime ships with Windows 11 and most Windows 10.
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
$webView2 = if ($hasApp) { Get-WebView2Version } else { $null }
$dotnet = if ($hasApp) { Get-DesktopRuntime8 } else { $null }

Write-Host ''
Write-Host "== $(if ($existing) { 'Update' } else { 'Install' }) the Rust Legacy host app $version ==" -ForegroundColor Cyan
if ($hasApp) {
    Write-Host "  WebView2 Runtime:     $(if ($webView2) { $webView2 } else { 'MISSING' })"
    Write-Host "  .NET Desktop Runtime: $(if ($dotnet) { $dotnet } else { 'MISSING' })"
}
Write-Host 'This script will:'
$steps = @(
    "$(if ($existing) { "Stop the service $service, then copy" } else { 'Copy' }) $kit\app, \node, \service$(if ($hasApp) { ', \desktop' }) to $InstallDir$(if ($existing) { ' (your settings and data stay)' })",
    "Create $DataDir (administrators, SYSTEM and the service account only)",
    $(if ($HostConfig) { "Copy $HostConfig to $config" } elseif ($shared -and (Test-Path -LiteralPath $config)) { "Keep the existing $config" } elseif ($shared) { "Write $config for the scripts' layout in $ScriptsRoot (shared run state)" } elseif ($ServerDir) { "Write $config with your server in $ServerDir, attached as it is (finish on the Setup page)" } elseif (Test-Path -LiteralPath $config) { "Keep the existing $config" } else { "Write $config (choose your server on the Setup page)" }),
    $(if ($existing) { "Keep the Windows service $service" } else { "Register the Windows service $service ($exe), automatic start, restart on failure, as $account" }),
    $(if ($shared) { "Let $account read $ScriptsRoot\config, \secrets, the website's signing keys and the server copy, and write \logs, \run, \data and the server's cfg, saves and userdata" } else { "($ScriptsRoot has no config folder: nothing shared with the scripts)" }),
    $(if ($ServerDir) { "Let $account change $ServerDir (saves, logs, our adapter)" } else { '(No server folder given)' }),
    "Let $account run the scheduled task RLB-OriginalServer-AtBoot if it exists (05-Start-Server.ps1 -ViaTask: how the host starts the original server)",
    "Firewall (group '$fwGroup'): copy each inbound allow rule for the system node.exe to $InstallDir\node\node.exe$(if ($OpenGateway) { "; allow incoming TCP to $InstallDir\node\node.exe (the gateway)" })$(if ($BlockServerOutbound -and $ServerDir) { "; block outgoing traffic from $ServerDir\rust_server.exe" })",
    'Add Rust Legacy Host to the installed apps list',
    "Start the service and print the sign-in link for http://127.0.0.1:$Port/")
if ($hasApp) {
    $steps += "Let $AppUser read $token (that file only), so the desktop app signs in by itself"
    $steps += "Add the Start menu shortcut $startMenu$(if ($DesktopShortcut) { " and the desktop shortcut $desktopLink" })"
    if ($StartAtSignIn) { $steps += "Start the app in the tray when $env:USERNAME signs in ($runKey\RustLegacyHost)" }
} elseif ($SetupExe) { $steps += "(This kit has no desktop app.) Add the Start menu shortcut $($startMenu) (the dashboard in a browser, signed in)" }
else { $steps += '(This kit has no desktop app: no shortcuts. The dashboard opens in a browser.)' }
$i = 1; foreach ($s in $steps) { Write-Host ("  {0}. {1}" -f $i, $s); $i++ }
Write-Host ''
Write-Host '  !! This adds a Windows service and changes folder permissions on THIS PC. Uninstall-RustLegacyHost.ps1 undoes it.' -ForegroundColor Yellow
if ($hasApp -and (-not $webView2 -or -not $dotnet)) {
    Write-Host '  !! The desktop app needs these from Microsoft (free); the service and the browser dashboard work without them:' -ForegroundColor Yellow
    if (-not $webView2) { Write-Host '     - Microsoft Edge WebView2 Runtime: https://go.microsoft.com/fwlink/p/?LinkId=2124703' -ForegroundColor Yellow }
    if (-not $dotnet) { Write-Host '     - .NET 8 Desktop Runtime (x64): https://dotnet.microsoft.com/download/dotnet/8.0 (".NET Desktop Runtime 8")' -ForegroundColor Yellow }
}
Write-Host ''
if (-not $Apply) { Write-Host 'Dry run only. Nothing was changed. Re-run with -Apply to perform the steps above.' -ForegroundColor Yellow; exit 0 }
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this script from an elevated PowerShell (Run as administrator).' }
foreach ($need in @('app\host\service.mjs', 'node\node.exe', 'service\RustLegacyHostService.exe')) { if (-not (Test-Path -LiteralPath (Join-Path $kit $need))) { throw "The kit is incomplete: $need is missing next to this script." } }
# Windows PowerShell 5.1's Remove-Item -Recurse can follow a junction or symbolic link inside a folder and empty its
# target (PowerShell issue #621; on the Azure VM app\browser\assets\recovered is a junction to the kit's copy). So every
# link under the folder is removed first, as a link, without going into it; then the folder itself.
function Remove-TreeSafely([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $unlink = {
        param([string]$Dir)
        foreach ($e in [IO.Directory]::GetFileSystemEntries($Dir)) {
            $a = [IO.File]::GetAttributes($e)
            if ($a -band [IO.FileAttributes]::ReparsePoint) { if ($a -band [IO.FileAttributes]::Directory) { [IO.Directory]::Delete($e, $false) } else { [IO.File]::Delete($e) } }
            elseif ($a -band [IO.FileAttributes]::Directory) { & $unlink $e }
        }
    }
    if (([IO.File]::GetAttributes($Path) -band [IO.FileAttributes]::ReparsePoint)) { [IO.Directory]::Delete($Path, $false); return }
    & $unlink $Path
    Remove-Item -Recurse -Force -LiteralPath $Path -ErrorAction SilentlyContinue
}
if ($ServerDir -and -not (Test-Path -LiteralPath (Join-Path $ServerDir 'rust_server.exe'))) { throw "$ServerDir has no rust_server.exe. Choose the folder of your Legacy server." }
if ($hasApp) {
    # The account the app signs in for must exist here (a typo would otherwise fail only after the service is installed).
    try { [void](New-Object Security.Principal.NTAccount($AppUser)).Translate([Security.Principal.SecurityIdentifier]) } catch { throw "-AppUser '$AppUser' is not an account on this PC." }
    if (Get-Process -Name 'RustLegacyHost' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like "$InstallDir\*" }) { throw 'The desktop app is open. Quit it from its tray icon, then run this script again.' }
}

# 1. Files (an update stops the service first: node.exe and the app are in use while it runs)
if ($existing) {
    Write-Host "Stopping $service..."
    Stop-Service -Name $service -ErrorAction SilentlyContinue
    (Get-Service -Name $service).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60))
}
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
foreach ($d in @('app', 'node', 'service', 'desktop')) {
    $src = Join-Path $kit $d; if (-not (Test-Path -LiteralPath $src)) { continue }
    # A new app folder replaces the old one whole (the service's own settings file lives in service\ and is rewritten).
    if ($d -eq 'app' -and (Test-Path -LiteralPath (Join-Path $InstallDir $d))) { Remove-TreeSafely (Join-Path $InstallDir $d) }
    Copy-Item -Recurse -Force -LiteralPath $src -Destination $InstallDir
}
foreach ($f in @('Install-RustLegacyHost.ps1', 'Uninstall-RustLegacyHost.ps1', 'version.txt', 'README.txt')) { $p = Join-Path $kit $f; if (Test-Path -LiteralPath $p) { Copy-Item -Force -LiteralPath $p -Destination $InstallDir } }
if ($SetupExe -and (Test-Path -LiteralPath $SetupExe) -and ((Resolve-Path -LiteralPath $SetupExe).Path -ne $setupCopy)) { Copy-Item -Force -LiteralPath $SetupExe -Destination $setupCopy }
$hostNode = Join-Path $InstallDir 'node\node.exe'
# 2. Data folder, closed to other users
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
& icacls.exe $DataDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
# 3. host.json
if ($HostConfig) { Copy-Item -LiteralPath $HostConfig -Destination $config -Force }
elseif ($shared) {
    if (-not (Test-Path -LiteralPath $config)) {
        $components = [ordered]@{}
        foreach ($c in @(@('central', 'central\central.json'), @('sidecar', 'config\sidecar.json'), @('gateway', 'config\gateway.json'))) {
            $f = Join-Path $ScriptsRoot $c[1]; if (Test-Path -LiteralPath $f) { $components[$c[0]] = @{ config = $f } }
        }
        $test = Join-Path $ScriptsRoot 'server\test'
        if (Test-Path -LiteralPath $test) { $components['server'] = @{ kind = 'original'; dir = $test; confirmRunOriginalBinaries = $false } }
        $h = [ordered]@{ listen = @{ host = '127.0.0.1'; port = $Port }; dataDir = $DataDir; components = $components; watchdog = @{ enabled = $true; hangSeconds = 90; graceSeconds = 300; probeEveryMs = 5000 }; scripts = @{ root = $ScriptsRoot } }
        [IO.File]::WriteAllText($config, ($h | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
    }
}
else {
    # The app's own setup (host\setup.mjs): host.json and secrets, and the server when one was chosen. An existing
    # host.json is kept; -ServerDir points it at that server.
    $initArgs = @((Join-Path $InstallDir 'app\host\setup.mjs'), 'init', $config, '--data', $DataDir, '--port', "$Port", '--website', $Website)
    if ($ServerDir) { $initArgs += @('--server', $ServerDir); if ($AcceptServerBuild) { $initArgs += '--accept' } }
    $out = & $hostNode @initArgs
    if ($LASTEXITCODE -ne 0) { throw "Setting up host.json failed: $out" }
}
$wrapperSettings = [ordered]@{ node = $hostNode; app = (Join-Path $InstallDir 'app'); config = $config; dataDir = $DataDir }
[IO.File]::WriteAllText((Join-Path $InstallDir 'service\RustLegacyHostService.json'), ($wrapperSettings | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
# 4. Service under its own virtual account
if (-not $existing) {
    New-Service -Name $service -BinaryPathName "`"$exe`"" -DisplayName 'Rust Legacy Host' -Description 'Runs your Rust Legacy server with the gateway that lets browser players in, and watches it (dashboard on 127.0.0.1).' -StartupType Automatic | Out-Null
    & sc.exe config $service obj= $account | Out-Null
    & sc.exe failure $service reset= 86400 actions= restart/5000/restart/30000/restart/60000 | Out-Null
}
# 5. Folder rights for the service account (it exists once the service does)
& icacls.exe $DataDir /grant "${account}:(OI)(CI)M" | Out-Null
& icacls.exe (Join-Path $InstallDir 'app') /grant "${account}:(OI)(CI)RX" | Out-Null
if ($ServerDir) { & icacls.exe $ServerDir /grant "${account}:(OI)(CI)M" | Out-Null }
if ($shared) {
    # config and secrets: modify, not just read (owner decision, HOST-AND-LOADER-BUILD.md question 3, 29 Oct 2026) so
    # setup wizard steps 08 (New-Secrets), 09 (New-GatewayCert) and 13 (Enrol-Gateway) can run from the dashboard
    # instead of a pasted administrator line. central stays read-only: its own files (e.g. the signing keys below) are
    # not part of this decision.
    foreach ($d in @('config', 'secrets')) { $p = Join-Path $ScriptsRoot $d; if (Test-Path -LiteralPath $p) { & icacls.exe $p /grant "${account}:(OI)(CI)M" | Out-Null } }
    foreach ($d in @('central')) { $p = Join-Path $ScriptsRoot $d; if (Test-Path -LiteralPath $p) { & icacls.exe $p /grant "${account}:(OI)(CI)RX" | Out-Null } }
    foreach ($d in @('logs', 'run', 'data', 'central', 'manifests')) { $p = Join-Path $ScriptsRoot $d; if (Test-Path -LiteralPath $p) { & icacls.exe $p /grant "${account}:(OI)(CI)M" | Out-Null } }
    # The website's ticket signing keys are written with a protected ACL for the account that made them (central/keys.mjs),
    # so the folder grant above does not reach them: give the service account read on each key file itself.
    $keys = Join-Path $ScriptsRoot 'central\keys'
    if (Test-Path -LiteralPath $keys) { foreach ($k in Get-ChildItem -LiteralPath $keys -Filter 'signing-*.pem') { & icacls.exe $k.FullName /grant "${account}:R" | Out-Null } }
    # The original (02-Prepare-Server.ps1 locks it to administrators and the server account, kept pristine, never run):
    # read only, so step 10 (Patch-TestCopy) can verify its Assembly-CSharp.dll hash from the dashboard — reading that
    # hash cannot itself modify the pristine copy.
    $original = Join-Path $ScriptsRoot 'server\original'
    if (Test-Path -LiteralPath $original) { & icacls.exe $original /grant "${account}:(OI)(CI)RX" | Out-Null }
    # The server copy: read on the copy, so the health check, log tail, watchdog and backups can see it; modify only
    # where the host writes (server.cfg, our adapter's cfg, the save files and userdata, Oxide, and — owner decision,
    # question 3 — rust_server_Data\Managed, so step 10 (Patch-TestCopy) can copy in the adapter DLL and run
    # VanillaPatcher from the dashboard). The rest of the program files stay read-only for it.
    $test = Join-Path $ScriptsRoot 'server\test'
    if (Test-Path -LiteralPath $test) {
        & icacls.exe (Join-Path $ScriptsRoot 'server') /grant "${account}:(RX)" | Out-Null
        & icacls.exe $test /grant "${account}:(OI)(CI)RX" | Out-Null
        $data = Join-Path $test 'rust_server_Data'
        if (Test-Path -LiteralPath $data) { & icacls.exe $data /grant "${account}:(OI)M" | Out-Null } # files here (the saves), not its subfolders
        foreach ($d in @('cfg', 'rust_server_Data\cfg', 'rust_server_Data\userdata', 'rust_server_Data\Managed', 'oxide', 'save')) { $p = Join-Path $test $d; if (Test-Path -LiteralPath $p) { & icacls.exe $p /grant "${account}:(OI)(CI)M" | Out-Null } }
    }
}
# 5a. The original server's boot task (17-Register-ServerTask.ps1 -AtBoot, SYSTEM: 05-Start-Server.ps1 -ViaTask with every
#     lock-down check): the service account may run it, so Start and scheduled restarts can bring the server back
#     (host/config.mjs startViaBootTask). Read and run only; it cannot change the task.
$sched = New-Object -ComObject Schedule.Service; $sched.Connect()
$bootTask = try { $sched.GetFolder('\').GetTask('RLB-OriginalServer-AtBoot') } catch { $null }
if ($bootTask) {
    $sid = (New-Object Security.Principal.NTAccount($account)).Translate([Security.Principal.SecurityIdentifier]).Value
    $sd = $bootTask.GetSecurityDescriptor(4)
    if ($sd -notmatch [regex]::Escape(";$sid)")) { $bootTask.SetSecurityDescriptor($sd + "(A;;FRFX;;;$sid)", 0) }
    Write-Host "$account may run the task RLB-OriginalServer-AtBoot (starts the original server after the lock-down checks)."
}
# 5b. Windows Firewall: the parts now run under this kit's node.exe, not the system Node the scripts' allow rules name
#     (01-Set-AzureConfig.ps1, the game VPS scripts). Each enabled inbound allow rule for the system node.exe is copied
#     for ours, same ports, addresses and profiles, in the rule group "Rust Legacy Host" (removed by the uninstaller).
$sysNode = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if ($sysNode -and $sysNode -ne $hostNode) {
    foreach ($r in @(Get-NetFirewallApplicationFilter | Where-Object { $_.Program -ieq $sysNode } | Get-NetFirewallRule | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' })) {
        $pf = $r | Get-NetFirewallPortFilter; $af = $r | Get-NetFirewallAddressFilter
        if (Get-NetFirewallRule -DisplayName "Rust Legacy Host: $($r.DisplayName)" -ErrorAction SilentlyContinue) { continue }
        New-NetFirewallRule -DisplayName "Rust Legacy Host: $($r.DisplayName)" -Group 'Rust Legacy Host' -Direction Inbound -Action Allow -Program $hostNode -Protocol $pf.Protocol -LocalPort $pf.LocalPort -RemoteAddress $af.RemoteAddress -Profile $r.Profile | Out-Null
        Write-Host "Firewall: allowed $hostNode like `"$($r.DisplayName)`" (TCP $($pf.LocalPort -join ', '))."
    }
}
# 5c. Owner choices from the setup program: the gateway open to browsers, the game server kept offline.
if ($OpenGateway -and -not (Get-NetFirewallRule -DisplayName 'Rust Legacy Host gateway (browser players)' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'Rust Legacy Host gateway (browser players)' -Group $fwGroup -Direction Inbound -Program $hostNode -Protocol TCP -Action Allow | Out-Null
}
if ($BlockServerOutbound -and $ServerDir) {
    Get-NetFirewallRule -DisplayName 'Rust Legacy Host: game server stays offline' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName 'Rust Legacy Host: game server stays offline' -Group $fwGroup -Direction Outbound -Program (Join-Path $ServerDir 'rust_server.exe') -Action Block | Out-Null
}
# 5d. Windows' list of installed apps (Settings, Apps)
New-Item -Force -Path $uninstallKey | Out-Null
$size = [int]((Get-ChildItem -Recurse -File -LiteralPath $InstallDir | Measure-Object Length -Sum).Sum / 1KB)
$entries = [ordered]@{ DisplayName = 'Rust Legacy Host'; DisplayVersion = $version; Publisher = 'Rust Legacy Browser'; InstallLocation = $InstallDir; EstimatedSize = $size; NoModify = 1; NoRepair = 1
    UninstallString = $(if (Test-Path -LiteralPath $setupCopy) { "`"$setupCopy`" /uninstall" } else { "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $InstallDir 'Uninstall-RustLegacyHost.ps1')`" -Apply" }) }
if ($hasApp) { $entries['DisplayIcon'] = $appExe } elseif (Test-Path -LiteralPath $setupCopy) { $entries['DisplayIcon'] = $setupCopy }
foreach ($k in $entries.Keys) { New-ItemProperty -Force -Path $uninstallKey -Name $k -Value $entries[$k] -PropertyType $(if ($entries[$k] -is [int]) { 'DWord' } else { 'String' }) | Out-Null }
# 6. Start
Start-Service -Name $service
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline -and -not (Test-Path -LiteralPath $token)) { Start-Sleep -Seconds 1 }
if (-not (Test-Path -LiteralPath $token)) { Write-Host "The service started but the dashboard is not up yet; see $DataDir\logs\service-*.log" -ForegroundColor Yellow; exit 1 }
# 7. Desktop app (or, without it, a shortcut that opens the dashboard in a browser through the setup program)
$shell = New-Object -ComObject WScript.Shell
if ($hasApp) {
    # Read on the token file only. The folder stays closed: Windows lets every account open a file by its full path
    # without rights on the folders above it ("bypass traverse checking"), so nothing else in the data folder opens up.
    & icacls.exe $token /grant "${AppUser}:R" | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host "Could not let $AppUser read $token; the app will ask for the token instead." -ForegroundColor Yellow }
    $appSettings = [ordered]@{ dataDir = $DataDir; port = $Port; root = $(if (Test-Path -LiteralPath $ScriptsRoot) { $ScriptsRoot } else { $null }); service = $service }
    [IO.File]::WriteAllText((Join-Path $InstallDir 'desktop\RustLegacyHost.json'), ($appSettings | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    $links = @($startMenu); if ($DesktopShortcut) { $links += $desktopLink }
    foreach ($l in $links) {
        $s = $shell.CreateShortcut($l)
        $s.TargetPath = $appExe; $s.WorkingDirectory = (Split-Path -Parent $appExe); $s.IconLocation = "$appExe,0"
        $s.Description = 'Your Rust Legacy server: status, logs, players and a terminal'
        $s.Save()
    }
    if ($StartAtSignIn) { New-ItemProperty -Force -Path $runKey -Name 'RustLegacyHost' -Value "`"$appExe`" --tray" -PropertyType String | Out-Null }
}
elseif (Test-Path -LiteralPath $setupCopy) {
    $s = $shell.CreateShortcut($startMenu); $s.TargetPath = $setupCopy; $s.Arguments = '/dashboard'; $s.Description = 'Open the Rust Legacy Host dashboard'; $s.Save()
}
Write-Host "$(if ($existing) { 'Updated' } else { 'Installed' }). Open this link in your browser to sign in: http://127.0.0.1:$Port/#token=$((Get-Content -Raw -LiteralPath $token).Trim())" -ForegroundColor Green
if ($hasApp) { Write-Host "Or open Rust Legacy Host from the Start menu: it signs $AppUser in by itself." -ForegroundColor Green }
Write-Host "Settings: $config   Logs: $DataDir\logs"
