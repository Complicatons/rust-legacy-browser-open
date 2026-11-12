<#
.SYNOPSIS
  Compact summary of a 20-Watch-Load.ps1 CSV (small enough for Run Command output): per part (server, gateway,
  sidecar, central) CPU % (p50/p95/max of the machine), working set, private bytes and handles first -> last with a
  least-squares slope per hour; machine CPU and free memory; kicks, saves, exceptions, gateway errors and /metrics
  counters first -> last; late rows (watcher/VM paused), packetdrop lines and gateway correction bursts.
  -Buckets <minutes> adds one line per time bucket; -From/-To (UTC HH:mm) limit the window.
#>
param([string]$Tag, [int]$Buckets = 0, [string]$From = '', [string]$To = '', [string]$Root = 'C:\RLB-host')
$root = $Root
$file = if ($Tag) { Join-Path $root "logs\watch-$Tag.csv" } else { (Get-ChildItem (Join-Path $root 'logs') -Filter 'watch-*.csv' | Sort-Object LastWriteTime | Select-Object -Last 1).FullName }
$rows = @(Import-Csv -LiteralPath $file)
if ($From) { $rows = @($rows | Where-Object { $_.time.Substring(11, 5) -ge $From }) }
if ($To) { $rows = @($rows | Where-Object { $_.time.Substring(11, 5) -le $To }) }
"$(Split-Path $file -Leaf): $($rows.Count) rows $($rows[0].time) -> $($rows[-1].time)"
function Num($v) { if ($v -eq $null -or $v -eq '') { $null } else { [double]$v } }
function Pct($vals, $p) { $v = @($vals | Where-Object { $_ -ne $null } | Sort-Object); if (-not $v.Count) { return '-' }; $v[[Math]::Min($v.Count - 1, [Math]::Max(0, [Math]::Ceiling($p / 100 * $v.Count) - 1))] }
function Slope($col) {
    $pts = @(); $t0 = [datetime]$rows[0].time
    foreach ($r in $rows) { $y = Num $r.$col; if ($y -ne $null) { $pts += , @((([datetime]$r.time) - $t0).TotalHours, $y) } }
    if ($pts.Count -lt 3) { return '-' }
    $n = $pts.Count; $sx = ($pts | ForEach-Object { $_[0] } | Measure-Object -Sum).Sum; $sy = ($pts | ForEach-Object { $_[1] } | Measure-Object -Sum).Sum
    $sxx = ($pts | ForEach-Object { $_[0] * $_[0] } | Measure-Object -Sum).Sum; $sxy = ($pts | ForEach-Object { $_[0] * $_[1] } | Measure-Object -Sum).Sum
    $d = $n * $sxx - $sx * $sx; if ($d -eq 0) { return '-' }; [Math]::Round(($n * $sxy - $sx * $sy) / $d, 1)
}
function FirstLast($col) { $v = @($rows | ForEach-Object { Num $_.$col } | Where-Object { $_ -ne $null }); if (-not $v.Count) { return '-' }; "$($v[0])->$($v[-1]) (max $(($v | Measure-Object -Maximum).Maximum))" }
foreach ($k in 'server', 'gateway', 'sidecar', 'central') {
    $cpu = @($rows | ForEach-Object { Num $_."${k}_cpu" })
    $pids = @($rows | ForEach-Object { $_."${k}_pid" } | Where-Object { $_ } | Select-Object -Unique)
    "$k pid $($pids -join ',') | cpu% p50 $(Pct $cpu 50) p95 $(Pct $cpu 95) max $(Pct $cpu 100) | ws MB $(FirstLast "${k}_ws_mb") $(Slope "${k}_ws_mb")/h | priv MB $(FirstLast "${k}_priv_mb") $(Slope "${k}_priv_mb")/h | handles $(FirstLast "${k}_handles") $(Slope "${k}_handles")/h | threads $(FirstLast "${k}_threads")"
}
$mc = @($rows | ForEach-Object { Num $_.machine_cpu })
"machine cpu% p50 $(Pct $mc 50) p95 $(Pct $mc 95) max $(Pct $mc 100) | free MB $(FirstLast machine_free_mb) | disk free GB $(FirstLast disk_free_gb) | procmon GB $(FirstLast procmon_gb)"
"server log MB $(FirstLast server_log_mb) | kicks $(FirstLast server_kicks) | saves $(FirstLast server_saves) last $($rows[-1].server_last_save) | exceptions $(FirstLast server_exceptions) | avatars $(FirstLast avatars) | sav bytes $(FirstLast sav_bytes)"
"gateway log MB $(FirstLast gateway_log_mb) | log errors $(FirstLast gateway_log_errors)"
# Stalls (SERVER-TESTING-PLAN.md section 12): rows that came late (watcher/VM paused), VerifyRPC drops, gateway bursts.
$gaps = @($rows | ForEach-Object { Num $_.sample_gap_s } | Where-Object { $_ -ne $null })
if ($gaps.Count) { $late = @($rows | Where-Object { (Num $_.sample_gap_s) -gt 2 * (Pct $gaps 50) }); "sample gap s p50 $(Pct $gaps 50) max $(Pct $gaps 100) | late rows $($late.Count)$(if ($late.Count) { ' (' + (($late | Select-Object -First 6 | ForEach-Object { "$($_.time.Substring(11, 8)) $($_.sample_gap_s)s" }) -join ', ') + ')' }) | packetdrop lines $(FirstLast server_packetdrops) | correction bursts $(FirstLast gw_bursts)" }
($rows[0].PSObject.Properties.Name | Where-Object { $_ -like 'gw_*' } | ForEach-Object { "$($_ -replace '^gw_','') $(FirstLast $_)" }) -join ' | '
if ($Buckets -gt 0) {
    'bucket | server cpu p50/max ws | gateway cpu p50/max ws | in_game | kicks | machine cpu p50 | free MB'
    $rows | Group-Object { $t = [datetime]$_.time; $t.ToUniversalTime().ToString('HH:') + ([Math]::Floor($t.ToUniversalTime().Minute / $Buckets) * $Buckets).ToString('00') } | ForEach-Object {
        $g = $_.Group; $sc = @($g | ForEach-Object { Num $_.server_cpu }); $gc = @($g | ForEach-Object { Num $_.gateway_cpu }); $mcb = @($g | ForEach-Object { Num $_.machine_cpu })
        "$($_.Name) | $(Pct $sc 50)/$(Pct $sc 100) $($g[-1].server_ws_mb) | $(Pct $gc 50)/$(Pct $gc 100) $($g[-1].gateway_ws_mb) | $($g[-1].gw_in_game) | $($g[-1].server_kicks) | $(Pct $mcb 50) | $($g[-1].machine_free_mb)"
    }
}
$kf = $file -replace '\.csv$', '-kicks.txt'; if (Test-Path -LiteralPath $kf) { 'kick lines:'; Get-Content -LiteralPath $kf -Tail 8 }
$bf = $file -replace '\.csv$', '-bursts.txt'; if (Test-Path -LiteralPath $bf) { 'correction bursts:'; Get-Content -LiteralPath $bf | Where-Object { $_ -match '^(=== |burst: )' } | Select-Object -Last 12 }
