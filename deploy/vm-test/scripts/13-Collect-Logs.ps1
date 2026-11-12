<#
.SYNOPSIS
  VM only. Gathers logs and captures into C:\RLB\export\<time>-<phase>\ and (with -ToExportVolume) copies that folder
  to the export disk (label RLB_EXPORT), which the host later maps READ-ONLY (host\Read-VmExport.ps1).
  Contents: our logs, server output_log.txt / logs / cfg (secrets redacted), the list of files the server
  created or changed versus the test baseline, captures (.pcapng/.pml), a fresh isolation report, network and
  process snapshots, Defender detections and its event log, and MANIFEST.sha256. Secret files are never copied;
  every secret value is replaced by [REDACTED] in text files. Dry run unless -Apply.
#>
param([switch]$Apply, [ValidatePattern('^P[0-9]$')][string]$Phase = 'P0', [switch]$ToExportVolume)
. (Join-Path $PSScriptRoot '_Common.ps1')
Assert-NotHost
$p = Get-RlbPaths
$s = Get-RlbSettings
$name = "{0}-{1}" -f (Get-Stamp), $Phase
$out = Join-Path $p.Export $name
$steps = @(
    "Create $out",
    'Copy C:\RLB\logs, C:\RLB\captures, server output_log.txt, rust_server_Data\logs and cfg (text only), patcher log',
    'Diff the test copy against test-baseline.csv (files the server created/changed)',
    'Snapshot isolation report, ipconfig, routes, listening ports, processes, Defender detections + event log',
    'Redact every secret value; write MANIFEST.sha256'
)
if ($ToExportVolume) { $steps += "Copy the folder to the RLB_EXPORT disk (\exports\$name)" }
Write-Plan "Collect logs and captures ($Phase)" $steps
Confirm-OrExit $Apply.IsPresent 'Apply'
New-RlbDirs
foreach ($d in @('logs', 'captures', 'server', 'system')) { New-Item -ItemType Directory -Path (Join-Path $out $d) -Force | Out-Null }

& robocopy.exe $p.Logs (Join-Path $out 'logs') /E /NFL /NDL /NJH /NJS /NP | Out-Null
& robocopy.exe $p.Captures (Join-Path $out 'captures') /E /NFL /NDL /NJH /NJS /NP | Out-Null
foreach ($f in @('gateway-cert.cer', 'gateway-cert.sha256.txt')) { $src = Join-Path $p.Export $f; if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination $out } }

