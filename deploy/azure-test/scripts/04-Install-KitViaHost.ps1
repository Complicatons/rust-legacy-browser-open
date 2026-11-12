<#
.SYNOPSIS
  ON THE AZURE TEST VM, when Rust Legacy Host runs there as a service. Installs a kit update tar from
  deploy\azure-test\pc\Publish-Kit.ps1 so that the service keeps running everything:
    1. 03-Install-KitUpdate.ps1 -NoRestart: downloads the tar (short-lived read SAS, never printed), checks its
       SHA-256, backs up and unpacks into -Kit (C:\RLB-kit\app): the scripts the boot task runs (05, 06, 10) and
       build\vm-test\adapter for 10-Patch stay current,
    2. unpacks the same tar into the service's own app folder with the service's Node and tools\kit-install.mjs
       (same refusals as 03; every replaced file backed up to C:\RLB-host\run\host-backup-<time>). This script runs as
       an administrator: the service account itself only reads its app folder, so a bug in the internet-facing website
       or gateway cannot rewrite the code they run from,
    3. asks the service (tools\host-control.mjs, loopback API, owner token) to restart only the running parts the
       update touched: central (browser\ and the website's game files), sidecar, gateway; they stay the service's own
       children, so its crash recovery keeps watching them. Host files changed: the whole service restarts instead,
    4. only when the adapter changed: stops the original server through the service (save, then quit; 06 if that does
       not end it), restores the original Assembly-CSharp.dll, runs 10-Patch-TestCopy.ps1 -Apply, and starts it again
       through the service (the boot task: 05-Start-Server.ps1 with every lock-down check). Otherwise the original
       server keeps running,
    5. on any failure in 3 or 4, puts the service's app folder back (kit-install rollback) and restarts the same parts.
  -SkipKit: step 1 already ran (03-Install-KitUpdate.ps1 -NoRestart, as the auto-deploy does first so that this
  script is in the kit folder); the downloaded tar in C:\RLB-host\run\ is checked against -Sha256 again.
  Exit 3 when the service is not installed or not running: use 03-Install-KitUpdate.ps1 as before.
  Elevated PowerShell (Cloud Shell Run Command runs as SYSTEM). Dry run unless -Apply.
#>
param([string]$ContainerSasUrl, [string]$Name, [string]$Sha256, [string]$Kit = 'C:\RLB-kit\app',
    [string]$HostDir = 'C:\Program Files\Rust Legacy Host', [string]$DataDir = 'C:\ProgramData\Rust Legacy Host', [switch]$SkipKit, [switch]$Apply)
. (Join-Path $PSScriptRoot '..\..\host-test\scripts\_Common.ps1')
$p = Get-RlbPaths
$stamp = Get-Stamp
$service = 'RustLegacyHost'
$app = Join-Path $HostDir 'app'
$node = Join-Path $HostDir 'node\node.exe'
$backup = Join-Path $p.Run "host-backup-$stamp"
$tar = Join-Path $p.Run $Name
Write-Plan 'Install a kit update through Rust Legacy Host' @(
    $(if ($SkipKit) { "Check $tar against SHA-256 $Sha256 (03 -NoRestart already unpacked it into $Kit)" } else { "03-Install-KitUpdate.ps1 -NoRestart: download, check SHA-256 $Sha256, back up and unpack into $Kit" }),
    "Unpack the same tar into $app (backup $backup)",
    'Restart, through the service, only the running parts the update touched (the whole service if host\ changed)',
    'Adapter changed only: stop the server through the service (save first), restore Assembly-CSharp.dll, 10-Patch-TestCopy -Apply, start it through the service',
    'On failure: roll the service app folder back and restart the same parts')
Confirm-OrExit $Apply.IsPresent 'Apply'
Assert-Admin
$svc = Get-Service -Name $service -ErrorAction SilentlyContinue
if (-not $svc -or $svc.Status -ne 'Running') { Write-Host "$service is not installed or not running; use 03-Install-KitUpdate.ps1." -ForegroundColor Yellow; exit 3 }
if (-not (Test-Path -LiteralPath $node)) { throw "Missing $node (not a Rust Legacy Host install)." }
# The two tools come from the kit folder 03 has just updated, so the first install also works on a host that is
# older than tools\host-control.mjs.
$kitInstall = Join-Path $Kit 'tools\kit-install.mjs'
$hostControl = Join-Path $Kit 'tools\host-control.mjs'

# Node writes its messages to stderr; judge it by the exit code (PowerShell 5.1 would turn stderr into an error).
function Invoke-Node([string[]]$NodeArgs) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = & $node @NodeArgs 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $old }
    $out | ForEach-Object { Write-Host "  $_" }
    if ($LASTEXITCODE) { throw "node $($NodeArgs[0]) $($NodeArgs[1]) failed: $(($out | Select-Object -Last 1))" }
    $out
}
function Host-Control([string[]]$HcArgs) { Invoke-Node (@($hostControl) + $HcArgs + @('--data', $DataDir)) }

