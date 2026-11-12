<#
.SYNOPSIS
  Removes what Install-RustLegacyHost.ps1 added: closes the desktop app (the server is not affected by that), removes
  its Start menu and desktop shortcuts and its start-at-sign-in entry, stops and deletes the RustLegacyHost service (the
  service stops every part it started; parts started by the deploy\host-test scripts keep running), with -RestoreServer
  first puts an attached server's own files back (undoes Setup's "browser ready": the patched Assembly-CSharp.dll or our
  Oxide plugin), removes the installed apps list entry, takes the service account's rights off the attached server folder
  and the -ScriptsRoot folders, and deletes -InstallDir. The data folder (settings, owner token, secrets, logs, backups,
  updates) is kept unless -RemoveData; when it is kept, the owner token goes back to administrators only.
  Elevated PowerShell. Dry run unless -Apply. RustLegacyHostSetup.exe /uninstall (Settings, Apps) runs this script.
#>
param([string]$InstallDir = (Join-Path $env:ProgramFiles 'Rust Legacy Host'), [string]$DataDir = (Join-Path $env:ProgramData 'Rust Legacy Host'),
    [string]$ScriptsRoot = 'C:\RLB-host', [switch]$RestoreServer, [switch]$RemoveData, [switch]$Apply)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$service = 'RustLegacyHost'
