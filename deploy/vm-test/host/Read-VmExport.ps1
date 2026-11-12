<#
.SYNOPSIS
  HOST. One-way export path out of the VM. Without -Source it prints how to map the VM's export disk READ-ONLY.
  With -Source <mapped drive or folder> (e.g. Z:\exports) it copies every export folder into a quarantine folder
  (%USERPROFILE%\RLB-vm-exports), skipping and reporting anything executable or script-like, verifies each
  MANIFEST.sha256, marks the copies read-only and scans them with Microsoft Defender (MpCmdRun custom scan).
  Nothing from the export is opened or executed.
#>
param([string]$Source, [switch]$Apply)
. (Join-Path $PSScriptRoot '_HostCommon.ps1')
$s = Get-RlbSettings
$quarantine = Expand-RlbPath $s.host.exportQuarantine
if (-not $Source) {
    Write-Host @"
How to read the VM export disk (one-way, read-only):
  1. In the VM: 13-Collect-Logs.ps1 -Apply -Phase Pn -ToExportVolume, then shut the VM down (Start > Shut down).
  2. VMware Workstation: File > Map Virtual Disks... > Map > browse to the export disk (.vmdk, e.g. rlb-export.vmdk),
     keep "Open file in read-only mode" TICKED, pick a drive letter (e.g. Z:).
  3. Run: .\Read-VmExport.ps1 -Source Z:\exports -Apply
  4. Disconnect the mapping (Map Virtual Disks > Disconnect) before powering the VM on again.
Quarantine folder: $quarantine
"@
    $vm = @((Join-Path ${env:ProgramFiles(x86)} 'VMware\VMware Workstation\vmware-mount.exe'), (Join-Path $env:ProgramFiles 'VMware\VMware Workstation\vmware-mount.exe')) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($vm) { Write-Host "Command-line alternative found: `"$vm`" Z: <export.vmdk> /r   (read-only)  and later  `"$vm`" Z: /d" }
    exit 0
}
Write-Plan 'Import VM exports into quarantine' @(
    "Copy each folder under $Source to $quarantine\<name> (executables/scripts are NOT copied, only listed)",
    'Verify MANIFEST.sha256 for each export and mark the copies read-only',
    'Scan the quarantine copy with Microsoft Defender (MpCmdRun -Scan -ScanType 3)'
)
Confirm-OrExit $Apply.IsPresent 'Apply'
if (-not (Test-Path -LiteralPath $Source)) { throw "$Source not found (is the export disk mapped?)." }
if (-not (Test-Path -LiteralPath $quarantine)) { New-Item -ItemType Directory -Path $quarantine | Out-Null }
$blocked = '\.(exe|dll|sys|scr|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|lnk|msi|msp|jar|reg|cpl|iso|vhd|vhdx|zip|7z|rar)$'
$okExt = '\.(log|txt|json|csv|cfg|pcapng|pcap|pml|evtx|cer|sha256)$'
foreach ($dir in Get-ChildItem -LiteralPath $Source -Directory) {
    $dest = Join-Path $quarantine $dir.Name
    if (Test-Path -LiteralPath $dest) { Write-Host "skip $($dir.Name): already imported"; continue }
    New-Item -ItemType Directory -Path $dest | Out-Null
    $skipped = @()
    foreach ($f in Get-ChildItem -LiteralPath $dir.FullName -Recurse -File -Force) {
        $rel = $f.FullName.Substring($dir.FullName.Length + 1)
        if ($f.Name -match $blocked -or $f.Name -notmatch $okExt) { $skipped += $rel; continue }
        $t = Join-Path $dest $rel
        New-Item -ItemType Directory -Path (Split-Path -Parent $t) -Force | Out-Null
        Copy-Item -LiteralPath $f.FullName -Destination $t
    }
    $man = Join-Path $dest 'MANIFEST.sha256'
    $bad = 0; $checked = 0
    if (Test-Path -LiteralPath $man) {
        foreach ($line in Get-Content -LiteralPath $man) {
            if ($line -notmatch '^([0-9a-f]{64}) \*(.+)$') { continue }
            $rel = $Matches[2]; $h = $Matches[1].ToUpperInvariant()
            $t = Join-Path $dest ($rel -replace '/', '\')
            if (-not (Test-Path -LiteralPath $t)) { continue }
            $checked++; if ((Get-Sha256 $t) -ne $h) { $bad++; Write-Host "MISMATCH $rel" -ForegroundColor Red }
        }
    } else { Write-Host "$($dir.Name): no MANIFEST.sha256" -ForegroundColor Yellow }
    Get-ChildItem -LiteralPath $dest -Recurse -File | ForEach-Object { $_.IsReadOnly = $true }
    if ($skipped.Count) { Set-Content -LiteralPath (Join-Path $dest '_SKIPPED-not-imported.txt') -Value $skipped; Write-Host ("{0}: {1} non-data files NOT imported (listed in _SKIPPED-not-imported.txt)" -f $dir.Name, $skipped.Count) -ForegroundColor Yellow }
    Write-Host ("{0}: imported, {1} manifest entries checked, {2} mismatches" -f $dir.Name, $checked, $bad)
}
$mp = Join-Path $env:ProgramFiles 'Windows Defender\MpCmdRun.exe'
if (Test-Path -LiteralPath $mp) { & $mp -Scan -ScanType 3 -File $quarantine; Write-Host "Defender scan exit code $LASTEXITCODE (0 = no threats)." } else { Write-Host 'MpCmdRun.exe not found; scan the quarantine folder manually.' -ForegroundColor Yellow }
