<#
.SYNOPSIS
  ON A THROWAWAY AZURE VM (own VNet, no inbound rules, deleted afterwards; never the game test VM or the owner's
  PC). Runs a REAL check/patch/verify/restore round-trip (tools/vanilla-patcher) against a genuine Fougerite-patched
  Rust Legacy server's Assembly-CSharp.dll, for OFFSHOOT-COMPATIBILITY-PLAN.md work item 4's last step: "a VM round
  against the genuine Fougerite file for a final real-world probe/patch/verify pass."
  The admission hook (ConnectionAcceptor.uLink_OnPlayerApproval) was redesigned 2026-10-29/30 to build its own
  independent ClientConnection/BitStream copy at method entry instead of pattern-matching the method body, so it no
  longer depends on recognising Fougerite's own 4-instruction delegate shape. Proved against a from-scratch
  synthetic fixture (tools/vanilla-patcher/tests/fixture, tests/vanilla-patcher.test.mjs); this script is the real-
  world confirmation against the genuine file, whose hash is now allowlisted in tools/vanilla-patcher/Program.cs
  (sha256 c7d2af703c455a5726aca9d4945801e402a4d835128bcf9b5c333d5518f9ac2a).
  Self-contained: Run Command can send this file as its script with no kit update.
    1. downloads Fougerite's own "premade" server package (21-part zip, ~2.1 GB) straight from its public GitHub
       repo (github.com/Notulp/Fougerite, the project's real source, not a third party's bundled copy),
    2. downloads our already-built VanillaPatcher.exe and the adapter/vanilla RustLegacyBrowser.Vanilla.dll (both
       self-contained/prebuilt on the PC, uploaded as kit blobs by the coordinator; nothing is compiled on this VM;
       the adapter is built only against public Unity/uLink/Facepunch reference assembly shapes, never against
       anything of Fougerite's or the operator's own),
    3. unpacks the package with 7-Zip and finds rust_server_Data\Managed\,
    4. hashes every file in that folder (text listing only), confirms Assembly-CSharp.dll matches the allowlisted
       hash above (refuses to continue otherwise -- this script must never patch an unexpected file), copies the
       adapter DLL in beside it (check/patch refuse without it there, same as an operator's own install), then runs
       VanillaPatcher.exe check, patch, verify, then restore against it -- all Mono.Cecil metadata read/write only,
       the assembly is never loaded into a CLR or executed,
    5. zips every command's text output and the file listing (TEXT ONLY) to -Root\fougerite-patch-<time>.zip, then
       PUTs it to the container in -ContainerSasUrl if given.
  NOTHING DOWNLOADED IS EVER RUN: no server, launcher, updater or installer from the package is started, and no
  assembly is loaded into a CLR for execution. The package's binaries never leave this VM; only command text output
  and file hashes do. Elevated PowerShell (Run Command runs as SYSTEM). Dry run unless -Apply.
#>
param([string]$ContainerSasUrl, [string]$PatcherSasUrl, [string]$AdapterSasUrl, [string]$Root = 'C:\RLB-fougerite', [switch]$Apply)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ExpectedHash = 'C7D2AF703C455A5726ACA9D4945801E402A4D835128BCF9B5C333D5518F9AC2A'

# Fougerite's own public repo, OriginalRustServerFilesFougerite1.9.91_Premade: 20 x 100 MiB parts + a 13.9 MB .zip.
$repoRaw = 'https://raw.githubusercontent.com/Notulp/Fougerite/master/OriginalRustServerFilesFougerite1.9.91_Premade'
$parts = @((1..20 | ForEach-Object { 'OriginalRustServerFilesFougerite1.9.91_Premade.z{0:d2}' -f $_ }) + 'OriginalRustServerFilesFougerite1.9.91_Premade.zip')

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$dl = Join-Path $Root 'download'; $ex = Join-Path $Root 'extract'; $tools = Join-Path $Root 'tools'; $out = Join-Path $Root "patch-$stamp"
Write-Host "Fougerite real patch round -> $out"
Write-Host "  Package: $repoRaw (21 parts, ~2.1 GB total)"
Write-Host '  Patcher: VanillaPatcher.exe (prebuilt on the PC, downloaded as a kit blob, not compiled here)'
Write-Host "  Expects Assembly-CSharp.dll sha256 $ExpectedHash; refuses to patch anything else."
Write-Host '  Nothing downloaded is run. Only command text output and file hashes leave this VM.'
if (-not $Apply) { Write-Host 'Dry run. Re-run with -Apply.' -ForegroundColor Yellow; exit 0 }
if ($ContainerSasUrl -and $ContainerSasUrl -notmatch '^https://[a-z0-9]+\.blob\.core\.windows\.net/[a-z0-9-]+\?.*sig=') { throw '-ContainerSasUrl must be an https container SAS URL.' }
if (-not $PatcherSasUrl) { throw '-PatcherSasUrl is required: a read SAS to the VanillaPatcher.exe blob the coordinator uploaded.' }
if (-not $AdapterSasUrl) { throw "-AdapterSasUrl is required: a read SAS to the RustLegacyBrowser.Vanilla.dll blob the coordinator uploaded. check/patch refuse to run without the adapter sitting beside Assembly-CSharp.dll." }
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

# --- Record every file's hash (text only), and refuse to go further unless Assembly-CSharp.dll is the exact file
#     the fix was designed and allowlisted against ---
$rows = foreach ($f in Get-ChildItem -LiteralPath $managed.FullName -File) {
    [pscustomobject]@{ Name = $f.Name; Size = $f.Length; Sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $f.FullName).Hash.ToLowerInvariant() }
}
$rows | Export-Csv -LiteralPath (Join-Path $out 'managed-files.csv') -NoTypeInformation -Encoding UTF8
$asmHash = ($rows | Where-Object Name -eq 'Assembly-CSharp.dll').Sha256
Write-Host "Assembly-CSharp.dll sha256 $asmHash"
if ($asmHash.ToUpperInvariant() -ne $ExpectedHash) {
    throw "Assembly-CSharp.dll sha256 $asmHash does not match the allowlisted $ExpectedHash -- refusing to patch an unexpected file. (The package may have been updated upstream; re-run 31-Probe-Fougerite.ps1 first and get the owner's OK before allowlisting a new hash.)"
}

