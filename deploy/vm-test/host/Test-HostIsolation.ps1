<#
.SYNOPSIS
  HOST. Checks from the outside that the test VM is isolated:
   1. Reads the VM's .vmx (text) and checks: one network adapter, host-only (VMnet1); shared folders, copy/paste,
      drag-and-drop, Unity, VNC, USB, serial/parallel/floppy off; export disk independent-persistent (info).
   2. Host VMnet1 adapter has 192.168.56.1/24, IP forwarding off on it, no default gateway on it.
   3. Pings the VM (expect a reply once 01-Configure-Guest.ps1 allowed ICMP from the host).
   4. With -CaptureSeconds N -ConfirmCapture and Wireshark installed: records N seconds on VMnet1 with dumpcap into
      %LOCALAPPDATA%\RLB-vm-test\captures and analyses it with tshark. Expectation: every packet from the VM goes to
      192.168.56.0/24 (or broadcast/multicast); no DNS queries answered; anything else is listed as a finding.
  Use -AnalyseCapture <file.pcapng> to analyse an existing capture (e.g. one recorded during P1).
#>
param([string]$VmxPath, [int]$CaptureSeconds = 0, [switch]$ConfirmCapture, [string]$AnalyseCapture)
. (Join-Path $PSScriptRoot '_HostCommon.ps1')
$s = Get-RlbSettings
$results = New-Object System.Collections.Generic.List[object]
function Add-Check([string]$Check, [string]$Status, [string]$Detail) { $results.Add([pscustomobject]@{ Check = $Check; Status = $Status; Detail = $Detail }) }

function Test-InSubnet([string]$ip) {
    if ($ip -notmatch '^d+.d+.d+.d+$') { return $false }
    $parts = $s.network.subnet.Split('/'); $block = [math]::Pow(2, 32 - [int]$parts[1])
    $toNum = { param($a) $o = $a.Split('.'); [double]$o[0] * 16777216 + [double]$o[1] * 65536 + [double]$o[2] * 256 + [double]$o[3] }
    return [math]::Floor((& $toNum $ip) / $block) -eq [math]::Floor((& $toNum $parts[0]) / $block)
}

Write-Plan 'Host-side isolation check' @(
    $(if ($VmxPath) { "Read $VmxPath (text only)" } else { 'Skip .vmx checks (give -VmxPath <VM>.vmx)' }),
    'Check the host-only adapter, forwarding and routes',
    "Ping $($s.network.vmAddress)",
    $(if ($CaptureSeconds -gt 0) { "Capture $CaptureSeconds s on VMnet1 with dumpcap (needs -ConfirmCapture) and analyse with tshark" } elseif ($AnalyseCapture) { "Analyse $AnalyseCapture with tshark" } else { 'No capture (use -CaptureSeconds 120 -ConfirmCapture)' })
)

