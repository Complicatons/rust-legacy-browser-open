<#
.SYNOPSIS
  VM only. Renders C:\RLB\config\gateway.json and sidecar.json from deploy\vm-test\config (only the server id is
  filled in), enrols the gateway with the host central service (node tools/gateway.mjs enrol, our code) and runs
  the config check. The server id and the 15-minute enrolment code come from the website's owner panel on the host:
  type them (-ServerId, -Code) or attach the handoff ISO (volume RLB_HANDOFF, handoff.json) built on the host.
  Dry run unless -Apply.
#>
param([string]$ServerId, [string]$Code, [switch]$Apply)
. (Join-Path $PSScriptRoot '_Common.ps1')
Assert-NotHost
$p = Get-RlbPaths
$s = Get-RlbSettings
if (-not $ServerId -or -not $Code) {
    $h = Find-RlbVolume $s.vm.handoffVolumeLabel
    if ($h -and (Test-Path -LiteralPath (Join-Path $h 'handoff.json'))) {
        $j = Get-Content -Raw -LiteralPath (Join-Path $h 'handoff.json') | ConvertFrom-Json
        if (-not $ServerId) { $ServerId = $j.serverId }
        if (-not $Code) { $Code = $j.enrolmentCode }
        Write-Host "Read server id/enrolment code from $h`handoff.json"
    }
}
if ($ServerId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { throw 'Give -ServerId <uuid from the owner panel> (or attach the handoff ISO).' }
if ($Code -notmatch '^[A-Za-z0-9_-]{20,64}$') { throw 'Give -Code <enrolment code from the owner panel> (or attach the handoff ISO).' }
$app = $p.App
Write-Plan 'Enrol the gateway with the host central service' @(
    "Write $($p.Config)\gateway.json and sidecar.json (serverId $ServerId)",
    "node $app\tools\gateway.mjs enrol (POST $($s.network.hostAddress):$($s.ports.central)/bridge/enrol; stores C:\RLB\secrets\gateway.credential)",
    "node $app\tools\gateway.mjs check (config + vm-test bind rules + TLS files)"
)
Confirm-OrExit $Apply.IsPresent 'Apply'
New-RlbDirs
foreach ($n in @('gateway', 'sidecar')) {
    $t = [IO.File]::ReadAllText((Join-Path $script:RlbDeployDir "config\$n.vm-test.json"))
    Write-RlbFileNoBom (Join-Path $p.Config "$n.json") $t.Replace('__SERVER_ID__', $ServerId)
}
$node = Get-NodeExe
Push-Location $app
try {
    & $node 'tools\gateway.mjs' 'enrol' (Join-Path $p.Config 'gateway.json') $Code
    if ($LASTEXITCODE -ne 0) { throw "enrol failed ($LASTEXITCODE). Is central running on the host and the code younger than 15 minutes?" }
    & $node 'tools\gateway.mjs' 'check' (Join-Path $p.Config 'gateway.json')
    if ($LASTEXITCODE -ne 0) { throw 'gateway config check failed (missing gateway-tls.pfx? run 09-New-GatewayCert.ps1).' }
} finally { Pop-Location }
Write-Host 'Gateway enrolled. Next: 11-Start-Bridge.ps1.' -ForegroundColor Green