# --- Download the adapter DLL into the Managed folder, beside Assembly-CSharp.dll -- check/patch refuse to run
#     without it there (same convention as an operator's own install: the adapter sits next to the target). It is
#     built from adapter/vanilla against public Unity/uLink/Facepunch API shapes only (reference-only, nothing of
#     the operator's or Fougerite's own file goes into it), so shipping it to the VM carries nothing of theirs.
$adapterDll = Join-Path $managed.FullName 'RustLegacyBrowser.Vanilla.dll'
& curl.exe -fsS --retry 3 -o $adapterDll $AdapterSasUrl
if ($LASTEXITCODE) { throw "RustLegacyBrowser.Vanilla.dll download failed (curl $LASTEXITCODE)." }
Write-Host "RustLegacyBrowser.Vanilla.dll: $((Get-Item $adapterDll).Length) bytes sha256 $((Get-FileHash -Algorithm SHA256 -LiteralPath $adapterDll).Hash.ToLowerInvariant())"

# --- check / patch / verify / restore (Mono.Cecil metadata only; the assembly is never loaded into a CLR) ---
function Run-Patcher([string]$cmd) {
    $logPath = Join-Path $out "$cmd.txt"
    # Tee-Object's passthrough would otherwise join $exit in this function's own return value (making it an array,
    # so `-ne 0` below is always true regardless of the real exit code) -- Out-Host prints it live without that.
    & $patcherExe $cmd $managed.FullName *>&1 | Tee-Object -FilePath $logPath | Out-Host
    $exit = $LASTEXITCODE
    Add-Content -LiteralPath $logPath -Value "`nExit code: $exit"
    Write-Host "$cmd exit code: $exit"
    return $exit
}
$checkExit = Run-Patcher 'check'
if ($checkExit -ne 0) { throw "check failed (exit $checkExit); see $out\check.txt. Not attempting patch." }
$patchExit = Run-Patcher 'patch'
if ($patchExit -ne 0) { throw "patch failed (exit $patchExit); see $out\patch.txt." }
$verifyExit = Run-Patcher 'verify'
$restoreExit = Run-Patcher 'restore'

# --- Clean up the extracted package; nothing from it leaves this VM ---
Remove-Item -LiteralPath $ex -Recurse -Force
Remove-Item -LiteralPath $patcherExe -Force

$summary = @(
    "Fougerite premade server 1.9.91, real patch round $stamp"
    "Assembly-CSharp.dll: $asmHash"
    "check exit: $checkExit, patch exit: $patchExit, verify exit: $verifyExit, restore exit: $restoreExit"
    "$($rows.Count) files hashed in Managed\"
)
Set-Content -LiteralPath (Join-Path $out 'summary.txt') -Value $summary -Encoding UTF8
$summary | ForEach-Object { Write-Host $_ }

$zip = Join-Path $Root "fougerite-patch-$stamp.zip"
Compress-Archive -Path (Join-Path $out '*') -DestinationPath $zip -Force
Write-Host "Zip: $zip ($((Get-Item $zip).Length) bytes) sha256 $((Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant())"
if ($ContainerSasUrl) {
    $u = $ContainerSasUrl -split '\?', 2
    & curl.exe -fsS -X PUT -H 'x-ms-blob-type: BlockBlob' -H 'x-ms-version: 2021-08-06' -H 'Content-Type: application/zip' -T $zip ($u[0] + "/fougerite-patch-$stamp.zip?" + $u[1])
    if ($LASTEXITCODE) { throw "Upload failed (curl $LASTEXITCODE)." }
    Write-Host "Uploaded fougerite-patch-$stamp.zip."
}
if ($verifyExit -ne 0) { throw "verify reported incomplete (exit $verifyExit); see $out\verify.txt. check/patch output still uploaded for diagnosis." }