if ($VmxPath) {
    $vmx = @{}
    foreach ($line in Get-Content -LiteralPath $VmxPath) { if ($line -match '^\s*([^=]+?)\s*=\s*"(.*)"\s*$') { $vmx[$Matches[1].ToLowerInvariant()] = $Matches[2] } }
    $get = { param($k) if ($vmx.ContainsKey($k)) { $vmx[$k] } else { $null } }
    $nics = @($vmx.Keys | Where-Object { $_ -match '^ethernet(\d+)\.present$' -and $vmx[$_] -eq 'TRUE' })
    if ($nics.Count -eq 1) { Add-Check 'one virtual NIC' 'PASS' $nics[0] } else { Add-Check 'one virtual NIC' 'FAIL' ("{0} present: {1}" -f $nics.Count, ($nics -join ', ')) }
    foreach ($n in $nics) {
        $id = $n.Split('.')[0]
        $type = & $get "$id.connectiontype"; $vnet = & $get "$id.vnet"
        if ($type -eq 'hostonly' -or ($type -eq 'custom' -and $vnet -match 'VMnet1$')) { Add-Check "$id host-only" 'PASS' ("connectionType={0} vnet={1}" -f $type, $vnet) }
        else { Add-Check "$id host-only" 'FAIL' ("connectionType={0} vnet={1} (must be hostonly / VMnet1; never nat or bridged)" -f $type, $vnet) }
    }
    $want = [ordered]@{
        'isolation.tools.hgfs.disable' = 'TRUE'; 'isolation.tools.copy.disable' = 'TRUE'; 'isolation.tools.paste.disable' = 'TRUE'
        'isolation.tools.dnd.disable' = 'TRUE'; 'isolation.tools.unity.disable' = 'TRUE'
    }
    foreach ($k in $want.Keys) { $v = & $get $k; if ($v -eq $want[$k]) { Add-Check $k 'PASS' $v } else { Add-Check $k 'FAIL' ("is '{0}', want {1}" -f $v, $want[$k]) } }
    $shared = @($vmx.Keys | Where-Object { $_ -match '^sharedfolder\d+\.enabled$' -and $vmx[$_] -eq 'TRUE' })
    if ($shared.Count) { Add-Check 'no enabled shared folders' 'FAIL' ($shared -join ', ') } else { Add-Check 'no enabled shared folders' 'PASS' 'none' }
    foreach ($k in @('usb.present', 'usb_xhci.present', 'ehci.present', 'serial0.present', 'parallel0.present', 'floppy0.present', 'remotedisplay.vnc.enabled', 'vmci0.unrestricted')) {
        $v = & $get $k; if ($v -eq 'TRUE') { Add-Check "$k off" 'FAIL' 'TRUE' } else { Add-Check "$k off" 'PASS' $(if ($v) { $v } else { 'absent' }) }
    }
    $indep = @($vmx.Keys | Where-Object { $_ -match '\.mode$' -and $vmx[$_] -eq 'independent-persistent' })
    if ($indep.Count) { Add-Check 'export disk independent-persistent' 'PASS' ($indep -join ', ') } else { Add-Check 'export disk independent-persistent' 'WARN' 'no independent-persistent disk: exports would be lost on snapshot revert' }
}

$a = Get-HostOnlyAdapter
if ($a -and $a.PrefixLength -eq $s.network.prefixLength) { Add-Check 'host-only address' 'PASS' ("{0}/{1} on {2}" -f $a.IPAddress, $a.PrefixLength, $a.InterfaceAlias) }
else { Add-Check 'host-only address' 'FAIL' "no host adapter with $($s.network.hostAddress)/$($s.network.prefixLength)" }
if ($a) {
    $ipif = Get-NetIPInterface -InterfaceIndex $a.InterfaceIndex -AddressFamily IPv4
    if ($ipif.Forwarding -eq 'Disabled') { Add-Check 'no IP forwarding on host-only adapter' 'PASS' 'Disabled' } else { Add-Check 'no IP forwarding on host-only adapter' 'FAIL' 'Forwarding enabled (could route the VM out)' }
    $gw = @(Get-NetRoute -InterfaceIndex $a.InterfaceIndex -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue)
    if ($gw.Count) { Add-Check 'no default route via host-only adapter' 'FAIL' 'found' } else { Add-Check 'no default route via host-only adapter' 'PASS' 'none' }
    $ics = Get-Service SharedAccess -ErrorAction SilentlyContinue
    if ($ics -and $ics.Status -eq 'Running') { Add-Check 'Internet Connection Sharing service' 'WARN' 'running: make sure no adapter shares its connection with VMnet1' } else { Add-Check 'Internet Connection Sharing service' 'PASS' 'not running' }
}
if (Test-Connection -ComputerName $s.network.vmAddress -Count 2 -Quiet -ErrorAction SilentlyContinue) { Add-Check 'VM answers ping' 'PASS' $s.network.vmAddress } else { Add-Check 'VM answers ping' 'WARN' 'no reply (VM off, or 01-Configure-Guest.ps1 not applied)' }

