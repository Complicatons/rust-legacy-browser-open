<#
.SYNOPSIS
  After a run (server stopped): stops Process Monitor, saves its log as CSV and writes a plain report of what the
  server did, to C:\RLB-host\export\<time>\:
    - summary.txt: files created/written/deleted/renamed OUTSIDE the test copy, registry values written, every
      network operation that was not to 127.0.0.1, processes started, DLLs loaded from outside Windows and the test
      copy; then the firewall's dropped packets during the run and the test-copy changes against the baseline;
    - procmon-rust_server.csv (only the server's own events and its child processes),
    - output_log.txt, LumaEmu logs, pfirewall-run.log, test-copy-changes.csv.
  Reads only; our own code. Elevated PowerShell. Dry run unless -Apply.
#>
param([switch]$Apply, [string]$ProcmonExe)
. (Join-Path $PSScriptRoot '_Common.ps1')
$s = Get-RlbSettings
$p = Get-RlbPaths
$procmon = Get-ProcmonExe $ProcmonExe
$out = Join-Path $p.Export (Get-Stamp)
Write-Plan 'Collect the run evidence' @(
    'Refuse while the test server is running',
    "Stop Process Monitor ($procmon /Terminate) and convert its backing file to CSV",
    "Filter the CSV to rust_server.exe and its child processes; write $out\procmon-rust_server.csv",
    "Write $out\summary.txt (outside writes, registry writes, network, processes, DLL loads, firewall drops, test-copy changes)",
    "Copy output_log.txt, LumaEmu logs and the run's lines of pfirewall.log into $out"
)
Confirm-OrExit $Apply.IsPresent 'Apply'
Assert-Admin
if (Get-PidFromFile 'server.pid') { throw 'The test server is still running; stop it with 06-Stop-Server.ps1 first.' }
New-Item -ItemType Directory -Path $out -Force | Out-Null
$started = if (Test-Path -LiteralPath (Join-Path $p.Run 'server.started')) { [datetime]::ParseExact((Get-Content -Raw -LiteralPath (Join-Path $p.Run 'server.started')).Trim(), 'yyyyMMdd-HHmmss', $null) } else { (Get-Date).AddHours(-12) }
$report = New-Object System.Collections.Generic.List[string]
function Add-Section([string]$Title, $Lines) { $report.Add(''); $report.Add("== $Title =="); $l = @($Lines); if ($l.Count) { foreach ($x in $l) { $report.Add("  $x") } } else { $report.Add('  (none)') } }
$report.Add("Rust Legacy host test run, started $started, collected $(Get-Date)")

# Process Monitor
$pmlFile = Join-Path $p.Run 'procmon.pml'
if (Test-Path -LiteralPath $pmlFile) {
    $pml = (Get-Content -Raw -LiteralPath $pmlFile).Trim()
    if (@(Get-Process Procmon, Procmon64 -ErrorAction SilentlyContinue).Count) { & $procmon /Terminate; Start-Sleep -Seconds 5 }
    $csv = Join-Path $out 'procmon-all.csv'
    $conv = Start-Process -FilePath $procmon -ArgumentList @('/Quiet', '/OpenLog', $pml, '/SaveAs', $csv) -PassThru -Wait
    if (-not (Test-Path -LiteralPath $csv)) { throw "Process Monitor did not write $csv (exit $($conv.ExitCode))." }
    $all = Import-Csv -LiteralPath $csv
    $server = @($all | Where-Object { $_.'Process Name' -eq $s.server.exe })
    $pids = @{}; foreach ($e in $server) { $pids[$e.PID] = $true }
    # Children: Process Create events name the child PID in Detail ("PID: 1234, Command line: ...").
    foreach ($e in @($server | Where-Object { $_.Operation -eq 'Process Create' })) { if ($e.Detail -match 'PID: (\d+)') { $pids[$Matches[1]] = $true } }
    $mine = @($all | Where-Object { $pids.ContainsKey($_.PID) })
    $mine | Export-Csv -NoTypeInformation -LiteralPath (Join-Path $out 'procmon-rust_server.csv')
    Remove-Item -LiteralPath $csv
    $test = $p.TestCopy.ToLowerInvariant()
    $isOutside = { param($path) -not $path.ToLowerInvariant().StartsWith($test) }
    $writeOps = 'WriteFile|SetDispositionInformationFile|SetDispositionInformationEx|SetRenameInformationFile|SetRenameInformationEx|SetEndOfFileInformationFile'
    $fileW = @($mine | Where-Object { ($_.Operation -match "^($writeOps)$" -or ($_.Operation -eq 'CreateFile' -and $_.Detail -match 'OpenResult: (Created|Overwritten|Superseded)')) -and $_.Result -eq 'SUCCESS' -and (& $isOutside $_.Path) } | ForEach-Object { "$($_.Operation) $($_.Path)" } | Sort-Object -Unique)
    $regW = @($mine | Where-Object { $_.Operation -match '^(RegSetValue|RegCreateKey|RegDeleteValue|RegDeleteKey|RegRenameKey|RegSetInfoKey)$' -and $_.Result -eq 'SUCCESS' -and -not ($_.Operation -eq 'RegCreateKey' -and $_.Detail -notmatch 'Disposition: REG_CREATED_NEW_KEY') } | ForEach-Object { "$($_.Operation) $($_.Path)" } | Sort-Object -Unique)
    $net = @($mine | Where-Object { $_.Operation -match '^(TCP|UDP) ' -and $_.Path -notmatch '(^|-> ?)(127\.0\.0\.1|localhost|\[::1\])' -and $_.Path -notmatch '^(127\.0\.0\.1|localhost)[:\s]' } | ForEach-Object { "$($_.Operation) $($_.Path) [$($_.Result)]" } | Sort-Object -Unique)
    $procs = @($mine | Where-Object { $_.Operation -eq 'Process Create' } | ForEach-Object { "$($_.Path) | $($_.Detail)" } | Sort-Object -Unique)
    $win = $env:SystemRoot.ToLowerInvariant()
    $dlls = @($mine | Where-Object { $_.Operation -eq 'Load Image' -and (& $isOutside $_.Path) -and -not $_.Path.ToLowerInvariant().StartsWith($win) } | ForEach-Object { $_.Path } | Sort-Object -Unique)
    $report.Add("Process Monitor: $($all.Count) events captured, $($mine.Count) from the server and its children (PIDs $(@($pids.Keys) -join ', '))")
    Add-Section 'Files created/written/deleted/renamed outside the test copy' $fileW
    Add-Section 'Registry keys created / values written or deleted' $regW
    Add-Section 'Network operations not to 127.0.0.1 (should be none: firewall + offline settings)' $net
    Add-Section 'Processes started' $procs
    Add-Section 'DLLs loaded from outside Windows and the test copy' $dlls
} else { $report.Add('Process Monitor: no recording for this run (05-Start-Server.ps1 -NoProcmon?)') }

# Firewall drops during the run
$fwLog = Join-Path $env:SystemRoot 'System32\LogFiles\Firewall\pfirewall.log'
if (Test-Path -LiteralPath $fwLog) {
    $drops = @(Get-Content -LiteralPath $fwLog | Where-Object { $_ -match '^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) DROP ' -and [datetime]$Matches[1] -ge $started })
    $drops | Set-Content -LiteralPath (Join-Path $out 'pfirewall-run.log')
    Add-Section "Firewall dropped packets since the start ($($drops.Count); all programs, see pfirewall-run.log)" ($drops | Select-Object -First 40)
}

# Test copy against the baseline
$baseFile = Join-Path $p.Manifests 'test-baseline.csv'
if (Test-Path -LiteralPath $baseFile) {
    $base = @{}; foreach ($r in Import-Csv -LiteralPath $baseFile) { $base[$r.Path] = $r }
    $now = @{}; foreach ($f in Get-ChildItem -LiteralPath $p.TestCopy -Recurse -File) { $now[$f.FullName.Substring($p.TestCopy.Length + 1)] = $f }
    $changes = New-Object System.Collections.Generic.List[object]
    foreach ($k in $now.Keys) { if (-not $base.ContainsKey($k)) { $changes.Add([pscustomobject]@{ Change = 'added'; Path = $k }) } elseif ((Get-Sha256 $now[$k].FullName) -ne $base[$k].Sha256) { $changes.Add([pscustomobject]@{ Change = 'modified'; Path = $k }) } }
    foreach ($k in $base.Keys) { if (-not $now.ContainsKey($k)) { $changes.Add([pscustomobject]@{ Change = 'deleted'; Path = $k }) } }
    $changes | Sort-Object Path | Export-Csv -NoTypeInformation -LiteralPath (Join-Path $out 'test-copy-changes.csv')
    Add-Section 'Test copy changes against the baseline' ($changes | Sort-Object Path | ForEach-Object { "$($_.Change) $($_.Path)" })
}

foreach ($f in @('rust_server_Data\output_log.txt', 'LumaEmu.log', 'LumaEmu_Steamclient.log')) {
    $src = Join-Path $p.TestCopy $f
    if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $out (Split-Path -Leaf $f)) }
}
$rcon = Join-Path $p.Secrets 'rcon.password'
$secret = if (Test-Path -LiteralPath $rcon) { (Get-Content -Raw -LiteralPath $rcon).Trim() } else { $null }
$text = ($report -join "`r`n")
if ($secret) { $text = $text.Replace($secret, '<rcon password>') }
Set-Content -LiteralPath (Join-Path $out 'summary.txt') -Value $text
foreach ($f in Get-ChildItem -LiteralPath $out -File) { if ($secret) { $c = [IO.File]::ReadAllText($f.FullName); if ($c.Contains($secret)) { [IO.File]::WriteAllText($f.FullName, $c.Replace($secret, '<rcon password>')) } } }
Remove-Item -LiteralPath $pmlFile -ErrorAction SilentlyContinue
Write-Host $text
Write-Host ''
Write-Host "Evidence in $out" -ForegroundColor Green
