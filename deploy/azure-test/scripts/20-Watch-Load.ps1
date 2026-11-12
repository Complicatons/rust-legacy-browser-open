<#
.SYNOPSIS
  Load/soak watcher for the server machine (SERVER-TESTING-PLAN.md section 12). Every -Interval seconds it appends one
  CSV row to C:\RLB-host\logs\watch-<Tag>.csv: for the original server, gateway, sidecar and central (found by image
  name / command line, so restarts are followed) CPU % of the machine, working set, private bytes, handles and
  threads; machine CPU and free memory; the server log size plus TruthDetector kicks, saves and exceptions counted
  from the new log lines; the gateway log size and its error lines; the gateway /metrics counters (bearer token read
  from secrets\metrics.token, never printed); avatar files and the newest .sav. Read-only: it starts and stops nothing.
  Run detached (Win32_Process.Create) for long runs; 21-Read-Watch.ps1 summarises the CSV.
  Server-wide stalls (section 12): sample_gap_s is the time since the previous row (much more than -Interval: this
  watcher, and likely the whole VM, was paused); server_packetdrops counts NetCull.VerifyRPC 'packetdrop:' lines (only
  with packet.loglevel 1+ on the server); gw_bursts counts the gateway's 'correction-burst' lines. For each burst,
  watch-<Tag>-bursts.txt gets the gateway line, the server and gateway log lines of the previous, this and the next
  sample (the server log has no times, so that is the closest match) and the System event log around it.
#>
param([int]$Seconds = 3600, [int]$Interval = 15, [string]$Tag = (Get-Date -Format 'yyyyMMdd-HHmm'), [string]$Root = 'C:\RLB-host')
$ErrorActionPreference = 'Continue'
$root = $Root
$out = Join-Path $root "logs\watch-$Tag.csv"
$serverLog = Join-Path $root 'server\test\rust_server_Data\output_log.txt'
$userdata = Join-Path $root 'server\test\rust_server_Data\userdata'
$saveDir = Join-Path $root 'server\test\rust_server_Data'   # autosave: <datadir><map>.sav
$cores = [Environment]::ProcessorCount
Set-Content -LiteralPath (Join-Path $root "run\watch-$Tag.pid") -Value $PID

# Gateway /metrics: listen address from config\gateway.json, token from secrets\metrics.token (self-signed TLS).
$gw = Get-Content -Raw -LiteralPath (Join-Path $root 'config\gateway.json') -ErrorAction SilentlyContinue | ConvertFrom-Json
$tokenFile = Join-Path $root 'secrets\metrics.token'
$token = if (Test-Path -LiteralPath $tokenFile) { (Get-Content -Raw -LiteralPath $tokenFile).Trim() } else { $null }
Add-Type -TypeDefinition 'public class RlbTrustAll { public static bool Ok(object a, System.Security.Cryptography.X509Certificates.X509Certificate b, System.Security.Cryptography.X509Certificates.X509Chain c, System.Net.Security.SslPolicyErrors d) { return true; } }' -ErrorAction SilentlyContinue
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = [System.Net.Security.RemoteCertificateValidationCallback] [RlbTrustAll].GetMethod('Ok').CreateDelegate([System.Net.Security.RemoteCertificateValidationCallback])
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
$metricsUrl = if ($gw) { "https://$($gw.listen.host):$($gw.listen.port)/metrics" } else { $null }
$want = 'rlb_gateway_sessions', 'rlb_gateway_in_game', 'rlb_gateway_move_corrections_total', 'rlb_gateway_clock_resyncs_total', 'rlb_gateway_correction_bursts_total', 'rlb_gateway_loop_lag_recent_ms', 'rlb_gateway_loop_lag_max_ms', 'rlb_gateway_connections_total', 'rlb_gateway_approved_total', 'rlb_gateway_native_closed_total', 'rlb_gateway_server_denied_total', 'rlb_gateway_rate_limited_total', 'rlb_gateway_anticheat_dropped_total', 'rlb_gateway_anticheat_flags_total', 'rlb_gateway_kicked_total', 'rlb_gateway_malformed_total', 'rlb_gateway_admission_timeouts_total'

