<#
.SYNOPSIS
  ON A THROWAWAY AZURE VM (own VNet, no inbound rules, deleted afterwards; never the game test VM or the owner's
  PC). Narrower follow-up to deploy/azure-test/scripts/30-Survey-Offshoots.ps1's Rustuj row, for
  OFFSHOOT-COMPATIBILITY-PLAN.md work item 1 ("Rustuj's server framework still unconfirmed"). The earlier survey's
  ILSpy full decompile of Rustuj's managed assemblies did not finish inside the time limit, and a separate static
  recon of an owner-supplied copy of the same client (analysis/rustuj-recon/2026-10-26-findings.md) found its
  managed assemblies have no ordinary MZ/PE header -- so a longer timeout on the same approach might not have
  helped anyway. This script skips full decompilation entirely and runs tools/rustuj-probe's RustujProbe.exe
  instead: Mono.Cecil metadata/IL reads only (type/method/field names, string literals), which is both far faster
  than ILSpy on a large assembly and, if the file really is a non-standard format, fails with a specific exception
  in milliseconds instead of hanging or running out of time.
  Self-contained: Run Command can send this file as its script with no kit update.
    1. downloads Rustuj's client package (the same public link as 30-Survey-Offshoots.ps1's rustuj-v6 row),
    2. downloads our already-built RustujProbe.exe (self-contained, published on the PC, uploaded as a kit blob by
       the coordinator; nothing is compiled on this VM -- no .NET SDK or ilspycmd install needed either),
    3. unpacks it with 7-Zip (administrative MSI extract, nothing installed) or innoextract,
    4. hashes every file, marks which managed assemblies differ from the stock 2015 client, and runs RustujProbe
       against every .dll/.exe (it reports readable-vs-unreadable and keyword hits itself; nothing here decides
       that in advance), plus pulls printable strings from non-stock native executables (same as 30's Get-Strings),
    5. zips text output (RustujProbe's report, file listing, strings, hits, this run's own log) to
       -Root\rustuj-probe-<time>.zip, then PUTs it to the container in -ContainerSasUrl (the `survey` container)
       if given -- always, even if an earlier step failed, so a crash's own log still comes back instead of
       looking identical to "still running".
  NOTHING DOWNLOADED IS EVER RUN: no game, launcher or updater from the package is started, and no assembly is
  loaded into a CLR for execution (RustujProbe only reads CLI metadata and IL with Mono.Cecil, same category of
  operation as tools/vanilla-patcher). Only RustujProbe's text output, file hashes and native strings leave this
  VM -- never any binary from the package. Elevated PowerShell (Run Command runs as SYSTEM). Dry run unless -Apply.

  -Detached: registers a one-shot SYSTEM Scheduled Task that re-runs this same script unattended and starts it,
  then returns immediately. A straight single-call run of this script against the real Rustuj package can run
  longer than Azure Run Command's own ~90-minute ceiling (2026-10-30: VMExtensionProvisioningTimeout, no output at
  all, nothing uploaded). The task does the real work on its own time and uploads its result zip itself when done,
  exactly like a foreground run would -- just not inside the Run Command that kicked it off. Needs -Apply, same as
  a direct run. The task reads its two SAS URLs from -SecretsFile instead of carrying them on its own command line
  (a Scheduled Task's action/arguments are stored in plain text in its XML definition, so nothing sensitive goes
  there) and deletes that file first thing; -Detached itself writes it into a folder whose ACL is locked to SYSTEM
  and Administrators only *before* anything is written into it. The task unregisters itself when it finishes,
  success or failure, so it doesn't linger on the VM.

  -ContainerSasB64 / -ProbeSasB64: the same two SAS URLs, base64-encoded, for a caller whose own path to this VM
  mangles a raw SAS in transit (az.cmd runs through cmd.exe, which cuts --protected-parameters at the first '&' in
  a SAS query string, 2026-10-30) -- decoded before anything else runs. Use these or the plain -ContainerSasUrl/
  -ProbeSasUrl, not both.
