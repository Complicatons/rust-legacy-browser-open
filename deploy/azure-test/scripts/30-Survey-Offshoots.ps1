<#
.SYNOPSIS
  ON A THROWAWAY AZURE VM (rlb-survey-vm: own VNet, no inbound rules, deleted afterwards; never the game test VM
  or the owner's PC). Static survey of the Rust Legacy community clients and server mods (Rustuj, RustLegacy.eu,
  PlayRustLegacy, RustBuster), for OFFSHOOT-COMPATIBILITY-PLAN.md. Self-contained: Run Command can send this file as
  its script with no kit update.
    1. downloads each package into its own new folder under -Root (public links from each community's own page),
    2. unpacks it with 7-Zip (administrative MSI extract, nothing installed) or innoextract,
    3. hashes every file and marks the managed assemblies that differ from the stock 2015 client/server,
    4. decompiles only those with ILSpy's command line (needs the .NET LTS SDK, put in -Root\tools, not installed
       system-wide) and pulls printable strings out of the native executables that differ,
    5. greps the output for login/handshake/anti-cheat words and zips only text (listings, decompiled C#, strings,
       hits) to -Root\offshoot-survey-<time>.zip, then PUTs it to the container in -ContainerSasUrl (the separate `survey` container) if given.
  NOTHING DOWNLOADED IS EVER RUN: no game, launcher, updater or installer from these packages is started, and no
  assembly is loaded into a CLR. The only programs run are 7-Zip, innoextract, dotnet and ILSpy from their official
  sources. Elevated PowerShell (Run Command runs as SYSTEM). Dry run unless -Apply.
#>
param([string]$ContainerSasUrl, [string]$Root = 'C:\RLB-offshoots', [string[]]$Only, [switch]$Apply)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$packages = @(
    @{ Name = 'rustbuster-server'; File = 'RustBuster2016ServerRelease.zip'; Url = 'https://github.com/d3adwolf/rustlegacy/releases/download/v1.0/RustBuster2016ServerRelease.zip' }
    @{ Name = 'rustuj-v6'; File = 'RustujV6.bin'; Url = 'https://REPLACE-WITH-DOWNLOAD-URL/RustujV6.bin' }
    @{ Name = 'rustlegacy-eu-2015'; File = 'RustLegacy2015-Client.bin'; Url = 'https://www.rustlegacy.eu/manager/download-manager.php?file=RustLegacy2015-Client' }
    @{ Name = 'playrustlegacy-launcher'; File = 'playrustlegacy.exe'; Url = 'https://www.playrustlegacy.com/scarica/playrustlegacy.exe'; NoUnpack = $true }
)
if ($Only) { $packages = @($packages | Where-Object { $Only -contains $_.Name }) }

# SHA-256 of the stock 2015 client (rust_Data\Managed) and server (rust_server_Data\Managed) assemblies; a file with
# one of these hashes is stock and is not decompiled.
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
ce0dd83271472454fc27ce137a9fa9d042b3a5f12fb26f1c7a67d61eea3acfbb 0d358ee486aa2ccb509a7f94764a232c12e0450a5686704b474e18d7f33a8923
00daaa0710187353794306815653ae931863ab0d2d0c68d1ef90de3d635691f1 73b646cb3376349579832b27cb685ce8c36723de5fcadc60d2c7768b83aa97d8
bd900a7429a259c5fa3a780ac844d760ed0866236d8ac2c958291bbd30c6f723 5b0539b30599d758582b7ce9740bf1616cbb7c539acf460c3a4169466afe4bdd
'@ -split '\s+' | Where-Object { $_ }
$stockSet = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($h in $stock) { [void]$stockSet.Add($h.ToLowerInvariant()) }
# Facepunch/framework names that are never interesting even when their hash differs (Unity/Mono rebuilds).
$skipNames = '^(mscorlib|System(\..+)?|Mono\..+|Boo\.Lang|UnityScript\.Lang|Google\.ProtocolBuffers(\..+)?|LitJSON)\.dll$'
$hitWords = 'SteamTicket|StartUserAuth|BeginAuth|AuthorisationRoutine|OnPlayerApproval|ReadConnectionData|Approve\(|Deny\(|Kick|HWID|HardwareId|MachineGuid|token|session|password|login|handshake|anticheat|anti-cheat|RustBuster|BAC|Luma|SteamID|whitelist|signature|https?://'

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$tools = Join-Path $Root 'tools'
$out = Join-Path $Root "survey-$stamp"
Write-Host "Offshoot survey -> $out"
foreach ($pk in $packages) { Write-Host "  $($pk.Name): $($pk.Url)" }
Write-Host '  Tools: 7-Zip MSI (administrative extract), innoextract 1.9, .NET LTS SDK (dotnet-install.ps1, local), ilspycmd'
Write-Host '  Nothing downloaded is run. Upload: ' $(if ($ContainerSasUrl) { 'survey container (SAS not shown)' } else { 'none' })
if (-not $Apply) { Write-Host 'Dry run. Re-run with -Apply.' -ForegroundColor Yellow; exit 0 }
if ($ContainerSasUrl -and $ContainerSasUrl -notmatch '^https://[a-z0-9]+\.blob\.core\.windows\.net/[a-z0-9-]+\?.*sig=') { throw '-ContainerSasUrl must be an https container SAS URL.' }
$freeGb = [math]::Round((Get-PSDrive ($Root.Substring(0, 1))).Free / 1GB, 1)
if ($freeGb -lt 15) { throw "Only $freeGb GB free on $($Root.Substring(0, 2)); the packages need about 15 GB unpacked." }
New-Item -ItemType Directory -Force -Path $tools, $out | Out-Null

