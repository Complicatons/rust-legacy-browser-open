<#
.SYNOPSIS
  ON A THROWAWAY AZURE VM (own VNet, no inbound rules, deleted afterwards; never the game test VM or the owner's
  PC). Gets a genuine Fougerite-patched Rust Legacy server's Assembly-CSharp.dll and checks whether our vanilla
  patcher's hook-site pattern (tools/vanilla-patcher) still finds everything it needs in it, for
  OFFSHOOT-COMPATIBILITY-PLAN.md work item 4 ("Fougerite servers: get a sample patched Assembly-CSharp.dll").
  Self-contained: Run Command can send this file as its script with no kit update.
    1. downloads Fougerite's own "premade" server package (21-part zip, ~2.1 GB) straight from its public GitHub
       repo (github.com/Notulp/Fougerite, the project's real source, not a third party's bundled copy),
    2. downloads our already-built VanillaPatcher.exe (self-contained, published on the PC, uploaded as a kit blob
       by the coordinator; nothing is compiled on this VM),
    3. unpacks the package with 7-Zip (7z opens the multi-volume .zip and finds the .z01-.z20 parts beside it;
       administrative MSI extract installs nothing) and finds rust_server_Data\Managed\,
    4. hashes every file in that folder (text listing only) and runs VanillaPatcher.exe probe against
       Assembly-CSharp.dll: a read-only check (Mono.Cecil metadata only) that reports whether our 21 hook sites are
       still found, same as `check` but without needing the build on an allowlist first,
    5. zips the probe output and the file listing (TEXT ONLY) to -Root\fougerite-probe-<time>.zip, then PUTs it to
       the container in -ContainerSasUrl if given.
  NOTHING DOWNLOADED IS EVER RUN: no server, launcher, updater or installer from the package is started, and no
  assembly is loaded into a CLR for execution (VanillaPatcher.exe only reads CLI metadata with Mono.Cecil, the same
  category of operation already used throughout this project for static analysis). The package's binaries never
  leave this VM; only probe's text output and file hashes do. Elevated PowerShell (Run Command runs as SYSTEM).
  Dry run unless -Apply.
#>
param([string]$ContainerSasUrl, [string]$PatcherSasUrl, [string]$Root = 'C:\RLB-fougerite', [switch]$Apply)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Fougerite's own public repo, OriginalRustServerFilesFougerite1.9.91_Premade: 20 x 100 MiB parts + a 13.9 MB .zip.
$repoRaw = 'https://raw.githubusercontent.com/Notulp/Fougerite/master/OriginalRustServerFilesFougerite1.9.91_Premade'
$parts = @((1..20 | ForEach-Object { 'OriginalRustServerFilesFougerite1.9.91_Premade.z{0:d2}' -f $_ }) + 'OriginalRustServerFilesFougerite1.9.91_Premade.zip')

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$dl = Join-Path $Root 'download'; $ex = Join-Path $Root 'extract'; $tools = Join-Path $Root 'tools'; $out = Join-Path $Root "probe-$stamp"
Write-Host "Fougerite probe -> $out"
Write-Host "  Package: $repoRaw (21 parts, ~2.1 GB total)"
Write-Host '  Patcher: VanillaPatcher.exe (prebuilt on the PC, downloaded as a kit blob, not compiled here)'
Write-Host '  Nothing downloaded is run. Only probe text output and file hashes leave this VM.'
if (-not $Apply) { Write-Host 'Dry run. Re-run with -Apply.' -ForegroundColor Yellow; exit 0 }
if ($ContainerSasUrl -and $ContainerSasUrl -notmatch '^https://[a-z0-9]+\.blob\.core\.windows\.net/[a-z0-9-]+\?.*sig=') { throw '-ContainerSasUrl must be an https container SAS URL.' }
if (-not $PatcherSasUrl) { throw '-PatcherSasUrl is required: a read SAS to the VanillaPatcher.exe blob the coordinator uploaded.' }
$freeGb = [math]::Round((Get-PSDrive ($Root.Substring(0, 1))).Free / 1GB, 1)
if ($freeGb -lt 20) { throw "Only $freeGb GB free on $($Root.Substring(0, 2)); the package needs about 2.1 GB compressed plus room to extract." }
New-Item -ItemType Directory -Force -Path $dl, $ex, $tools, $out | Out-Null

function Get-File([string]$Url, [string]$Path) {
    if (Test-Path -LiteralPath $Path) { return }
    & curl.exe -fsSL --retry 3 -A 'Mozilla/5.0' -o $Path $Url
    if ($LASTEXITCODE) { throw "Download failed (curl $LASTEXITCODE): $Url" }
}

