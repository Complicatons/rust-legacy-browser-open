<#
.SYNOPSIS
  HOST. Prepares the host-side central service for the VM test: state folder %LOCALAPPDATA%\RLB-vm-test (outside the
  repo, never committed), an Ed25519 signing key (node tools/central.mjs new-key), and central.json rendered from
  deploy\vm-test\config\central.vm-test.json (http on the host-only address 192.168.56.1:8080, console mail).
  Then runs `node tools/central.mjs check`. Dry run unless -Apply.
#>
param([switch]$Apply)
. (Join-Path $PSScriptRoot '_HostCommon.ps1')
$state = Expand-RlbPath $script:RlbSettings.host.stateDir
$keys = Join-Path $state 'keys'
Write-Plan 'Initialise host central' @(
    "Create $state and $keys",
    "If no signing key exists: node tools\central.mjs new-key $keys",
    "Write $state\central.json (database $state\central.db)",
    'node tools\central.mjs check'
)
Confirm-OrExit $Apply.IsPresent 'Apply'
$state = Get-HostStateDir
if (-not (Test-Path -LiteralPath $keys)) { New-Item -ItemType Directory -Path $keys | Out-Null }
$node = Get-NodeExe
Push-Location $script:RlbRepo
try {
    $key = @(Get-ChildItem -LiteralPath $keys -Filter 'signing-*.pem' -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not $key.Count) { & $node 'tools\central.mjs' 'new-key' $keys; if ($LASTEXITCODE) { throw 'new-key failed' }; $key = @(Get-ChildItem -LiteralPath $keys -Filter 'signing-*.pem' | Select-Object -First 1) }
    $fwd = { param($x) $x.Replace('\', '/') }
    $t = [IO.File]::ReadAllText((Join-Path $script:RlbDeployDir 'config\central.vm-test.json'))
    $t = $t.Replace('__STATE_DIR__', (& $fwd $state)).Replace('__SIGNING_KEY__', (& $fwd $key[0].FullName))
    $cfg = Join-Path $state 'central.json'
    [IO.File]::WriteAllText($cfg, $t, (New-Object Text.UTF8Encoding($false)))
    & $node 'tools\central.mjs' 'check' $cfg
    if ($LASTEXITCODE) { throw 'central config check failed' }
} finally { Pop-Location }
Write-Host "Host central ready: $cfg. Start it with Start-HostCentral.ps1." -ForegroundColor Green
