<#
.SYNOPSIS
  Prepares the central service (website, accounts, join tickets) for the host test: state in C:\RLB-host\central
  (closed to other users), an Ed25519 signing key (node tools/central.mjs new-key) and central.json rendered from
  deploy\host-test\config\central.host-test.json (http on 127.0.0.1:8080 only, console mail). Then runs
  `node tools/central.mjs check`. Our code only. Dry run unless -Apply.
#>
param([switch]$Apply, [switch]$Json)
. (Join-Path $PSScriptRoot '_Common.ps1')
$p = Get-RlbPaths
$keys = Join-Path $p.Central 'keys'
$cfg = Join-Path $p.Central 'central.json'
Write-Plan 'Initialise central (127.0.0.1:8080)' @(
    "Create $keys",
    "If no signing key exists: node tools\central.mjs new-key $keys",
    "Write $cfg (database $($p.Central)\central.db)",
    'node tools\central.mjs check'
)
Confirm-OrExit $Apply.IsPresent 'Apply'
New-RlbDirs
if (-not (Test-Path -LiteralPath $keys)) { New-Item -ItemType Directory -Path $keys | Out-Null }
$node = Get-NodeExe
Push-Location $script:RlbRepo
try {
    $key = @(Get-ChildItem -LiteralPath $keys -Filter 'signing-*.pem' -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not $key.Count) { & $node 'tools\central.mjs' 'new-key' $keys; if ($LASTEXITCODE) { throw 'new-key failed' }; $key = @(Get-ChildItem -LiteralPath $keys -Filter 'signing-*.pem' | Select-Object -First 1) }
    $t = [IO.File]::ReadAllText((Get-ConfigTemplate 'central.host-test.json'))
    $t = $t.Replace('__STATE_DIR__', (ConvertTo-FwdPath $p.Central)).Replace('__SIGNING_KEY__', (ConvertTo-FwdPath $key[0].FullName))
    Write-RlbFileNoBom $cfg $t
    & $node 'tools\central.mjs' 'check' $cfg
    if ($LASTEXITCODE) { throw 'central config check failed' }
} finally { Pop-Location }
Write-Host "Central ready: $cfg. Start it with 12-Start-Central.ps1 (its own window)." -ForegroundColor Green