function Get-File([string]$Url, [string]$Path) {
    & curl.exe -fsSL --retry 3 -A 'Mozilla/5.0' -o $Path $Url
    if ($LASTEXITCODE) { throw "Download failed (curl $LASTEXITCODE): $Url" }
}
function Test-Managed([string]$Path) {
    # PE CLI header = data directory 14 (COM descriptor) is non-zero. Reads bytes only; nothing is loaded.
    try {
        $fs = [IO.File]::OpenRead($Path); $br = New-Object IO.BinaryReader($fs)
        try {
            if ($br.ReadUInt16() -ne 0x5A4D) { return $false }
            $fs.Position = 0x3C; $pe = $br.ReadInt32(); $fs.Position = $pe
            if ($br.ReadUInt32() -ne 0x4550) { return $false }
            $fs.Position = $pe + 24; $magic = $br.ReadUInt16()
            $fs.Position = $pe + 24 + $(if ($magic -eq 0x20B) { 112 } else { 96 }) + 14 * 8
            return ($br.ReadUInt32() -ne 0)
        } finally { $br.Close() }
    } catch { return $false }
}
function Get-Strings([string]$Path, [string]$Dest) {
    if ((Get-Item -LiteralPath $Path).Length -gt 200MB) { Set-Content -LiteralPath $Dest -Value 'skipped: over 200 MB'; return }
    $bytes = [IO.File]::ReadAllBytes($Path)
    $ascii = [regex]::Matches([Text.Encoding]::ASCII.GetString($bytes), '[\x20-\x7E]{6,}') | ForEach-Object { $_.Value }
    $wide = [regex]::Matches([Text.Encoding]::Unicode.GetString($bytes), '[\x20-\x7E]{6,}') | ForEach-Object { $_.Value }
    @($ascii) + @($wide) | Select-Object -Unique | Set-Content -LiteralPath $Dest -Encoding UTF8
}

# --- tools (official sources only) ---
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
$dotnet = Join-Path $tools 'dotnet\dotnet.exe'
if (-not (Test-Path $dotnet)) {
    $di = Join-Path $tools 'dotnet-install.ps1'; Get-File 'https://dot.net/v1/dotnet-install.ps1' $di
    & powershell -NoProfile -ExecutionPolicy Bypass -File $di -Channel LTS -InstallDir (Join-Path $tools 'dotnet') -NoPath | Out-Null
}
$env:DOTNET_ROOT = Join-Path $tools 'dotnet'; $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'; $env:DOTNET_NOLOGO = '1'
# ilspycmd may target an older runtime than the LTS SDK installed here.
$env:DOTNET_ROLL_FORWARD = 'Major'
$ilspy = Join-Path $tools 'ilspy\ilspycmd.exe'
if (-not (Test-Path $ilspy)) { & $dotnet tool install ilspycmd --tool-path (Join-Path $tools 'ilspy') | Out-Null }

