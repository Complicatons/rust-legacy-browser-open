<#
.SYNOPSIS
  Renders C:\RLB-host\config\gateway.json and sidecar.json from deploy\host-test\config (server id and repo paths
  filled in), enrols the gateway with central (node tools/gateway.mjs enrol, our code; stores
  C:\RLB-host\secrets\gateway.credential) and runs the config check. The server id and the 15-minute enrolment code
  come from the owner page (http://127.0.0.1:8080/owner) while central runs. Dry run unless -Apply.
#>
param([string]$ServerId, [string]$Code, [switch]$Apply, [switch]$Json)
. (Join-Path $PSScriptRoot '_Common.ps1')
$p = Get-RlbPaths
if ($ServerId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { throw 'Give -ServerId <uuid from the owner page>.' }
if ($Code -notmatch '^[A-Za-z0-9_-]{20,64}$') { throw 'Give -Code <enrolment code from the owner page>.' }
$gw = Join-Path $p.Config 'gateway.json'
Write-Plan 'Enrol the gateway with central' @(
    "Write $gw and $($p.Config)\sidecar.json (serverId $ServerId)",
    "node tools\gateway.mjs enrol (POST to the central URL in the config; stores $($p.Secrets)\gateway.credential)",
    'node tools\gateway.mjs check (config + TLS files)'
)
Confirm-OrExit $Apply.IsPresent 'Apply'
New-RlbDirs
foreach ($n in @('gateway', 'sidecar')) {
    $t = [IO.File]::ReadAllText((Get-ConfigTemplate "$n.host-test.json"))
    Write-RlbFileNoBom (Join-Path $p.Config "$n.json") $t.Replace('__SERVER_ID__', $ServerId).Replace('__REPO__', (ConvertTo-FwdPath $script:RlbRepo)).Replace('__ROOT__', (ConvertTo-FwdPath $p.Root))
}
$node = Get-NodeExe
Push-Location $script:RlbRepo
try {
    & $node 'tools\gateway.mjs' 'enrol' $gw $Code
    if ($LASTEXITCODE -ne 0) { throw "enrol failed ($LASTEXITCODE). Is central running (12-Start-Central.ps1) and the code younger than 15 minutes?" }
    & $node 'tools\gateway.mjs' 'check' $gw
    if ($LASTEXITCODE -ne 0) { throw 'gateway config check failed (missing gateway-tls.pfx? run 09-New-GatewayCert.ps1).' }
} finally { Pop-Location }
Write-Host 'Gateway enrolled (the endpoint of this server on the owner page must be the wss:// address of this gateway). Next: 14-Start-Bridge.ps1 -Apply.' -ForegroundColor Green