function Get-Roles {
    $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='rust_server.exe'" -ErrorAction SilentlyContinue
    $r = [ordered]@{ server = $null; gateway = $null; sidecar = $null; central = $null }
    foreach ($p in $procs) {
        if ($p.Name -eq 'rust_server.exe') { $r.server = $p.ProcessId }
        elseif ($p.CommandLine -match 'gateway\.mjs') { $r.gateway = $p.ProcessId }
        elseif ($p.CommandLine -match 'adapter-sidecar\.mjs') { $r.sidecar = $p.ProcessId }
        elseif ($p.CommandLine -match 'central\.mjs') { $r.central = $p.ProcessId }
    }
    return $r
}
# New lines of a growing text file since the last call (by byte offset; a shorter file starts over).
$offsets = @{}
function Read-NewLines([string]$path) {
    if (-not $path -or -not (Test-Path -LiteralPath $path)) { return @() }
    $len = (Get-Item -LiteralPath $path).Length
    $from = if ($offsets.ContainsKey($path) -and $offsets[$path] -le $len) { $offsets[$path] } else { [Math]::Max(0, $len - 1MB) }
    if ($len -eq $from) { return @() }
    $fs = [System.IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
    try { [void]$fs.Seek($from, 'Begin'); $sr = New-Object System.IO.StreamReader($fs); $text = $sr.ReadToEnd() } finally { $fs.Dispose() }
    $offsets[$path] = $len
    return $text -split "`r?`n"
}
$prevCpu = @{}; $prevT = Get-Date
$kicks = 0; $saves = 0; $exceptions = 0; $gwErrors = 0; $lastSave = ''; $lastKick = ''; $packetDrops = 0; $bursts = 0
$burstFile = $out -replace '\.csv$', '-bursts.txt'
$prevServer = @(); $prevGw = @(); $captureNext = $false
# Last lines of a sample's new log text for the bursts file (bounded: a chat-heavy sample can be thousands of lines).
function Tail-Lines($lines, [int]$n) { $l = @($lines | Where-Object { $_ -ne '' }); if ($l.Count -gt $n) { $l[($l.Count - $n)..($l.Count - 1)] } else { $l } }
[void](Read-NewLines $serverLog)   # count only what happens from now on
$gwLog = $null
$header = $false
$end = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $end) {
    $now = Get-Date; $dt = ($now - $prevT).TotalSeconds; $prevT = $now
    $row = [ordered]@{ time = $now.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); sample_gap_s = [Math]::Round($dt, 1) }
    $roles = Get-Roles
    foreach ($k in $roles.Keys) {
        $p = if ($roles[$k]) { Get-Process -Id $roles[$k] -ErrorAction SilentlyContinue } else { $null }
        if ($p) {
            $cpu = $p.TotalProcessorTime.TotalSeconds; $key = "$k-$($p.Id)"
            $row["${k}_cpu"] = if ($prevCpu.ContainsKey($key) -and $dt -gt 0) { [Math]::Round(100 * ($cpu - $prevCpu[$key]) / $dt / $cores, 1) } else { '' }
            $prevCpu[$key] = $cpu
            $row["${k}_ws_mb"] = [Math]::Round($p.WorkingSet64 / 1MB, 1); $row["${k}_priv_mb"] = [Math]::Round($p.PrivateMemorySize64 / 1MB, 1)
            $row["${k}_handles"] = $p.HandleCount; $row["${k}_threads"] = $p.Threads.Count; $row["${k}_pid"] = $p.Id
        } else { foreach ($f in 'cpu', 'ws_mb', 'priv_mb', 'handles', 'threads', 'pid') { $row["${k}_$f"] = '' } }
    }
    $os = Get-CimInstance Win32_OperatingSystem
    $row.machine_cpu = [Math]::Round((Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average, 0)
    $row.machine_free_mb = [Math]::Round($os.FreePhysicalMemory / 1KB, 0)
    $serverLines = @(Read-NewLines $serverLog)
    foreach ($l in $serverLines) {
        if ($l -match 'kicked for violation') { $kicks++; $lastKick = $l.Trim() }
        elseif ($l -match "Saving to '") { $saves++; $lastSave = $now.ToUniversalTime().ToString('HH:mm:ss') }
        elseif ($l -match '^packetdrop:') { $packetDrops++ }
        elseif ($l -match 'Exception') { $exceptions++ }
    }
    $row.server_log_mb = if (Test-Path -LiteralPath $serverLog) { [Math]::Round((Get-Item -LiteralPath $serverLog).Length / 1MB, 2) } else { '' }
    $row.server_kicks = $kicks; $row.server_saves = $saves; $row.server_last_save = $lastSave; $row.server_exceptions = $exceptions
    $row.server_lines = @($serverLines | Where-Object { $_ -ne '' }).Count; $row.server_packetdrops = $packetDrops
    $newest = Get-ChildItem -LiteralPath (Join-Path $root 'logs') -Filter 'gateway-*.log' -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '\.err\.log$' } | Sort-Object LastWriteTime | Select-Object -Last 1
    if ($newest -and $newest.FullName -ne $gwLog) { $gwLog = $newest.FullName; [void](Read-NewLines $gwLog) }
    $gwLines = @(Read-NewLines $gwLog); $burstLines = @()
    foreach ($l in $gwLines) { if ($l -match 'correction-burst') { $bursts++; $burstLines += $l } elseif ($l -match '(?i)error|exception|protocol') { $gwErrors++ } }
    if ($captureNext) {
        Add-Content -LiteralPath $burstFile -Value (@("--- next sample $($row.time): server log") + (Tail-Lines $serverLines 200) + @('--- gateway log') + (Tail-Lines $gwLines 100))
        $captureNext = $false
    }
    if ($burstLines.Count) {
        $from = $now.AddSeconds(-($Interval + 60))
        $events = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = $from } -MaxEvents 40 -ErrorAction SilentlyContinue | Sort-Object TimeCreated | ForEach-Object { "$($_.TimeCreated.ToUniversalTime().ToString('HH:mm:ss')) $($_.ProviderName) $($_.Id) $($_.LevelDisplayName): $((("$($_.Message)" -split "`r?`n")[0]))" })
        Add-Content -LiteralPath $burstFile -Value (@("=== $($row.time) sample gap $([Math]::Round($dt, 1)) s") + @($burstLines | ForEach-Object { "burst: $_" }) + @('--- previous sample: server log') + (Tail-Lines $prevServer 200) + @('--- this sample: server log') + (Tail-Lines $serverLines 200) + @('--- gateway log (previous + this sample)') + (Tail-Lines (@($prevGw) + $gwLines) 150) + @("--- System event log since $($from.ToUniversalTime().ToString('HH:mm:ss'))") + $events)
        $captureNext = $true
    }
    $prevServer = $serverLines; $prevGw = $gwLines
    $row.gateway_log_mb = if ($gwLog) { [Math]::Round((Get-Item -LiteralPath $gwLog).Length / 1MB, 2) } else { '' }
    $row.gateway_log_errors = $gwErrors; $row.gw_bursts = $bursts
    $m = @{}
    if ($metricsUrl -and $token) {
        try {
            $req = [System.Net.HttpWebRequest]::Create($metricsUrl); $req.Headers.Add('Authorization', "Bearer $token"); $req.Timeout = 5000
            $resp = $req.GetResponse(); $sr = New-Object System.IO.StreamReader($resp.GetResponseStream()); $text = $sr.ReadToEnd(); $resp.Close()
            foreach ($l in $text -split "`n") { if ($l -match '^(rlb_gateway_[a-z_]+)(\{[^}]*\})? ([0-9.eE+-]+)$') { $m[$Matches[1]] = [double]$Matches[3] + ($m[$Matches[1]] -as [double]) } }
        } catch { $m['error'] = 1 }
    }
    foreach ($k in $want) { $row[$k -replace '^rlb_gateway_', 'gw_'] = $m[$k] }
    $row.avatars = @(Get-ChildItem -LiteralPath $userdata -Recurse -Filter 'avatar.bin' -ErrorAction SilentlyContinue).Count
    $sav = Get-ChildItem -LiteralPath $saveDir -Filter '*.sav' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
    $row.sav_bytes = if ($sav) { $sav.Length } else { '' }
    $pml = Get-ChildItem -LiteralPath (Join-Path $root 'captures') -Filter '*.pml' -ErrorAction SilentlyContinue | Measure-Object Length -Sum
    $row.procmon_gb = [Math]::Round($pml.Sum / 1GB, 2)
    $row.disk_free_gb = [Math]::Round((Get-PSDrive C).Free / 1GB, 1)
    $line = [pscustomobject]$row
    if (-not $header) { $line | ConvertTo-Csv -NoTypeInformation | Set-Content -LiteralPath $out -Encoding UTF8; $header = $true }
    else { ($line | ConvertTo-Csv -NoTypeInformation)[1] | Add-Content -LiteralPath $out -Encoding UTF8 }
    if ($lastKick) { Add-Content -LiteralPath ($out -replace '\.csv$', '-kicks.txt') -Value "$($row.time) $lastKick"; $lastKick = '' }
    Start-Sleep -Seconds ([Math]::Max(1, $Interval - ((Get-Date) - $now).TotalSeconds))
}
Remove-Item -LiteralPath (Join-Path $root "run\watch-$Tag.pid") -ErrorAction SilentlyContinue