if (Test-Path -LiteralPath $p.TestCopy) {
    $data = Join-Path $p.TestCopy 'rust_server_Data'
    $srvOut = Join-Path $out 'server'
    if (Test-Path -LiteralPath (Join-Path $data 'output_log.txt')) { Copy-Item -LiteralPath (Join-Path $data 'output_log.txt') -Destination $srvOut }
    foreach ($sub in @('logs', 'cfg')) { if (Test-Path -LiteralPath (Join-Path $data $sub)) { & robocopy.exe (Join-Path $data $sub) (Join-Path $srvOut "rust_server_Data-$sub") /E /NFL /NDL /NJH /NJS /NP | Out-Null } }
    Copy-Item -LiteralPath (Join-Path $p.TestCopy 'cfg\server.cfg') -Destination (Join-Path $srvOut 'server.cfg') -ErrorAction SilentlyContinue
    $baselineFile = Join-Path $p.Manifests 'test-baseline.csv'
    if (Test-Path -LiteralPath $baselineFile) {
        $base = @{}; foreach ($r in Import-Csv -LiteralPath $baselineFile) { $base[$r.Path] = $r.Sha256 }
        $changes = foreach ($f in Get-ChildItem -LiteralPath $p.TestCopy -Recurse -File) {
            $rel = $f.FullName.Substring($p.TestCopy.Length + 1)
            if (-not $base.ContainsKey($rel)) { [pscustomobject]@{ Change = 'added'; Path = $rel; Bytes = $f.Length } }
            elseif ($f.Length -lt 512MB -and (Get-Sha256 $f.FullName) -ne $base[$rel]) { [pscustomobject]@{ Change = 'changed'; Path = $rel; Bytes = $f.Length } }
        }
        $now = @{}; foreach ($f in Get-ChildItem -LiteralPath $p.TestCopy -Recurse -File) { $now[$f.FullName.Substring($p.TestCopy.Length + 1)] = 1 }
        $changes = @($changes) + @($base.Keys | Where-Object { -not $now.ContainsKey($_) } | ForEach-Object { [pscustomobject]@{ Change = 'deleted'; Path = $_; Bytes = 0 } })
        $changes | Export-Csv -NoTypeInformation -LiteralPath (Join-Path $srvOut 'test-copy-changes.csv')
    }
}
$sys = Join-Path $out 'system'
Test-RlbIsolation | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $sys 'isolation.json')
ipconfig /all | Set-Content -LiteralPath (Join-Path $sys 'ipconfig.txt')
route print | Set-Content -LiteralPath (Join-Path $sys 'routes.txt')
Get-NetTCPConnection -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, State, OwningProcess | Export-Csv -NoTypeInformation -LiteralPath (Join-Path $sys 'tcp.csv')
Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort, OwningProcess | Export-Csv -NoTypeInformation -LiteralPath (Join-Path $sys 'udp.csv')
Get-Process | Select-Object Id, ProcessName, Path, StartTime | Export-Csv -NoTypeInformation -LiteralPath (Join-Path $sys 'processes.csv')
try { Get-MpThreatDetection | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $sys 'defender-detections.json') } catch { 'none' | Set-Content -LiteralPath (Join-Path $sys 'defender-detections.json') }
& wevtutil.exe epl 'Microsoft-Windows-Windows Defender/Operational' (Join-Path $sys 'defender-operational.evtx') 2>$null
& wevtutil.exe epl 'Microsoft-Windows-Windows Firewall With Advanced Security/Firewall' (Join-Path $sys 'firewall.evtx') 2>$null

# Redact secrets from text files (never copy C:\RLB\secrets itself).
$secretValues = Get-SecretValues
foreach ($f in Get-ChildItem -LiteralPath $out -Recurse -File | Where-Object { $_.Extension -in @('.log', '.txt', '.cfg', '.json', '.csv') }) {
    $t = [IO.File]::ReadAllText($f.FullName)
    $orig = $t
    foreach ($v in $secretValues) { $t = $t.Replace($v, '[REDACTED]') }
    $t = [regex]::Replace($t, '(?im)^(\s*PluginKeyHex\s*=\s*)\S+', '$1[REDACTED]')
    $t = [regex]::Replace($t, '(?im)^(\s*rcon\.password\s+)".*"', '$1"[REDACTED]"')
    if ($t -ne $orig) { Write-RlbFileNoBom $f.FullName $t }
}
$lines = foreach ($f in Get-ChildItem -LiteralPath $out -Recurse -File) { '{0} *{1}' -f (Get-Sha256 $f.FullName).ToLowerInvariant(), $f.FullName.Substring($out.Length + 1).Replace('\', '/') }
Write-RlbFileNoBom (Join-Path $out 'MANIFEST.sha256') (($lines -join "`n") + "`n")
Write-Host "Collected into $out" -ForegroundColor Green

if ($ToExportVolume) {
    $vol = Find-RlbVolume $s.vm.exportVolumeLabel
    if (-not $vol) { throw "Export disk (label $($s.vm.exportVolumeLabel)) not found; see 01-Configure-Guest.ps1 -InitializeExportDisk." }
    $dest = Join-Path $vol "exports\$name"
    & robocopy.exe $out $dest /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy to the export disk failed ($LASTEXITCODE)" }
    Write-Host "Copied to $dest. Shut the VM down before mapping the export disk read-only on the host." -ForegroundColor Green
}
