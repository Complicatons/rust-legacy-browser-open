<#
.SYNOPSIS
  Unpacks the verified server zip into C:\RLB-host\server\original (kept pristine, never run) and makes the test copy
  C:\RLB-host\server\test that 05-Start-Server.ps1 runs:
    - VAC2.dll moved out to C:\RLB-host\quarantine (Valve signature broken: modified after signing),
    - LumaEmu.ini switched offline (Offline=1, Master=0, UnlockDLC=2),
    - cfg\server.cfg as shipped with only rcon.password replaced by a new random secret (C:\RLB-host\secrets).
  Folder permissions: C:\RLB-host is closed to everyone except administrators, SYSTEM and you; the test account gets
  read access to the folder chain and modify access to the test copy only (not the original, not the secrets).
  Writes manifests\test-baseline.csv so 07-Collect.ps1 can list what the server changed.
  Only reads and copies the original files (no original code runs). Elevated PowerShell. Dry run unless -Apply.
#>
param([Parameter(Mandatory = $true)][string]$ZipPath, [switch]$Apply, [switch]$Reextract, [switch]$RotateRcon, [switch]$Json)
. (Join-Path $PSScriptRoot '_Common.ps1')
$s = Get-RlbSettings
$p = Get-RlbPaths

Write-Plan 'Prepare the original server and the locked-down test copy' @(
    "Check $ZipPath is $($s.server.zipBytes) bytes with SHA-256 $($s.server.zipSha256)",
    "Extract it to $($p.Original)$(if (-not $Reextract) { ' (skipped if already there)' }) and check rust_server.exe is the verified Unity player",
    'Create C:\RLB-host\secrets\rcon.password (random) unless it exists (-RotateRcon makes a new one)',
    "Replace $($p.TestCopy) with a fresh copy of the original",
    "Move $($s.server.removeFromTestCopy -join ', ') from the test copy to $($p.Quarantine)",
    'Set LumaEmu.ini Offline=1, Master=0, UnlockDLC=2 in the test copy',
    'Write cfg\server.cfg: shipped values, only rcon.password replaced',
    "Set folder permissions (icacls): $($p.Root) for administrators, SYSTEM and you; $($s.account): read on the folder chain, modify on the test copy only",
    "Write $($p.Manifests)\test-baseline.csv (path, size, SHA-256 of every test-copy file)"
) -ChangesSecurity
Confirm-OrExit $Apply.IsPresent 'Apply'
Assert-Admin
$sid = Get-TestAccountSid
New-RlbDirs

$zip = Get-Item -LiteralPath $ZipPath
if ($zip.Length -ne [int64]$s.server.zipBytes) { throw "Zip is $($zip.Length) bytes, expected $($s.server.zipBytes)." }
Write-Host 'Hashing the zip...'
if ((Get-Sha256 $zip.FullName) -ne $s.server.zipSha256) { throw 'Zip SHA-256 does not match the analysed RustLegacyServer.zip. Stop.' }

if ($Reextract -and (Test-Path -LiteralPath $p.Original)) { Remove-Item -LiteralPath $p.Original -Recurse -Force }
if (-not (Test-Path -LiteralPath $p.Original)) {
    Write-Host "Extracting to $($p.Original)..."
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zip.FullName, $p.Original)
}
$origExe = Join-Path $p.Original $s.server.exe
if ((Get-Sha256 $origExe) -ne $s.server.exeSha256) { throw "$origExe is not the verified Unity player." }

$rconFile = Join-Path $p.Secrets 'rcon.password'
if ($RotateRcon -or -not (Test-Path -LiteralPath $rconFile)) { Set-Content -LiteralPath $rconFile -Value (New-RandomPassword 24) -NoNewline }
$rcon = Read-Secret 'rcon.password'

if (@(Get-Process rust_server -ErrorAction SilentlyContinue).Count) { throw 'rust_server.exe is running; stop it with 06-Stop-Server.ps1 first.' }
if (Test-Path -LiteralPath $p.TestCopy) { Remove-Item -LiteralPath $p.TestCopy -Recurse -Force }
& robocopy.exe $p.Original $p.TestCopy /E /NFL /NDL /NJH /NJS /NP /A-:R | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }

