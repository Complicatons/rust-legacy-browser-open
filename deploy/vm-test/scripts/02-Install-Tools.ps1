<#
.SYNOPSIS
  VM only (elevated). Copies our code/configs from the tools ISO to C:\RLB\app, installs Node.js LTS from the ISO's
  installers slot (official MSI, Authenticode signature checked first), and unpacks Sysinternals tools if present.
  Wireshark/Npcap are installed by hand (interactive installers; tick Npcap "loopback support").
  Nothing here is an original game binary. Dry run unless -Apply.
#>
param([switch]$Apply)
. (Join-Path $PSScriptRoot '_Common.ps1')
Assert-NotHost
$media = Find-ToolsMedia
$p = Get-RlbPaths
$installers = Join-Path $media 'installers'
$nodeMsi = @(Get-ChildItem -LiteralPath $installers -Filter 'node-v*-x64.msi' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1)
$sysZips = @(Get-ChildItem -LiteralPath $installers -Filter '*.zip' -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Procmon|TCPView|SysinternalsSuite|ProcessMonitor' })

$steps = @(
    "Verify the tools ISO manifest ($media`MANIFEST.sha256)",
    "Mirror $media`app into $($p.App) (our gateway/sidecar code, recovered data, configs, adapter build output)"
)
if ($nodeMsi.Count) { $steps += "Check the Authenticode signature of $($nodeMsi[0].Name) and install it silently (msiexec /qn)" } else { $steps += 'No Node.js MSI in the installers slot: install Node LTS by hand before 10-Enrol-Gateway.ps1' }
foreach ($z in $sysZips) { $steps += "Unpack $($z.Name) into $($p.Tools)\sysinternals (signature of each exe checked)" }
$steps += 'Leave Wireshark/Npcap to the owner (interactive installers in the same slot)'
Write-Plan 'Install our tools in the VM' $steps
Confirm-OrExit $Apply.IsPresent 'Apply'
Assert-Admin
New-RlbDirs

# Manifest check: every file listed must match.
$manifest = Join-Path $media 'MANIFEST.sha256'
if (-not (Test-Path -LiteralPath $manifest)) { throw "No MANIFEST.sha256 on the tools media." }
$bad = 0
foreach ($line in Get-Content -LiteralPath $manifest) {
    if ($line -notmatch '^([0-9a-fA-F]{64}) \*(.+)$') { continue }
    $f = Join-Path $media ($Matches[2] -replace '/', '\')
    if (-not (Test-Path -LiteralPath $f) -or (Get-Sha256 $f) -ne $Matches[1].ToUpperInvariant()) { Write-Host "MISMATCH $($Matches[2])" -ForegroundColor Red; $bad++ }
}
if ($bad) { throw "$bad files on the tools media do not match MANIFEST.sha256." }
Write-Host 'Tools media manifest verified.' -ForegroundColor Green

& robocopy.exe (Join-Path $media 'app') $p.App /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
Copy-Item -LiteralPath (Join-Path $media 'README.txt') -Destination (Join-Path $p.App 'README.txt') -Force

if ($nodeMsi.Count) {
    $sig = Get-AuthenticodeSignature -LiteralPath $nodeMsi[0].FullName
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'OpenJS Foundation') { throw "Node MSI signature is not a valid OpenJS Foundation signature ($($sig.Status), $($sig.SignerCertificate.Subject))." }
    $log = Join-Path $p.Logs ("node-install-{0}.log" -f (Get-Stamp))
    $proc = Start-Process msiexec.exe -ArgumentList @('/i', ('"{0}"' -f $nodeMsi[0].FullName), '/qn', '/norestart', '/l*v', ('"{0}"' -f $log)) -Wait -PassThru
    if ($proc.ExitCode -ne 0) { throw "Node install failed ($($proc.ExitCode)); see $log" }
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    Write-Host ("Node installed: " + (& (Get-NodeExe) --version))
}
foreach ($z in $sysZips) {
    $dest = Join-Path $p.Tools 'sysinternals'
    Expand-Archive -LiteralPath $z.FullName -DestinationPath $dest -Force
}
foreach ($exe in @(Get-ChildItem -LiteralPath (Join-Path $p.Tools 'sysinternals') -Filter '*.exe' -ErrorAction SilentlyContinue)) {
    $sig = Get-AuthenticodeSignature -LiteralPath $exe.FullName
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'Microsoft') { Remove-Item -LiteralPath $exe.FullName -Force; Write-Host "Removed $($exe.Name): not validly signed by Microsoft" -ForegroundColor Red }
}
Write-Host 'Tools installed. Next: 03-New-Secrets.ps1.' -ForegroundColor Green