$account = "NT SERVICE\$service"
$token = Join-Path $DataDir 'owner.token'
$config = Join-Path $DataDir 'host.json'
$node = Join-Path $InstallDir 'node\node.exe'
$links = @((Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'Rust Legacy Host.lnk'), (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Rust Legacy Host.lnk'))
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
# An attached server (host\setup.mjs): host.json's server folder outside the scripts layout.
$serverDir = $null
if (Test-Path -LiteralPath $config) { try { $h = Get-Content -Raw -LiteralPath $config | ConvertFrom-Json; if ($h.components.PSObject.Properties['server'] -and $h.components.server.kind -eq 'original' -and -not $h.PSObject.Properties['scripts']) { $serverDir = $h.components.server.dir } } catch { } }
$attached = Test-Path -LiteralPath (Join-Path $DataDir 'attach\attach.json')
Write-Host ''
Write-Host '== Uninstall the Rust Legacy host app ==' -ForegroundColor Cyan
Write-Host 'This script will:'
$steps = @("Close the desktop app if it is open, and remove its shortcuts and its start-at-sign-in entry for $env:USERNAME",
    "Stop and delete the Windows service $service",
    $(if ($RestoreServer -and $attached) { "Put your server's own files back (undo browser ready)" } elseif ($attached) { 'Leave your server browser ready (add -RestoreServer to put its own files back)' } else { 'Leave your server folder as it is (the host app did not change it)' }),
    "Remove ${account}'s rights from $(if ($serverDir) { "$serverDir, " })$ScriptsRoot\config, \secrets, \central, \logs, \run, \data and the server copy",
    "Remove the Windows Firewall rules in group 'Rust Legacy Host', the installed apps list entry and $account's right to run RLB-OriginalServer-AtBoot", "Delete $InstallDir",
    $(if ($RemoveData) { "Delete $DataDir (settings, owner token, secrets, logs, backups, updates)" } else { "Keep $DataDir (add -RemoveData to delete it); $token goes back to administrators only" }))
$i = 1; foreach ($s in $steps) { Write-Host ("  {0}. {1}" -f $i, $s); $i++ }
Write-Host ''
if (-not $Apply) { Write-Host 'Dry run only. Nothing was changed. Re-run with -Apply to perform the steps above.' -ForegroundColor Yellow; exit 0 }
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this script from an elevated PowerShell (Run as administrator).' }
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
# 1. The desktop app: a window over the service, so closing it loses nothing (its shells end with it).
Get-Process -Name 'RustLegacyHost' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like "$InstallDir\*" } | Stop-Process -Force
foreach ($l in $links) { if (Test-Path -LiteralPath $l) { Remove-Item -Force -LiteralPath $l; Write-Host "Removed $l." } }
if (Get-ItemProperty -LiteralPath $runKey -Name 'RustLegacyHost' -ErrorAction SilentlyContinue) { Remove-ItemProperty -LiteralPath $runKey -Name 'RustLegacyHost' }
# 2. Service
if (Get-Service -Name $service -ErrorAction SilentlyContinue) {
    Stop-Service -Name $service -ErrorAction SilentlyContinue
    try { (Get-Service -Name $service).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60)) } catch { }
    & sc.exe delete $service | Out-Null
    Write-Host "Service $service removed."
}
# 3. Before node is deleted: the app's own undo of browser ready (host\setup.mjs undo).
if ($RestoreServer -and $attached -and (Test-Path -LiteralPath $node)) {
    $out = & $node (Join-Path $InstallDir 'app\host\setup.mjs') 'undo' $config
    if ($LASTEXITCODE -ne 0) { Write-Host "Could not put the server's files back: $out" -ForegroundColor Yellow } else { Write-Host 'Server files put back.' }
}
if ($serverDir -and (Test-Path -LiteralPath $serverDir)) { & icacls.exe $serverDir /remove:g $account | Out-Null }
foreach ($d in @('config', 'secrets', 'central', 'logs', 'run', 'data')) { $p = Join-Path $ScriptsRoot $d; if (Test-Path -LiteralPath $p) { & icacls.exe $p /remove:g $account | Out-Null } }
Get-NetFirewallRule -Group 'Rust Legacy Host' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Remove-Item -Force -ErrorAction SilentlyContinue -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$service"
$sched = New-Object -ComObject Schedule.Service; $sched.Connect()
$bootTask = try { $sched.GetFolder('\').GetTask('RLB-OriginalServer-AtBoot') } catch { $null }
$sid = try { (New-Object Security.Principal.NTAccount($account)).Translate([Security.Principal.SecurityIdentifier]).Value } catch { $null }
if ($bootTask -and $sid) { $sd = $bootTask.GetSecurityDescriptor(4); $kept = $sd -replace [regex]::Escape("(A;;FRFX;;;$sid)"), ''; if ($kept -ne $sd) { $bootTask.SetSecurityDescriptor($kept, 0) } }
$keys = Join-Path $ScriptsRoot 'central\keys'
if (Test-Path -LiteralPath $keys) { foreach ($k in Get-ChildItem -LiteralPath $keys -Filter 'signing-*.pem') { & icacls.exe $k.FullName /remove:g $account | Out-Null } }
foreach ($d in @('server', 'server\test', 'server\test\rust_server_Data', 'server\test\cfg', 'server\test\rust_server_Data\cfg', 'server\test\rust_server_Data\userdata', 'server\test\oxide', 'server\test\save')) { $p = Join-Path $ScriptsRoot $d; if (Test-Path -LiteralPath $p) { & icacls.exe $p /remove:g $account | Out-Null } }
# RustLegacyHostSetup.exe /uninstall runs from a copy in %TEMP%, so nothing in the folder is in use here.
if (Test-Path -LiteralPath $InstallDir) {
    Remove-TreeSafely $InstallDir
    if (Test-Path -LiteralPath $InstallDir) { Write-Host "Some files in $InstallDir are in use; delete the folder after a restart." -ForegroundColor Yellow } else { Write-Host "Deleted $InstallDir." }
}
if ($RemoveData -and (Test-Path -LiteralPath $DataDir)) { Remove-TreeSafely $DataDir; Write-Host "Deleted $DataDir." }
elseif (Test-Path -LiteralPath $token) { & icacls.exe $token /reset | Out-Null } # back to the folder's own rights (administrators and SYSTEM)
Write-Host 'Done.' -ForegroundColor Green