$summary = New-Object System.Collections.Generic.List[string]
foreach ($pk in $packages) {
    $pkRoot = Join-Path $Root $pk.Name
    $dl = Join-Path $pkRoot 'download'; $ex = Join-Path $pkRoot 'extract'; $po = Join-Path $out $pk.Name
    New-Item -ItemType Directory -Force -Path $dl, $ex, $po | Out-Null
    $file = Join-Path $dl $pk.File
    try {
        if (-not (Test-Path $file)) { Get-File $pk.Url $file }
        $len = (Get-Item -LiteralPath $file).Length
        $sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant()
        $fs = [IO.File]::OpenRead($file); $buf = New-Object byte[] 512; $n = $fs.Read($buf, 0, 512); $fs.Close()
        $head = [Text.Encoding]::ASCII.GetString($buf, 0, $n)
        if ($head -match '<html|<!DOCTYPE') { throw "Got an HTML page instead of the package ($len bytes); the link needs a browser (copy the page to $po\download-page.html)." }
        $summary.Add("$($pk.Name): $($pk.File) $len bytes sha256 $sha")
        $scan = $ex
        if ($pk.NoUnpack) { Copy-Item -LiteralPath $file -Destination $ex -Force }
        elseif (-not (Get-ChildItem -LiteralPath $ex -Force | Select-Object -First 1)) {
            & $sevenZip x -y "-o$ex" $file | Out-Null
            if ($LASTEXITCODE) { & $inno -s -d $ex $file | Out-Null; if ($LASTEXITCODE) { throw '7-Zip and innoextract could not unpack it.' } }
            # An archive inside the archive (installer payload, .7z in a .zip): unpack one more level.
            foreach ($inner in Get-ChildItem -LiteralPath $ex -Recurse -File -Include *.7z, *.zip, *.rar | Where-Object Length -gt 50MB) {
                & $sevenZip x -y "-o$($inner.FullName).d" $inner.FullName | Out-Null
            }
        }
        $rows = foreach ($f in Get-ChildItem -LiteralPath $scan -Recurse -File -Force) {
            $h = (Get-FileHash -Algorithm SHA256 -LiteralPath $f.FullName).Hash.ToLowerInvariant()
            $rel = $f.FullName.Substring($scan.Length + 1)
            $isPe = $f.Extension -match '^\.(dll|exe)$'
            $managed = $isPe -and (Test-Managed $f.FullName)
            [pscustomobject]@{ Path = $rel; Size = $f.Length; Sha256 = $h; Managed = $managed; Stock = $stockSet.Contains($h); Full = $f.FullName; IsPe = $isPe }
        }
        $rows | Select-Object Path, Size, Sha256, Managed, Stock | Export-Csv -LiteralPath (Join-Path $po 'files.csv') -NoTypeInformation -Encoding UTF8
        $changed = @($rows | Where-Object { $_.IsPe -and -not $_.Stock -and $_.Path -notmatch '\\(Mono|MonoBleedingEdge)\\' -and (Split-Path $_.Path -Leaf) -notmatch $skipNames })
        $summary.Add("  $(@($rows).Count) files, $(@($rows | Where-Object Managed).Count) managed, $(@($rows | Where-Object Stock).Count) stock assemblies, $($changed.Count) non-stock executables/DLLs")
        foreach ($c in $changed) {
            $safe = ($c.Path -replace '[\\/:]', '_')
            if ($c.Managed) {
                $d = Join-Path $po "decompiled\$safe"
                New-Item -ItemType Directory -Force -Path $d | Out-Null
                & $ilspy $c.Full -o $d 2>&1 | Select-Object -Last 3 | ForEach-Object { $summary.Add("    ilspy $($c.Path): $_") }
                $summary.Add("    managed  $($c.Path) $($c.Size) $($c.Sha256)")
            } else {
                Get-Strings $c.Full (Join-Path $po "strings_$safe.txt")
                $summary.Add("    native   $($c.Path) $($c.Size) $($c.Sha256)")
            }
        }
        $hits = Get-ChildItem -LiteralPath $po -Recurse -File -Include *.cs, strings_*.txt |
            Select-String -Pattern $hitWords -AllMatches | Select-Object -First 20000 |
            ForEach-Object { '{0}:{1}: {2}' -f $_.Path.Substring($po.Length + 1), $_.LineNumber, $_.Line.Trim().Substring(0, [math]::Min(300, $_.Line.Trim().Length)) }
        Set-Content -LiteralPath (Join-Path $po 'hits.txt') -Value $hits -Encoding UTF8
        $summary.Add("  $(@($hits).Count) keyword hits")
    } catch {
        $summary.Add("$($pk.Name): FAILED $($_.Exception.Message)")
    }
}
Set-Content -LiteralPath (Join-Path $out 'summary.txt') -Value $summary -Encoding UTF8
$zip = Join-Path $Root "offshoot-survey-$stamp.zip"
# Text only leaves the VM: listings, decompiled C#, strings and hits. No binary from any package is in the zip.
Compress-Archive -Path (Join-Path $out '*') -DestinationPath $zip -Force
$summary | ForEach-Object { Write-Host $_ }
Write-Host "Zip: $zip ($((Get-Item $zip).Length) bytes) sha256 $((Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant())"
if ($ContainerSasUrl) {
    $u = $ContainerSasUrl -split '\?', 2
    & curl.exe -fsS -X PUT -H 'x-ms-blob-type: BlockBlob' -H 'x-ms-version: 2021-08-06' -H 'Content-Type: application/zip' -T $zip ($u[0] + "/offshoot-survey-$stamp.zip?" + $u[1])
    if ($LASTEXITCODE) { throw "Upload failed (curl $LASTEXITCODE)." }
    Write-Host "Uploaded offshoot-survey-$stamp.zip to the survey container."
}
