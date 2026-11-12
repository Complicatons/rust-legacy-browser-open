<#
.SYNOPSIS
  ON THE AZURE TEST VM. Installs a kit update tar made by deploy\azure-test\pc\Publish-Kit.ps1 (our code and recovered
  assets only, never original binaries):
    - downloads blob -Name from the kit container into C:\RLB-host\run\ (curl, short-lived read SAS -ContainerSasUrl,
      which is never printed or saved) and refuses unless its SHA-256 is -Sha256,
    - refuses entries outside the app folder and, unless -WithCentral, central's own files (tools/central.mjs,
      central/, site/): the VM keeps the central it was set up with,
    - copies every file the tar replaces to C:\RLB-host\run\kit-backup-<time>\ (roll back by copying it over app\),
    - unpacks into C:\RLB-kit\app,
    - unless -NoRestart: restarts gateway + sidecar (15, then 14 detached) and central (detached, log
      C:\RLB-host\logs\central.log) so the new code loads. The original server is not touched.
  Elevated PowerShell (Cloud Shell Run Command runs as SYSTEM). Dry run unless -Apply.
#>
param([string]$ContainerSasUrl, [string]$Name, [string]$Sha256, [string]$App = 'C:\RLB-kit\app', [switch]$WithCentral, [switch]$NoRestart, [switch]$Apply)
. (Join-Path $PSScriptRoot '..\..\host-test\scripts\_Common.ps1')
$p = Get-RlbPaths
$s = Get-RlbSettings
$stamp = Get-Stamp
$tar = Join-Path $p.Run $Name
$backup = Join-Path $p.Run "kit-backup-$stamp"
$container = if ($ContainerSasUrl) { ($ContainerSasUrl -split '\?')[0] } else { '<container>' }
$steps = @("Download $container/$Name -> $tar (SAS not shown); refuse unless SHA-256 is $Sha256",
    "Refuse entries outside $App$(if (-not $WithCentral) { ' or in tools/central.mjs, central/, site/' })",
    "Copy the files it replaces to $backup, then unpack into $App")
if (-not $NoRestart) { $steps += 'Restart gateway + sidecar (15-Stop-Bridge, 14-Start-Bridge detached) and central (detached); wait for TCP 8080 and 28443' }
Write-Plan 'Install a kit update' $steps
Confirm-OrExit $Apply.IsPresent 'Apply'
Assert-Admin
if (-not $ContainerSasUrl -or $ContainerSasUrl -notmatch '^https://[a-z0-9]+\.blob\.core\.windows\.net/[a-z0-9-]+\?.*sig=') { throw '-ContainerSasUrl must be an https container SAS URL.' }
if ($Name -notmatch '^[A-Za-z0-9._-]+\.tar$') { throw "-Name $Name must be a plain .tar blob name." }
if ($Sha256 -notmatch '^[0-9a-fA-F]{64}$') { throw '-Sha256 must be 64 hex digits.' }
New-RlbDirs

$u = ($ContainerSasUrl -split '\?', 2)
& curl.exe -fsS --retry 3 -o $tar ($u[0] + '/' + $Name + '?' + $u[1])
if ($LASTEXITCODE) { throw "Download failed (curl $LASTEXITCODE)." }
$h = (Get-Sha256 $tar).ToLowerInvariant()
if ($h -ne $Sha256.ToLowerInvariant()) { Remove-Item -LiteralPath $tar; throw "SHA-256 $h, expected $Sha256; deleted the download." }
Write-Host "Downloaded $Name ($((Get-Item -LiteralPath $tar).Length) bytes), hash OK."

$entries = @(& tar.exe -tf $tar | Where-Object { $_ -and -not $_.EndsWith('/') })
if ($LASTEXITCODE) { throw "tar could not list $tar." }
$bad = @($entries | Where-Object { $_ -match '(^|[\\/])\.\.([\\/]|$)' -or $_ -match '^([A-Za-z]:|[\\/])' })
if (-not $WithCentral) { $bad += @($entries | Where-Object { $_ -eq 'tools/central.mjs' -or $_ -match '^(central|site)/' }) }
if ($bad.Count) { throw ("Refusing the update; it contains: " + (($bad | Select-Object -First 10) -join ', ')) }

$replaced = 0
foreach ($e in $entries) {
    $src = Join-Path $App $e
    if (Test-Path -LiteralPath $src -PathType Leaf) {
        $dst = Join-Path $backup $e
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
        Copy-Item -LiteralPath $src -Destination $dst
        $replaced++
    }
}
& tar.exe -xf $tar -C $App
if ($LASTEXITCODE) { throw "tar failed to unpack ($LASTEXITCODE); the replaced files are in $backup." }
Write-Host "Unpacked $($entries.Count) files ($replaced replaced, backed up in $backup)." -ForegroundColor Green
if ($NoRestart) { exit 0 }

$scripts = Join-Path $App 'deploy\host-test\scripts'
& (Join-Path $scripts '15-Stop-Bridge.ps1') -Apply | Out-String | Write-Host
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$scripts\14-Start-Bridge.ps1`" -Apply"; CurrentDirectory = $scripts }
Write-Host "start bridge: return $($r.ReturnValue) pid $($r.ProcessId)"
# Central serves the game through tools/serve.mjs, loaded once at start: restart it to pick up the new one.
# Central may not be running (e.g. after a VM restart): no listener must not stop the script (strict mode).
$listener = Get-NetTCPConnection -State Listen -LocalPort $s.ports.central -ErrorAction SilentlyContinue | Select-Object -First 1
$owner = if ($listener) { $listener.OwningProcess } else { $null }
if ($owner) { Stop-Process -Id $owner -Force; Write-Host "stopped central pid $owner"; Start-Sleep -Seconds 2 }
$cmd = 'cmd.exe /c ""' + (Get-NodeExe) + '" tools\central.mjs run "' + (Join-Path $p.Central 'central.json') + '" >> "' + (Join-Path $p.Logs 'central.log') + '" 2>&1"'
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd; CurrentDirectory = $App }
Write-Host "start central: return $($r.ReturnValue) pid $($r.ProcessId)"
$deadline = (Get-Date).AddSeconds(240)
while ((Get-Date) -lt $deadline -and -not (@(Get-NetTCPConnection -State Listen -LocalPort $s.ports.gateway -ErrorAction SilentlyContinue).Count -and @(Get-NetTCPConnection -State Listen -LocalPort $s.ports.central -ErrorAction SilentlyContinue).Count)) { Start-Sleep -Seconds 2 }
foreach ($port in @($s.ports.central, $s.ports.sidecar, $s.ports.gateway)) { Write-Host ("tcp {0} listening: {1}" -f $port, [bool]@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue).Count) }
