<#
.SYNOPSIS
  VM only. Makes a fresh working copy C:\RLB\server\test from the pristine C:\RLB\server\original (which is never
  modified or run) and writes cfg\server.cfg: the shipped values with only rcon.password replaced by the VM-generated
  secret (reference: deploy\vm-test\server\server.cfg). Dry run unless -Apply. Server must be stopped.
#>
param([switch]$Apply)
. (Join-Path $PSScriptRoot '_Common.ps1')
Assert-NotHost
$p = Get-RlbPaths

Write-Plan 'Create the test copy (unpatched)' @(
    "Refuse if a server started from $($p.TestCopy) is still running",
    "Delete $($p.TestCopy) if present and copy $($p.Original) into it (read-only flags cleared on the copy)",
    'Check the shipped cfg\server.cfg matches deploy\vm-test\server\server.cfg apart from the rcon password',
    'Write cfg\server.cfg with rcon.password from C:\RLB\secrets\rcon.password (everything else as shipped)',
    "Write $($p.Manifests)\test-baseline.csv for later 'what did the server write' comparison"
)
Confirm-OrExit $Apply.IsPresent 'Apply'
if (-not (Test-Path -LiteralPath $p.Original)) { throw 'Run 04-Unpack-Server.ps1 first.' }
$running = @(Get-Process rust_server -ErrorAction SilentlyContinue)
if ($running.Count) { throw 'rust_server.exe is running; stop it with 08-Stop-Server.ps1 first.' }
$rcon = Read-Secret 'rcon.password'
if ($rcon -notmatch '^[A-Za-z0-9]{12,64}$') { throw 'rcon.password must be 12..64 letters/digits.' }

if (Test-Path -LiteralPath $p.TestCopy) { Remove-Item -LiteralPath $p.TestCopy -Recurse -Force }
& robocopy.exe $p.Original $p.TestCopy /E /NFL /NDL /NJH /NJS /NP /A-:R | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
Get-ChildItem -LiteralPath $p.TestCopy -Recurse -File | ForEach-Object { $_.IsReadOnly = $false }

$cfgPath = Join-Path $p.TestCopy 'cfg\server.cfg'
$shipped = [IO.File]::ReadAllText($cfgPath)
$reference = [IO.File]::ReadAllText((Join-Path $script:RlbDeployDir 'server\server.cfg'))
if ($shipped -ne $reference.Replace('"__RCON_PASSWORD__"', '"rconpassword"')) { throw 'Shipped cfg\server.cfg differs from the recorded reference; stop and investigate (wrong zip?).' }
$cfg = $reference.Replace('__RCON_PASSWORD__', $rcon)
[IO.File]::WriteAllText($cfgPath, $cfg, (New-Object Text.ASCIIEncoding))
Write-Host 'cfg\server.cfg: shipped values, rcon.password replaced (only change).'

$rows = foreach ($f in Get-ChildItem -LiteralPath $p.TestCopy -Recurse -File) {
    [pscustomobject]@{ Path = $f.FullName.Substring($p.TestCopy.Length + 1); Bytes = $f.Length; Sha256 = Get-Sha256 $f.FullName }
}
$rows | Export-Csv -NoTypeInformation -LiteralPath (Join-Path $p.Manifests 'test-baseline.csv')
Write-Host 'Test copy ready (unpatched). P1/P3 can start it with 07-Start-Server.ps1; P4+ runs 06-Patch-TestCopy.ps1 first.' -ForegroundColor Green
