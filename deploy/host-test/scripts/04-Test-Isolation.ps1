<#
.SYNOPSIS
  Proves the lock-down before any original code runs:
    1. every static check 05-Start-Server.ps1 needs (account, firewall rules, verified exe, removed files, LumaEmu
       offline settings, secrets folder permissions),
    2. a live probe run AS THE TEST ACCOUNT (powershell.exe, our own code): connections to the internet and your
       router must fail, a connection to a listener on 127.0.0.1 must succeed.
  Also warns while this PC has an internet route: DNS lookups are made by Windows' DNS Client service, not by the
  program, so a blocked program can still cause DNS queries. Unplug the network cable / turn Wi-Fi off during
  server runs for the strongest isolation (the gateway, central and browser all work on 127.0.0.1).
  Elevated PowerShell; asks for the test account's password for the probe. Dry run unless -Apply.
#>
param([switch]$Apply, [switch]$Json)
. (Join-Path $PSScriptRoot '_Common.ps1')
$s = Get-RlbSettings

Write-Plan 'Isolation check' @(
    'Static checks (account, firewall rules, verified exe, removed files, LumaEmu settings, secrets folder)',
    "Open a test listener on 127.0.0.1 (random port) in this session",
    "Run a probe as $($s.account): TCP to 1.1.1.1:443, 8.8.8.8:53, 13.107.4.52:80, your default gateway:80 (all must fail) and to the 127.0.0.1 listener (must succeed)",
    'Warn if this PC has a default route to the internet (DNS caveat above)'
)
Confirm-OrExit $Apply.IsPresent 'Apply'
Assert-Admin

$rows = Test-RlbLockdown

$listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
$gw = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1)
$targets = @('1.1.1.1:443', '8.8.8.8:53', '13.107.4.52:80')
if ($gw.Count) { $targets += ($gw[0].NextHop + ':80') }
# The probe exits with a bit mask: 1 = something outside was reachable, 2 = loopback failed.
$probe = @"
`$code = 0
foreach (`$t in @('$($targets -join "','")')) {
  `$h, `$p = `$t.Split(':'); `$c = New-Object Net.Sockets.TcpClient
  try { `$ar = `$c.BeginConnect(`$h, [int]`$p, `$null, `$null); if (`$ar.AsyncWaitHandle.WaitOne(2500) -and `$c.Connected) { `$code = `$code -bor 1 } } catch { } finally { `$c.Close() }
}
`$c = New-Object Net.Sockets.TcpClient
try { `$c.Connect('127.0.0.1', $port) } catch { `$code = `$code -bor 2 } finally { `$c.Close() }
exit `$code
"@
# The probe goes in a file the test account can read: Start-Process -Credential (CreateProcessWithLogonW) refuses
# command lines over 1024 characters, so -EncodedCommand cannot carry it.
$probeDir = Join-Path $env:ProgramData 'RLB-probe'
New-Item -ItemType Directory -Force -Path $probeDir | Out-Null
$probeFile = Join-Path $probeDir 'probe.ps1'
[IO.File]::WriteAllText($probeFile, $probe)
$cred = Get-Credential -UserName $s.account -Message "Password of the test account $($s.account) (for the network probe)"
try {
    $proc = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Credential $cred -LoadUserProfile `
        -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $probeFile) -WorkingDirectory $env:SystemRoot -WindowStyle Hidden -PassThru
    $deadline = (Get-Date).AddSeconds(30)
    while (-not $proc.HasExited -and (Get-Date) -lt $deadline) { if ($listener.Pending()) { $listener.AcceptTcpClient().Close() }; Start-Sleep -Milliseconds 100 }
    if (-not $proc.HasExited) { $proc.Kill(); throw 'Probe did not finish in 30 s.' }
    $code = $proc.ExitCode
} finally { $listener.Stop(); Remove-Item -LiteralPath $probeDir -Recurse -Force -ErrorAction SilentlyContinue }
if ($code -band 1) { $rows.Add([pscustomobject]@{ Check = "probe as $($s.account): outside blocked"; Status = 'FAIL'; Detail = 'a connection to the internet or your router succeeded' }) }
else { $rows.Add([pscustomobject]@{ Check = "probe as $($s.account): outside blocked"; Status = 'PASS'; Detail = ($targets -join ', ') + ' all failed' }) }
if ($code -band 2) { $rows.Add([pscustomobject]@{ Check = "probe as $($s.account): loopback works"; Status = 'FAIL'; Detail = "127.0.0.1:$port refused (the gateway could not reach the server)" }) }
else { $rows.Add([pscustomobject]@{ Check = "probe as $($s.account): loopback works"; Status = 'PASS'; Detail = "127.0.0.1:$port" }) }
if ($gw.Count) { $rows.Add([pscustomobject]@{ Check = 'PC offline during runs'; Status = 'WARN'; Detail = "default route via $($gw[0].NextHop): DNS lookups would still leave through Windows' DNS service; unplug or turn Wi-Fi off for the strongest isolation" }) }
else { $rows.Add([pscustomobject]@{ Check = 'PC offline during runs'; Status = 'PASS'; Detail = 'no default route' }) }

$rows | Format-Table -AutoSize -Wrap | Out-String -Width 220 | Write-Host
Write-RlbResult -Rows $rows
$fails = @($rows | Where-Object { $_.Status -eq 'FAIL' })
if ($fails.Count) { Write-Host "$($fails.Count) check(s) failed. Do not start the server." -ForegroundColor Red; exit 1 }
Write-Host 'Isolation check passed.' -ForegroundColor Green
