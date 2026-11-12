<#
.SYNOPSIS
  HOST. Builds the vanilla adapter DLL and a self-contained VanillaPatcher.exe (no .NET runtime needed in the VM)
  into build\vm-test\adapter, where tools\build-vm-iso.mjs picks them up.
   - dotnet build adapter\vanilla -c Release -p:RefDir=analysis\server-audit\rust_server_Data\Managed
     (the compiler only reads the server assemblies' metadata as references; nothing original is loaded or run)
   - dotnet publish tools\vanilla-patcher -c Release -r win-x64 --self-contained -p:PublishSingleFile=true
  Both need a NuGet restore, which DOWNLOADS packages from nuget.org (Mono.Cecil 0.11.6,
  Microsoft.NETFramework.ReferenceAssemblies.net35 1.0.3, the .NET 8 win-x64 runtime pack). It therefore runs only
  with -AllowNuGetRestore, an explicit owner decision.
#>
param([switch]$AllowNuGetRestore)
. (Join-Path $PSScriptRoot '_HostCommon.ps1')
$repo = $script:RlbRepo
$refDir = Join-Path $repo 'analysis\server-audit\rust_server_Data\Managed'
$out = Join-Path $repo 'build\vm-test\adapter'
Write-Plan 'Build adapter and patcher outputs' @(
    'NuGet restore (downloads from nuget.org): Mono.Cecil, net35 reference assemblies, .NET 8 win-x64 runtime pack',
    "dotnet build adapter\vanilla (references $refDir)",
    "dotnet publish tools\vanilla-patcher self-contained win-x64 single file -> $out\patcher",
    "Copy RustLegacyBrowser.Vanilla.dll -> $out"
)
Confirm-OrExit $AllowNuGetRestore.IsPresent 'AllowNuGetRestore'
if (-not (Test-Path -LiteralPath (Join-Path $refDir 'Assembly-CSharp.dll'))) { throw "Reference assemblies not found in $refDir." }
New-Item -ItemType Directory -Path (Join-Path $out 'patcher') -Force | Out-Null
& dotnet build (Join-Path $repo 'adapter\vanilla') -c Release "-p:RefDir=$refDir"
if ($LASTEXITCODE) { throw 'adapter build failed' }
& dotnet publish (Join-Path $repo 'tools\vanilla-patcher') -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o (Join-Path $out 'patcher')
if ($LASTEXITCODE) { throw 'patcher publish failed' }
Copy-Item -LiteralPath (Join-Path $repo 'adapter\vanilla\bin\Release\net35\RustLegacyBrowser.Vanilla.dll') -Destination $out -Force
Get-ChildItem -LiteralPath $out -Recurse -File | ForEach-Object { '{0}  {1}' -f (Get-Sha256 $_.FullName), $_.FullName.Substring($out.Length + 1) }
Write-Host 'Done. Rebuild the ISO: node tools\build-vm-iso.mjs' -ForegroundColor Green