#>
param(
    [string]$ContainerSasUrl, [string]$ProbeSasUrl,
    [string]$ContainerSasB64, [string]$ProbeSasB64,
    [string]$Root = 'C:\RLB-rustuj',
    [switch]$Apply,
    [switch]$Detached,
    # Internal: set by a -Detached run's own re-invocation of itself, never passed by a human/caller directly.
    [string]$SecretsFile,
    [string]$TaskName
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if ($ContainerSasB64) { $ContainerSasUrl = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ContainerSasB64)) }
if ($ProbeSasB64) { $ProbeSasUrl = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ProbeSasB64)) }
# The detached task's own run gets its two SAS URLs here instead of on its command line (see -Detached above).
# Read and delete immediately, before anything else, so the secret's on-disk lifetime is as short as possible.
if ($SecretsFile) {
    if (-not (Test-Path -LiteralPath $SecretsFile)) { throw "-SecretsFile not found: $SecretsFile" }
    $secrets = Get-Content -LiteralPath $SecretsFile -Raw | ConvertFrom-Json
    Remove-Item -LiteralPath $SecretsFile -Force
    if ($secrets.ContainerSasUrl) { $ContainerSasUrl = $secrets.ContainerSasUrl }
    if ($secrets.ProbeSasUrl) { $ProbeSasUrl = $secrets.ProbeSasUrl }
}

# Same public link as 30-Survey-Offshoots.ps1's rustuj-v6 row.
$clientUrl = 'https://REPLACE-WITH-DOWNLOAD-URL/RustujV6.bin'
$clientFile = 'RustujV6.bin'
# Same stock-2015 hash set as 30-Survey-Offshoots.ps1, client half only (a file with one of these hashes is stock
# and gets no further attention -- it is already covered by our own reference copies).
$stock = @'
d079bdef29c07f8a27cc59d314e681162f31e1cef0d04bee09b276c41c00874f e5ffb59d29903aedaef526b36757a18f45ae4f24fc412def049b440917255b8f
021e83d87164f39036827c432326c48ab6fcddb18aac974c4cd2d62c09da9a7f 778ba027cb07118087232205a1925d8c9b3b689a635c23766a92cab3189298d0
754d695c07b28a7e5f3c55dfb1191aa04542356ca31e01346b2f6b5003baf9f5 a6190685790519bb1c12ba8ba8176ee1dba646fced76b83f9aa7c9fc43fa8070
04a33d3db0f23b84abc6ceafccd4d9133d23fb88d775cf1208a4e1839dd40d65 cb49ae57a63647b26762944cb9fceed4d055e85befc782790170f029fd7009d3
249ccd49dc275be04078bd1d4125f9c136ef06fbf1e14c0261827161ddd6bd60 825d8cfc1f26dacd2a43d3e818efb3622b6369f2c62241062c5bd1f65b8ca00e
0ce8917f335df01fdd6b464529e0481af7366d63ec88930881462fb0945762fe d26f63dc160b783028c38ec382447da22a9f63a666387eca3c5428f3762be7b8
67db1cf9de5ee122b8b1b1a4f391ef4503c2a137404098189576cd546f5e88fc f27ce4bd6d206ec329bd65ce66227dbfdc4f1192cca6c43aa6155d7a122d21d5
73c1306e8f60241262cbe92905fe0e7013e9d8f76516bef3b7adad26d52e467b 18881a540d03c3628bce8861d5134fa15391e272468bbe802ebbfc01b1bc956c
7b4974dd9bfe6b744ce9b27b65d879d95c0fbe9c200be4f6fe5794e4e5167cee ef47a9d3733f0061f1149f0cfbab583b5997ef04e611954700da2dcd4a0d978b
b6d2eac30623b12414b30f38ea785d0a8e067f98659df092a9947227b18121eb ce647058617eb548fe9867a8bf3cd4dc95e79d3af1c64f0de5005489935cbe35
b33b4fc1a58bbcac46945fd70d45fa57177442a8136a7ab82355df3461a84818 f5ebfeee825c3c55fdd5eaf991687556b100cb198f5a51c3139f44a61e39bf0b
dbeaa6b35a44f1acd53876c3a18e68614fd7726f02b2aba71937ce5958bd80d4 9ea75cff42d78369aa559473159c82e6f2a7bfe884ca0034cc89fe776981f16b
14dc8f5dfd721834387ece328b83b5b1fe988506e61700904a243113ef44ea16 5b9929d1ed25c0fb2144f655dc71933fca3c44dc8ed70012c36b046d7988de8d
3366ad9f9806fe74b1c7cc98c6ee662322d47cd9d9d884895655329570a539eb 628dda1e48ce5be6c2aa293a1cd40fde8ddac1d43b417341a7d5f2962b9aef93
90c29cf11cd5f966c29b31377a8e10e9e5c1f70ee2c3ee251356f96841fdc1e2 ff0985ac88b62e93e81748b1b312c1703e4dec4f94aa6a7d232a9776385811e7
b9aea75be34c5bf3660c7ccaa91a1cff95fde583f6e7d8638ed59573a1da8120 200edd7562e162f90bb75cccbc6369c05c90cd54defd2e96065a21c28b46fa85
00daaa0710187353794306815653ae931863ab0d2d0c68d1ef90de3d635691f1 73b646cb3376349579832b27cb685ce8c36723de5fcadc60d2c7768b83aa97d8
'@ -split '\s+' | Where-Object { $_ }
$stockSet = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($h in $stock) { [void]$stockSet.Add($h.ToLowerInvariant()) }
$skipNames = '^(mscorlib|System(\..+)?|Mono\..+|Boo\.Lang|UnityScript\.Lang|Google\.ProtocolBuffers(\..+)?|LitJSON)\.dll$'
$hitWords = 'SteamTicket|StartUserAuth|BeginAuth|AuthorisationRoutine|OnPlayerApproval|ReadConnectionData|Approve\(|Deny\(|Kick|HWID|HardwareId|MachineGuid|token|session|password|login|handshake|anticheat|anti-cheat|RustBuster|BAC|Luma|SteamID|whitelist|signature|https?://'

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$dl = Join-Path $Root 'download'; $ex = Join-Path $Root 'extract'; $tools = Join-Path $Root 'tools'; $out = Join-Path $Root "probe-$stamp"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$log = Join-Path $out 'run.log'
# Every line of progress (and any error) goes to this file too, which the final zip always includes -- on a
# -Detached run nothing else reports progress, so without this a crash partway looks identical to "still running".
function Write-Log([string]$msg) { Write-Host $msg; Add-Content -LiteralPath $log -Value "[$((Get-Date).ToUniversalTime().ToString('o'))] $msg" }