$state = Get-HostStateDir
$capDir = Join-Path $state 'captures'; if (-not (Test-Path -LiteralPath $capDir)) { New-Item -ItemType Directory -Path $capDir | Out-Null }
if ($CaptureSeconds -gt 0) {
    if (-not $ConfirmCapture) { Write-Host 'Capture requested: add -ConfirmCapture to record on VMnet1.' -ForegroundColor Yellow }
    else {
        $dumpcap = Find-WiresharkTool 'dumpcap.exe'; if (-not $dumpcap) { throw 'Wireshark (dumpcap.exe) is not installed on the host.' }
        $line = @(& $dumpcap -D | Where-Object { $_ -match 'VMnet1' }) | Select-Object -First 1
        if (-not $line -or $line -notmatch '^(\d+)\.') { throw 'dumpcap does not list a VMnet1 interface (Npcap installed?).' }
        $AnalyseCapture = Join-Path $capDir ("host-vmnet1-{0}.pcapng" -f (Get-Stamp))
        Write-Host "Capturing $CaptureSeconds s on VMnet1 -> $AnalyseCapture. Generate traffic in the VM now (00-Test-Isolation.ps1 tries the outside)."
        & $dumpcap -i $Matches[1] -a "duration:$CaptureSeconds" -w $AnalyseCapture -q
    }
}
if ($AnalyseCapture) {
    $tshark = Find-WiresharkTool 'tshark.exe'; if (-not $tshark) { throw 'tshark.exe not found (Wireshark).' }
    $rows = & $tshark -r $AnalyseCapture -T fields -E separator=';' -e ip.src -e ip.dst -e ipv6.src -e ipv6.dst -e arp.dst.proto_ipv4 -e dns.qry.name -e _ws.col.Protocol 2>$null
    $findings = @{}; $count = 0
    foreach ($r in $rows) {
        $count++
        $f = $r.Split(';')
        $src = $f[0]; $dst = $f[1]; $v6src = $f[2]; $v6dst = $f[3]; $arp = $f[4]; $dns = $f[5]; $proto = $f[6]
        if ($src -eq $s.network.vmAddress -and $dst -and -not (Test-InSubnet $dst) -and $dst -notmatch '^(22[4-9]|23\d)\.' -and $dst -ne '255.255.255.255') { $findings["VM -> $dst ($proto)"] = 1 + [int]$findings["VM -> $dst ($proto)"] }
        if ($arp -and -not (Test-InSubnet $arp)) { $findings["ARP for $arp"] = 1 + [int]$findings["ARP for $arp"] }
        if ($dns) { $findings["DNS query $dns"] = 1 + [int]$findings["DNS query $dns"] }
        if ($v6src -and $v6src -notmatch '^fe80:' -and $v6dst -notmatch '^ff0') { $findings["IPv6 $v6src -> $v6dst"] = 1 + [int]$findings["IPv6 $v6src -> $v6dst"] }
    }
    if ($findings.Count) { Add-Check 'capture: VM traffic stays in subnet' 'FAIL' (($findings.GetEnumerator() | ForEach-Object { "$($_.Key) x$($_.Value)" }) -join '; ') }
    else { Add-Check 'capture: VM traffic stays in subnet' 'PASS' "$count packets, nothing addressed outside $($s.network.subnet)" }
    Write-Host 'Note: the VM has no route out, so attempts to reach the outside usually show only as missing traffic or ARP/DNS attempts; each one listed above is worth a look.'
}
$results | Format-Table -AutoSize | Out-String -Width 220 | Write-Host
$report = Join-Path $state ("host-isolation-{0}.json" -f (Get-Stamp))
$results | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $report
Write-Host "Report: $report"
if (@($results | Where-Object { $_.Status -eq 'FAIL' }).Count) { Write-Host 'HOST-SIDE ISOLATION FAILED.' -ForegroundColor Red; exit 1 }
Write-Host 'Host-side isolation OK.' -ForegroundColor Green