$stamp = Get-Stamp
foreach ($f in $s.server.removeFromTestCopy) {
    $src = Join-Path $p.TestCopy $f
    if (Test-Path -LiteralPath $src) { Move-Item -LiteralPath $src -Destination (Join-Path $p.Quarantine "$stamp-$f") -Force; Write-Host "Moved $f to quarantine." }
}

$ini = Join-Path $p.TestCopy 'LumaEmu.ini'
$text = [IO.File]::ReadAllText($ini)
foreach ($sec in $s.server.lumaEmu.PSObject.Properties) {
    foreach ($kv in $sec.Value.PSObject.Properties) {
        $pattern = '(?m)^(' + [regex]::Escape($kv.Name) + '\s*=\s*)[^\r\n]*'
        if ($text -notmatch $pattern) { throw "LumaEmu.ini has no $($kv.Name) line; stop and investigate (different package?)." }
        $text = [regex]::Replace($text, $pattern, '${1}' + $kv.Value)
    }
}
[IO.File]::WriteAllText($ini, $text, (New-Object Text.ASCIIEncoding))

$cfgPath = Join-Path $p.TestCopy 'cfg\server.cfg'
$lf = { param($t) $t.Replace("`r`n", "`n") }
$shipped = & $lf ([IO.File]::ReadAllText($cfgPath))
$reference = & $lf ([IO.File]::ReadAllText((Join-Path (Split-Path -Parent $script:RlbDeployDir) 'vm-test\server\server.cfg')))
if ($shipped -ne $reference.Replace('"__RCON_PASSWORD__"', '"rconpassword"')) { throw 'Shipped cfg\server.cfg differs from the recorded reference; stop and investigate.' }
[IO.File]::WriteAllText($cfgPath, $reference.Replace('__RCON_PASSWORD__', $rcon), (New-Object Text.ASCIIEncoding))

# Permissions. Only the root gets explicit entries (inheritance off); everything below is reset to inherit from it, so
# folder-only flags like (OI)(CI) are never applied to files (that left files with an empty ACL). The test account gets
# traverse/read on the chain (this folder only) and inheritable modify on the test copy.
$me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $p.Root /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' ("*{0}:(OI)(CI)F" -f $me) /Q | Out-Null
if ($LASTEXITCODE) { throw "icacls on $($p.Root) failed ($LASTEXITCODE)" }
& icacls.exe (Join-Path $p.Root '*') /reset /T /C /Q | Out-Null
if ($LASTEXITCODE) { throw "icacls reset under $($p.Root) failed ($LASTEXITCODE)" }
foreach ($d in @($p.Root, $p.Server)) { & icacls.exe $d /grant ("*{0}:(RX)" -f $sid) /Q | Out-Null }
& icacls.exe $p.TestCopy /grant ("*{0}:(OI)(CI)M" -f $sid) /Q | Out-Null
if ($LASTEXITCODE) { throw "icacls on $($p.TestCopy) failed ($LASTEXITCODE)" }
if (-not (Get-Sha256 (Join-Path $p.TestCopy $s.server.exe))) { throw 'Test copy unreadable after setting permissions.' }

$rows = foreach ($f in Get-ChildItem -LiteralPath $p.TestCopy -Recurse -File) {
    [pscustomobject]@{ Path = $f.FullName.Substring($p.TestCopy.Length + 1); Bytes = $f.Length; Sha256 = Get-Sha256 $f.FullName }
}
$rows | Export-Csv -NoTypeInformation -LiteralPath (Join-Path $p.Manifests 'test-baseline.csv')
Write-Host "Test copy ready: $($p.TestCopy) ($(@($rows).Count) files)." -ForegroundColor Green
Write-Host 'Next: 03-Set-Firewall.ps1 -Apply, then 04-Test-Isolation.ps1 -Apply.'