Write-Log "Rustuj probe -> $out"
Write-Log "  Client: $clientUrl"
Write-Log '  Tool: RustujProbe.exe (prebuilt on the PC, downloaded as a kit blob, not compiled here -- no .NET SDK/ilspycmd needed)'
Write-Log '  Nothing downloaded is run. Only RustujProbe text output, file hashes and native strings leave this VM.'
if (-not $Apply) { Write-Log 'Dry run. Re-run with -Apply.'; exit 0 }
if ($ContainerSasUrl -and $ContainerSasUrl -notmatch '^https://[a-z0-9]+\.blob\.core\.windows\.net/[a-z0-9-]+\?.*sig=') { throw '-ContainerSasUrl must be an https container SAS URL.' }
if (-not $ProbeSasUrl) { throw '-ProbeSasUrl is required: a read SAS to the RustujProbe.exe blob the coordinator uploaded.' }

# Under $ErrorActionPreference = 'Stop', PowerShell 5.1 turns a native tool's stderr output into a terminating
# error even on exit code 0 (e.g. a single benign warning while unpacking one large archive member). Every native
# call below runs through this so only $LASTEXITCODE decides success/failure, same convention as
# deploy/azure-test/pc/Publish-Kit.ps1's own Invoke-Native.
function Invoke-Native([scriptblock]$Block) { $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { & $Block } finally { $ErrorActionPreference = $old } }
function Get-File([string]$Url, [string]$Path) {
    Invoke-Native { & curl.exe -fsSL --retry 3 -A 'Mozilla/5.0' -o $Path $Url }
    if ($LASTEXITCODE) { throw "Download failed (curl $LASTEXITCODE): $Url" }
}
function Get-Strings([string]$Path, [string]$Dest) {
    if ((Get-Item -LiteralPath $Path).Length -gt 200MB) { Set-Content -LiteralPath $Dest -Value 'skipped: over 200 MB'; return }
    $bytes = [IO.File]::ReadAllBytes($Path)
    $ascii = [regex]::Matches([Text.Encoding]::ASCII.GetString($bytes), '[\x20-\x7E]{6,}') | ForEach-Object { $_.Value }
    $wide = [regex]::Matches([Text.Encoding]::Unicode.GetString($bytes), '[\x20-\x7E]{6,}') | ForEach-Object { $_.Value }
    @($ascii) + @($wide) | Select-Object -Unique | Set-Content -LiteralPath $Dest -Encoding UTF8
}