# 1. Kit folder (download, hash, refusals, backup, unpack): unchanged 03.
if ($SkipKit) {
    if ($Name -notmatch '^[A-Za-z0-9._-]+\.tar$' -or $Sha256 -notmatch '^[0-9a-fA-F]{64}$') { throw '-Name must be a plain .tar name and -Sha256 64 hex digits.' }
    if (-not (Test-Path -LiteralPath $tar)) { throw "Missing ${tar}; run 03-Install-KitUpdate.ps1 -NoRestart first, or leave out -SkipKit." }
    if ((Get-Sha256 $tar).ToLowerInvariant() -ne $Sha256.ToLowerInvariant()) { throw "$tar does not match SHA-256 $Sha256." }
} else {
    & (Join-Path $PSScriptRoot '03-Install-KitUpdate.ps1') -Apply -NoRestart -ContainerSasUrl $ContainerSasUrl -Name $Name -Sha256 $Sha256 -App $Kit
    if ($LASTEXITCODE) { throw "03-Install-KitUpdate.ps1 failed ($LASTEXITCODE)." }
}
foreach ($f in @($kitInstall, $hostControl)) { if (-not (Test-Path -LiteralPath $f)) { throw "Missing $f after unpacking: the kit is older than this script." } }

# 2. The service's app folder. Only the files whose bytes changed decide what restarts (a full kit carries every file).
Invoke-Node @($kitInstall, 'apply', $tar, '--app', $app, '--backup', $backup) | Out-Null
$parts = @((Get-Content -Raw -LiteralPath (Join-Path $backup 'install.json') | ConvertFrom-Json).changedParts)
Write-Host "Parts changed: $(if ($parts.Count) { $parts -join ', ' } else { 'none' })"

function Restart-Parts([string[]]$Touched) {
    if ($Touched -contains 'host') {
        # The service's own code: restart it; it starts its parts again and adopts the server from server.pid.
        Restart-Service -Name $service
        $deadline = (Get-Date).AddSeconds(120)
        do { Start-Sleep -Seconds 3; $ok = $true; try { Host-Control @('status') | Out-Null } catch { $ok = $false } } until ($ok -or (Get-Date) -gt $deadline)
        if (-not $ok) { throw "$service did not answer within 120 s after its restart." }
    }
    $status = Host-Control @('status')
    foreach ($n in @('central', 'sidecar', 'gateway')) {
        if ($Touched -notcontains $n -and $Touched -notcontains 'host') { continue }
        $line = $status | Where-Object { $_ -like "${n}: *" } | Select-Object -First 1
        if (-not $line) { continue }  # not a part of this host
        if ($Touched -contains 'host' -and $line -like "${n}: running*" -and $line -notlike '*started outside the host*') { continue }  # already started fresh by the service
        if ($line -like "${n}: running*") { Host-Control @('restart', $n) | Out-Null } else { Write-Host "  $n was not running ($line); left as it is." }
    }
}
function Restore-ServerAdapter {
    $m = Join-Path $p.TestCopy 'rust_server_Data\Managed'
    Copy-Item -LiteralPath "$m\Assembly-CSharp.dll.rlb-original" -Destination "$m\Assembly-CSharp.dll" -Force
    & (Join-Path $Kit 'deploy\host-test\scripts\10-Patch-TestCopy.ps1') -Apply -AllowStaleAdapter | Out-String | Write-Host
}

try {
    Restart-Parts $parts
    if ($parts -contains 'server-adapter') {
        $stopped = $true
        try { Host-Control @('stop', 'server', '--timeout', '120') | Out-Null } catch { $stopped = $false; Write-Host "  The service could not stop the server ($($_.Exception.Message)); 06-Stop-Server.ps1 ends it." -ForegroundColor Yellow }
        if (-not $stopped) { & (Join-Path $Kit 'deploy\host-test\scripts\06-Stop-Server.ps1') -Apply | Out-String | Write-Host }
        Restore-ServerAdapter
        Host-Control @('start', 'server', '--timeout', '300') | Out-Null
    }
} catch {
    Write-Host "FAILED: $($_.Exception.Message); rolling the service app folder back." -ForegroundColor Red
    Invoke-Node @($kitInstall, 'rollback', $backup, '--app', $app) | Out-Null
    try { Restart-Parts $parts } catch { Write-Host "  restart after the roll back failed too: $($_.Exception.Message)" -ForegroundColor Red }
    throw
}
Write-Host "Installed $Name through $service." -ForegroundColor Green
Host-Control @('status') | Out-Null
