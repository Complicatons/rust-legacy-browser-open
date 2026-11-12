<#
.SYNOPSIS
  Writes a read-only UDF ISO image of a folder using Windows' built-in IMAPI2 file-system imaging COM object
  (IMAPI2FS.MsftFileSystemImage). No third-party tools, no downloads. Used by tools/build-vm-iso.mjs.
  Packaging only: nothing inside the folder is opened as code or executed.
.EXAMPLE
  powershell -NoProfile -File tools\new-iso-image.ps1 -SourceDir build\vm-test\stage -Output build\vm-test\rlb-vm-tools.iso -VolumeName RLB_VMTEST
#>
param(
    [Parameter(Mandatory = $true)][string]$SourceDir,
    [Parameter(Mandatory = $true)][string]$Output,
    [ValidatePattern('^[A-Z0-9_]{1,16}$')][string]$VolumeName = 'RLB_VMTEST'
)
$ErrorActionPreference = 'Stop'
$SourceDir = (Resolve-Path -LiteralPath $SourceDir).Path
$Output = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output -Force }

if (-not ('RlbIsoStreamWriter' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
public static class RlbIsoStreamWriter {
    // Copies the IMAPI result IStream to a file in 2 MB chunks.
    public static long Write(object comStream, string path) {
        IStream s = (IStream)comStream;
        byte[] buf = new byte[2 * 1024 * 1024];
        long total = 0;
        IntPtr pcb = Marshal.AllocHGlobal(sizeof(int));
        try {
            using (FileStream fs = new FileStream(path, FileMode.CreateNew, FileAccess.Write)) {
                while (true) {
                    s.Read(buf, buf.Length, pcb);
                    int n = Marshal.ReadInt32(pcb);
                    if (n <= 0) break;
                    fs.Write(buf, 0, n);
                    total += n;
                }
            }
        } finally { Marshal.FreeHGlobal(pcb); }
        return total;
    }
}
'@
}

$fsi = New-Object -ComObject IMAPI2FS.MsftFileSystemImage
$fsi.ChooseImageDefaultsForMediaType(18)   # IMAPI_MEDIA_TYPE_BDR: room for up to ~25 GB
$fsi.FileSystemsToCreate = 4               # FsiFileSystemUDF only: long names and deep node_modules paths
$fsi.VolumeName = $VolumeName
$fsi.Root.AddTree($SourceDir, $false)
$result = $fsi.CreateResultImage()
$bytes = [RlbIsoStreamWriter]::Write($result.ImageStream, $Output)
$expected = [int64]$result.BlockSize * [int64]$result.TotalBlocks
if ($bytes -ne $expected) { throw "ISO size $bytes differs from IMAPI's $expected" }
[Runtime.InteropServices.Marshal]::ReleaseComObject($fsi) | Out-Null
Write-Host ("Wrote {0} ({1:N0} bytes, {2} blocks of {3})" -f $Output, $bytes, $result.TotalBlocks, $result.BlockSize)