if ($Detached) {
    # Re-invoke this same script, without -Detached, as a one-shot SYSTEM Scheduled Task, and return right away.
    $secretsDir = Join-Path $Root 'secrets'
    if (Test-Path -LiteralPath $secretsDir) { Remove-Item -LiteralPath $secretsDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $secretsDir | Out-Null
    # Lock the ACL down to SYSTEM and Administrators BEFORE writing anything into it, so the SAS URLs are never
    # briefly world-readable; the task's own action/arguments (plain text in its XML) never carry them at all --
    # only this file's path, which is not sensitive on its own.
    Invoke-Native { & icacls.exe $secretsDir /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' }
    if ($LASTEXITCODE) { throw "icacls on $secretsDir failed (exit $LASTEXITCODE)." }
    $secretsPath = Join-Path $secretsDir "sas-$stamp.json"
    [pscustomobject]@{ ContainerSasUrl = $ContainerSasUrl; ProbeSasUrl = $ProbeSasUrl } | ConvertTo-Json | Set-Content -LiteralPath $secretsPath -Encoding UTF8
    $taskName = "RLBRustujProbe-$stamp"
    $taskArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-Root', $Root, '-SecretsFile', $secretsPath, '-TaskName', $taskName, '-Apply')
    $quoted = ($taskArgs | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $quoted
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 6)
    Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $taskName
    Write-Log "Started detached task '$taskName'; this Run Command returns now. It uploads rustuj-probe-$stamp.zip to -ContainerSasUrl on its own when done (run.log included either way); nothing else reports progress until then."
    exit 0
}

$errorMsg = $null
try {
    $freeGb = [math]::Round((Get-PSDrive ($Root.Substring(0, 1))).Free / 1GB, 1)
    if ($freeGb -lt 10) { throw "Only $freeGb GB free on $($Root.Substring(0, 2))." }
    New-Item -ItemType Directory -Force -Path $dl, $ex, $tools | Out-Null

    # --- 7-Zip / innoextract (official sources only) ---
    $sevenZip = Join-Path $tools '7z\Files\7-Zip\7z.exe'
    if (-not (Test-Path $sevenZip)) {
        $msi = Join-Path $tools '7z2408-x64.msi'; Get-File 'https://www.7-zip.org/a/7z2408-x64.msi' $msi
        Start-Process msiexec.exe -Wait -ArgumentList @('/a', "`"$msi`"", '/qn', "TARGETDIR=`"$(Join-Path $tools '7z')`"")
    }
    $inno = Join-Path $tools 'innoextract\innoextract.exe'
    if (-not (Test-Path $inno)) {
        $z = Join-Path $tools 'innoextract.zip'; Get-File 'https://constexpr.org/innoextract/files/innoextract-1.9-windows.zip' $z
        Expand-Archive -LiteralPath $z -DestinationPath (Join-Path $tools 'innoextract') -Force
    }

    # --- RustujProbe.exe and the client package ---
    $probeExe = Join-Path $Root 'RustujProbe.exe'
    Invoke-Native { & curl.exe -fsS --retry 3 -o $probeExe $ProbeSasUrl }
    if ($LASTEXITCODE) { throw "RustujProbe.exe download failed (curl $LASTEXITCODE)." }
    Write-Log "RustujProbe.exe: $((Get-Item $probeExe).Length) bytes sha256 $((Get-FileHash -Algorithm SHA256 -LiteralPath $probeExe).Hash.ToLowerInvariant())"

    $file = Join-Path $dl $clientFile
    Get-File $clientUrl $file
    $len = (Get-Item -LiteralPath $file).Length
    $sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant()
    $fs = [IO.File]::OpenRead($file); $buf = New-Object byte[] 512; $n = $fs.Read($buf, 0, 512); $fs.Close()
    $head = [Text.Encoding]::ASCII.GetString($buf, 0, $n)
    if ($head -match '<html|<!DOCTYPE') { throw "Got an HTML page instead of the package ($len bytes); the link needs a browser." }
    Write-Log "$clientFile`: $len bytes sha256 $sha"

    # --- Extract: try 7z first (zip/7z/rar), fall back to innoextract (Inno Setup installers) ---
    Invoke-Native { & $sevenZip x -y "-o$ex" $file | Out-Null }
    if ($LASTEXITCODE) { Invoke-Native { & $inno -s -d $ex $file | Out-Null }; if ($LASTEXITCODE) { throw '7-Zip and innoextract could not unpack it.' } }
    foreach ($inner in Get-ChildItem -LiteralPath $ex -Recurse -File -Include *.7z, *.zip, *.rar | Where-Object Length -gt 50MB) {
        Invoke-Native { & $sevenZip x -y "-o$($inner.FullName).d" $inner.FullName | Out-Null }
        # A failed inner extract (e.g. one oversized bundle 7z can't unpack) is logged and skipped, not fatal to the
        # whole survey -- the rest of the package's files still get hashed and probed.
        if ($LASTEXITCODE) { Write-Log "WARNING: inner extract failed (7z exit $LASTEXITCODE), skipping: $($inner.FullName)" }
    }

    # --- Hash every extracted file, run RustujProbe against every managed/native PE (it sorts that out itself) ---
    $rows = foreach ($f in Get-ChildItem -LiteralPath $ex -Recurse -File -Force) {
        $h = (Get-FileHash -Algorithm SHA256 -LiteralPath $f.FullName).Hash.ToLowerInvariant()
        [pscustomobject]@{ Path = $f.FullName.Substring($ex.Length + 1); Size = $f.Length; Sha256 = $h; Stock = $stockSet.Contains($h); Full = $f.FullName }
    }
    $rows | Select-Object Path, Size, Sha256, Stock | Export-Csv -LiteralPath (Join-Path $out 'files.csv') -NoTypeInformation -Encoding UTF8
    Write-Log "$(@($rows).Count) files, $(@($rows | Where-Object Stock).Count) match our stock hash set."

    $probeLog = Join-Path $out 'rustuj-probe.txt'
    Invoke-Native { & $probeExe $ex *>&1 | Tee-Object -FilePath $probeLog | Out-Host }
    Add-Content -LiteralPath $probeLog -Value "`nExit code: $LASTEXITCODE"

    # Native (non-PE-managed, non-stock) executables: pull strings too, same as 30-Survey-Offshoots.ps1.
    $nonStockPe = $rows | Where-Object { -not $_.Stock -and ($_.Path -match '\.(dll|exe)$') -and (Split-Path $_.Path -Leaf) -notmatch $skipNames }
    foreach ($f in $nonStockPe) {
        $safe = ($f.Path -replace '[\\/:]', '_')
        Get-Strings $f.Full (Join-Path $out "strings_$safe.txt")
    }
    $hits = Get-ChildItem -LiteralPath $out -Recurse -File -Include rustuj-probe.txt, strings_*.txt |
        Select-String -Pattern $hitWords -AllMatches | Select-Object -First 20000 |
        ForEach-Object { '{0}:{1}: {2}' -f $_.Path.Substring($out.Length + 1), $_.LineNumber, $_.Line.Trim().Substring(0, [math]::Min(300, $_.Line.Trim().Length)) }
    Set-Content -LiteralPath (Join-Path $out 'hits.txt') -Value $hits -Encoding UTF8
    Write-Log "$(@($hits).Count) keyword hits."

    # --- Clean up the extracted package; nothing from it leaves this VM ---
    Remove-Item -LiteralPath $ex -Recurse -Force
    Remove-Item -LiteralPath $dl -Recurse -Force
    Remove-Item -LiteralPath $probeExe -Force

    $summary = @("Rustuj client, probed $stamp", "${clientFile}: $len bytes sha256 $sha", "$(@($rows).Count) files, $(@($hits).Count) keyword hits")
    Set-Content -LiteralPath (Join-Path $out 'summary.txt') -Value $summary -Encoding UTF8
    $summary | ForEach-Object { Write-Log $_ }
} catch {
    $errorMsg = $_.Exception.Message
    Write-Log "ERROR: $errorMsg"
} finally {
    # Zip and upload whatever is in $out (including run.log), success or failure -- on a -Detached run nothing
    # else is watching, so a crash partway must not look identical to "still running".
    try {
        $zip = Join-Path $Root "rustuj-probe-$stamp.zip"
        Compress-Archive -Path (Join-Path $out '*') -DestinationPath $zip -Force
        Write-Log "Zip: $zip ($((Get-Item $zip).Length) bytes) sha256 $((Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant())"
        if ($ContainerSasUrl) {
            $u = $ContainerSasUrl -split '\?', 2
            Invoke-Native { & curl.exe -fsS -X PUT -H 'x-ms-blob-type: BlockBlob' -H 'x-ms-version: 2021-08-06' -H 'Content-Type: application/zip' -T $zip ($u[0] + "/rustuj-probe-$stamp.zip?" + $u[1]) }
            if ($LASTEXITCODE) { Write-Log "Upload failed (curl $LASTEXITCODE)." } else { Write-Log "Uploaded rustuj-probe-$stamp.zip." }
        }
    } catch { Write-Log "Zip/upload itself failed: $($_.Exception.Message)" }
    if ($TaskName) {
        # This one-shot task's job is done -- success or failure -- so it doesn't linger on the VM.
        try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue } catch {}
    }
}
if ($errorMsg) { throw $errorMsg }