# --- 7-Zip (official source only; administrative MSI extract installs nothing) ---
$sevenZip = Join-Path $tools '7z\Files\7-Zip\7z.exe'
if (-not (Test-Path $sevenZip)) {
    $msi = Join-Path $tools '7z2408-x64.msi'; Get-File 'https://www.7-zip.org/a/7z2408-x64.msi' $msi
    Start-Process msiexec.exe -Wait -ArgumentList @('/a', "`"$msi`"", '/qn', "TARGETDIR=`"$(Join-Path $tools '7z')`"")
}

# --- Download the VanillaPatcher.exe blob and the 21-part package ---
$patcherExe = Join-Path $Root 'VanillaPatcher.exe'
& curl.exe -fsS --retry 3 -o $patcherExe $PatcherSasUrl
if ($LASTEXITCODE) { throw "VanillaPatcher.exe download failed (curl $LASTEXITCODE)." }
Write-Host "VanillaPatcher.exe: $((Get-Item $patcherExe).Length) bytes sha256 $((Get-FileHash -Algorithm SHA256 -LiteralPath $patcherExe).Hash.ToLowerInvariant())"

$i = 0
foreach ($p in $parts) {
    $i++
    Write-Host "Downloading part $i/21: $p"
    Get-File "$repoRaw/$p" (Join-Path $dl $p)
}
$total = (Get-ChildItem $dl -File | Measure-Object Length -Sum).Sum
Write-Host "Downloaded $([math]::Round($total / 1GB, 2)) GB."

# --- Extract: point 7z at the .zip; it finds the .zNN volumes beside it ---
$mainZip = Join-Path $dl 'OriginalRustServerFilesFougerite1.9.91_Premade.zip'
& $sevenZip x -y "-o$ex" $mainZip | Select-Object -Last 5
if ($LASTEXITCODE) { throw '7-Zip could not extract the multi-volume archive.' }
Remove-Item -LiteralPath $dl -Recurse -Force # the compressed parts are not needed once extracted

$managed = Get-ChildItem -LiteralPath $ex -Recurse -Directory -Filter 'Managed' |
    Where-Object { (Test-Path (Join-Path $_.FullName 'Assembly-CSharp.dll')) -and $_.Parent.Name -like 'rust_server_Data*' } |
    Select-Object -First 1
if (-not $managed) { throw "No rust_server_Data\Managed\Assembly-CSharp.dll found under $ex; check the archive layout." }
Write-Host "Found: $($managed.FullName)"

# --- Record every file's hash (text only) ---
$rows = foreach ($f in Get-ChildItem -LiteralPath $managed.FullName -File) {
    [pscustomobject]@{ Name = $f.Name; Size = $f.Length; Sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $f.FullName).Hash.ToLowerInvariant() }
}
$rows | Export-Csv -LiteralPath (Join-Path $out 'managed-files.csv') -NoTypeInformation -Encoding UTF8
$asmHash = ($rows | Where-Object Name -eq 'Assembly-CSharp.dll').Sha256
Write-Host "Assembly-CSharp.dll sha256 $asmHash"

# --- Probe (read-only: Mono.Cecil metadata only, never loads the assembly into a CLR) ---
$probeOut = Join-Path $out 'probe.txt'
& $patcherExe probe $managed.FullName *>&1 | Tee-Object -FilePath $probeOut
$probeExit = $LASTEXITCODE
Add-Content -LiteralPath $probeOut -Value "`nExit code: $probeExit"
Write-Host "Probe exit code: $probeExit (0 = every hook site matched)"

# --- Clean up the extracted package; nothing from it leaves this VM ---
Remove-Item -LiteralPath $ex -Recurse -Force
Remove-Item -LiteralPath $patcherExe -Force

$summary = @(
    "Fougerite premade server 1.9.91, probed $stamp"
    "Assembly-CSharp.dll: $asmHash"
    "Probe exit code: $probeExit"
    "$($rows.Count) files hashed in Managed\"
)
Set-Content -LiteralPath (Join-Path $out 'summary.txt') -Value $summary -Encoding UTF8
$summary | ForEach-Object { Write-Host $_ }

$zip = Join-Path $Root "fougerite-probe-$stamp.zip"
Compress-Archive -Path (Join-Path $out '*') -DestinationPath $zip -Force
Write-Host "Zip: $zip ($((Get-Item $zip).Length) bytes) sha256 $((Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant())"
if ($ContainerSasUrl) {
    $u = $ContainerSasUrl -split '\?', 2
    & curl.exe -fsS -X PUT -H 'x-ms-blob-type: BlockBlob' -H 'x-ms-version: 2021-08-06' -H 'Content-Type: application/zip' -T $zip ($u[0] + "/fougerite-probe-$stamp.zip?" + $u[1])
    if ($LASTEXITCODE) { throw "Upload failed (curl $LASTEXITCODE)." }
    Write-Host "Uploaded fougerite-probe-$stamp.zip."
}
