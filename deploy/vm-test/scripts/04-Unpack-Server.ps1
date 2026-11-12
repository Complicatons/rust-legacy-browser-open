<#
.SYNOPSIS
  VM only. Verifies RustLegacyServer.zip on the tools ISO against the recorded size and SHA-256
  (analysis/INITIAL-FINDINGS.md), unpacks it to C:\RLB\server\original (never executed here), checks the server
  Assembly-CSharp.dll hash, records a per-file SHA-256 manifest and marks the pristine copy read-only.
  Dry run unless -Apply. -Replace deletes an existing original folder first.
#>
param([switch]$Apply, [switch]$Replace)
. (Join-Path $PSScriptRoot '_Common.ps1')
Assert-NotHost
$s = Get-RlbSettings
$p = Get-RlbPaths
$media = Find-ToolsMedia
$zip = Join-Path $media ('server\' + $s.server.zipName)

Write-Plan 'Unpack the original server (no execution)' @(
    "Check $zip is $($s.server.zipBytes) bytes with SHA-256 $($s.server.zipSha256)",
    'Check every zip entry stays inside the target folder (no absolute or ..\ paths)',
    "Extract to $($p.Original)$(if ($Replace) { ' (deleting the existing copy first)' })",
    "Check rust_server_Data\Managed\Assembly-CSharp.dll SHA-256 = $($s.server.assemblyCSharpSha256)",
    "Write $($p.Manifests)\original.csv (path, size, SHA-256) and set the files read-only"
)
Confirm-OrExit $Apply.IsPresent 'Apply'
New-RlbDirs

if (-not (Test-Path -LiteralPath $zip)) { throw "Missing $zip" }
$len = (Get-Item -LiteralPath $zip).Length
if ($len -ne [int64]$s.server.zipBytes) { throw "Size mismatch: $len bytes, expected $($s.server.zipBytes). Refusing." }
$h = Get-Sha256 $zip
if ($h -ne $s.server.zipSha256.ToUpperInvariant()) { throw "SHA-256 mismatch: $h, expected $($s.server.zipSha256). Refusing." }
Write-Host "Zip verified ($h)." -ForegroundColor Green

if (Test-Path -LiteralPath $p.Original) {
    if (-not $Replace) { throw "$($p.Original) already exists. Use -Replace to unpack again." }
    Get-ChildItem -LiteralPath $p.Original -Recurse -File | ForEach-Object { $_.IsReadOnly = $false }
    Remove-Item -LiteralPath $p.Original -Recurse -Force
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$dest = [IO.Path]::GetFullPath($p.Original + '\')
$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
    foreach ($e in $archive.Entries) {
        $target = [IO.Path]::GetFullPath((Join-Path $dest $e.FullName))
        if (-not $target.StartsWith($dest, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe zip entry path: $($e.FullName)" }
    }
} finally { $archive.Dispose() }
[IO.Compression.ZipFile]::ExtractToDirectory($zip, $p.Original)

$asm = Join-Path $p.Original 'rust_server_Data\Managed\Assembly-CSharp.dll'
$ah = Get-Sha256 $asm
if ($ah -ne $s.server.assemblyCSharpSha256.ToUpperInvariant()) { throw "Assembly-CSharp.dll hash $ah is not the supported build $($s.server.assemblyCSharpSha256)." }

$rows = foreach ($f in Get-ChildItem -LiteralPath $p.Original -Recurse -File) {
    [pscustomobject]@{ Path = $f.FullName.Substring($p.Original.Length + 1); Bytes = $f.Length; Sha256 = Get-Sha256 $f.FullName }
}
$rows | Export-Csv -NoTypeInformation -LiteralPath (Join-Path $p.Manifests 'original.csv')
Get-ChildItem -LiteralPath $p.Original -Recurse -File | ForEach-Object { $_.IsReadOnly = $true }
Write-Host ("Unpacked {0} files; Assembly-CSharp.dll verified; manifest written. Next: 05-New-TestCopy.ps1." -f @($rows).Count) -ForegroundColor Green
