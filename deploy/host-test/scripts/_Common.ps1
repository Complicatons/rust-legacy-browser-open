# Shared helpers for the host-test scripts (dot-sourced; Windows PowerShell 5.1 compatible).
# These run on the owner's own PC, started by the owner. Every script prints its plan and changes nothing without
# its confirm switch. Only 05-Start-Server.ps1 executes an original binary, and only as the locked-down test account.
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

$script:RlbScriptsDir = $PSScriptRoot
$script:RlbDeployDir = Split-Path -Parent $PSScriptRoot
$script:RlbSettings = Get-Content -Raw -LiteralPath (Join-Path $script:RlbDeployDir 'settings.json') | ConvertFrom-Json
$script:RlbRepo = (Resolve-Path (Join-Path $script:RlbDeployDir '..\..')).Path

# -Json, for the host app's setup wizard (host/wizard.mjs): a script that declares [switch]$Json also prints
# '##rlb {...}' lines beside its usual output (its plan, needs-admin, its result). Without -Json nothing changes.
$script:RlbJson = [bool](Get-Variable -Name Json -Scope Local -ValueOnly -ErrorAction SilentlyContinue)
if ($script:RlbJson) { try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false) } catch { } }
function Write-RlbJson([hashtable]$Data) { if ($script:RlbJson) { Write-Host ('##rlb ' + (ConvertTo-Json -InputObject $Data -Compress -Depth 4)) } }
# The step's outcome for the wizard: PASS, WARN or FAIL, or the worst of -Rows (Check/Status/Detail, as Test-RlbLockdown).
function Write-RlbResult {
    param([string]$Status, [string]$Detail = '', [object[]]$Rows = @())
    if (-not $Status) { $Status = if (@($Rows | Where-Object { $_.Status -eq 'FAIL' }).Count) { 'FAIL' } elseif (@($Rows | Where-Object { $_.Status -eq 'WARN' }).Count) { 'WARN' } else { 'PASS' } }
    Write-RlbJson @{ type = 'result'; status = $Status; detail = $Detail; rows = @($Rows | ForEach-Object { @{ check = $_.Check; status = $_.Status; detail = $_.Detail } }) }
}

function Get-RlbSettings { return $script:RlbSettings }

function Get-RlbPaths {
    # RLB_HOST_TEST_ROOT: only for exercising the scripts in a scratch folder (never with the original server).
    $root = if ($env:RLB_HOST_TEST_ROOT) { $env:RLB_HOST_TEST_ROOT } else { $script:RlbSettings.root }
    return [pscustomobject]@{
        Root       = $root
        Server     = Join-Path $root 'server'
        Original   = Join-Path $root 'server\original'
        TestCopy   = Join-Path $root 'server\test'
        Quarantine = Join-Path $root 'quarantine'
        Manifests  = Join-Path $root 'manifests'
        Secrets    = Join-Path $root 'secrets'
        Captures   = Join-Path $root 'captures'
        Run        = Join-Path $root 'run'
        Export     = Join-Path $root 'export'
        Config     = Join-Path $root 'config'
        Data       = Join-Path $root 'data'
        Logs       = Join-Path $root 'logs'
        Central    = Join-Path $root 'central'
        Browser    = Join-Path $root 'browser-profile'
    }
}

function Get-NodeExe {
    $n = Get-Command node.exe -ErrorAction SilentlyContinue
    # A PowerShell window opened before Node was installed has an old PATH: fall back to the standard install folder.
    if (-not $n) { $d = Join-Path $env:ProgramFiles 'nodejs\node.exe'; if (Test-Path -LiteralPath $d) { return $d }; throw 'node.exe not found on PATH or in Program Files\nodejs.' }
    return $n.Source
}

function Write-RlbFileNoBom([string]$Path, [string]$Text) {
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}

# Config template: <root>\config-templates\<name> when present (written by deploy\azure-test\scripts\01-Set-AzureConfig.ps1
# for a cloud VM), otherwise the shipped loopback template in deploy\host-test\config.
function Get-ConfigTemplate([string]$Name) {
    $override = Join-Path (Get-RlbPaths).Root "config-templates\$Name"
    if (Test-Path -LiteralPath $override) { return $override }
    return Join-Path $script:RlbDeployDir "config\$Name"
}

# True for 127.0.0.1, or a private IPv4 address that belongs to this machine (cloud VM private address).
function Test-LocalListenAddress([string]$Address) {
    if ($Address -eq '127.0.0.1') { return $true }
    if ($Address -notmatch '^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)') { return $false }
    return [bool](Get-NetIPAddress -AddressFamily IPv4 -IPAddress $Address -ErrorAction SilentlyContinue)
}

# Repo-relative paths for our own Node tools; forward slashes for JSON configs.
function ConvertTo-FwdPath([string]$Path) { return $Path.Replace('\', '/') }

function Write-Plan {
    param([string]$Title, [string[]]$Steps, [switch]$RunsOriginalBinaries, [switch]$ChangesSecurity)
    Write-Host ''
    Write-Host "== $Title ==" -ForegroundColor Cyan
    Write-Host 'This script will:'
    $i = 1
    foreach ($s in $Steps) { Write-Host ("  {0}. {1}" -f $i, $s); $i++ }
    if ($ChangesSecurity) {
        Write-Host ''
        Write-Host '  !! This changes Windows security settings (accounts, firewall or folder permissions) on THIS PC.' -ForegroundColor Yellow
        Write-Host '  !! 99-Remove.ps1 undoes it.' -ForegroundColor Yellow
    }
    if ($RunsOriginalBinaries) {
        Write-Host ''
        Write-Host '  !! This EXECUTES THE ORIGINAL SERVER on this PC, as the locked-down test account.' -ForegroundColor Yellow
        Write-Host '  !! Only continue if 04-Test-Isolation.ps1 passed and Process Monitor is recording.' -ForegroundColor Yellow
    }
    Write-Host ''
    Write-RlbJson @{ type = 'plan'; title = $Title; steps = @($Steps); changesSecurity = $ChangesSecurity.IsPresent; runsOriginalBinaries = $RunsOriginalBinaries.IsPresent; elevated = (Test-IsAdmin) }
}

function Confirm-OrExit {
    param([bool]$Confirmed, [string]$SwitchName)
    if (-not $Confirmed) {
        Write-Host "Dry run only. Nothing was changed. Re-run with -$SwitchName to perform the steps above." -ForegroundColor Yellow
        exit 0
    }
}

function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-Admin {
    if (-not (Test-IsAdmin)) { Write-RlbJson @{ type = 'needs-admin' }; throw 'Run this script from an elevated PowerShell (Run as administrator).' }
}

function New-RlbDirs {
    $p = Get-RlbPaths
    foreach ($d in @($p.Root, $p.Server, $p.Quarantine, $p.Manifests, $p.Secrets, $p.Captures, $p.Run, $p.Export, $p.Config, $p.Data, $p.Logs, $p.Central)) {
        if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d | Out-Null }
    }
}

function Get-Stamp { return (Get-Date).ToString('yyyyMMdd-HHmmss') }

function Get-Sha256([string]$Path) { return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToUpperInvariant() }

function Get-TestAccount {
    return Get-LocalUser -Name $script:RlbSettings.account -ErrorAction SilentlyContinue
}

function Get-TestAccountSid {
    $u = Get-TestAccount
    if (-not $u) { throw "Test account $($script:RlbSettings.account) does not exist (run 01-New-ServerAccount.ps1)." }
    return $u.SID.Value
}

function Test-TestAccountIsStandard {
    # True when the account is in no group other than Users (no Administrators, Remote Desktop Users, etc.).
    $name = $script:RlbSettings.account
    $groups = @()
    foreach ($g in Get-LocalGroup) {
        $m = @(Get-LocalGroupMember -Group $g -ErrorAction SilentlyContinue | Where-Object { $_.Name -match ('\\' + [regex]::Escape($name) + '$') })
        if ($m.Count) { $groups += $g.Name }
    }
    return [pscustomobject]@{ Standard = (@($groups | Where-Object { $_ -ne 'Users' }).Count -eq 0); Groups = $groups }
}

function Read-Secret([string]$Name) {
    $f = Join-Path (Get-RlbPaths).Secrets $Name
    if (-not (Test-Path -LiteralPath $f)) { throw "Missing secret $f (run 02-Prepare-Server.ps1)." }
    return (Get-Content -Raw -LiteralPath $f).Trim()
}

function New-RandomPassword([int]$Length) {
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
    $b = New-Object byte[] ($Length * 2)
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($b); $rng.Dispose()
    $out = ''
    foreach ($x in $b) { if ($x -lt (256 - (256 % $alphabet.Length))) { $out += $alphabet[$x % $alphabet.Length] }; if ($out.Length -eq $Length) { break } }
    return $out
}

function Get-FirewallRules {
    return @(Get-NetFirewallRule -Group $script:RlbSettings.firewallGroup -ErrorAction SilentlyContinue)
}

function Get-ProcmonExe([string]$Override) {
    $path = if ($Override) { $Override } else { [Environment]::ExpandEnvironmentVariables($script:RlbSettings.procmon.exe) }
    return $path
}

# The shipped "Run Server.bat" arguments as one command line (paths ending in / are quoted, as the .bat does).
function Get-ServerArgLine {
    return ($script:RlbSettings.server.args | ForEach-Object { if ($_ -match '[\s/]$|\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
}

# Scheduled tasks registered by 17-Register-ServerTask.ps1: the server itself (on demand, as the test account with its
# stored password) and an optional boot task (SYSTEM) that runs 05-Start-Server.ps1 -ViaTask after the VM starts.
$script:RlbServerTask = 'RLB-OriginalServer'
$script:RlbBootTask = 'RLB-OriginalServer-AtBoot'
function Get-ServerTaskName { return $script:RlbServerTask }
function Get-BootTaskName { return $script:RlbBootTask }

# Problems with the server task, empty when it runs exactly rust_server.exe + the shipped arguments in the test copy,
# as the standard test account (stored password, not elevated). 05 -ViaTask refuses on any.
function Test-ServerTask {
    $s = $script:RlbSettings
    $p = Get-RlbPaths
    $t = Get-ScheduledTask -TaskName $script:RlbServerTask -ErrorAction SilentlyContinue
    if (-not $t) { return ,@("scheduled task $($script:RlbServerTask) missing (17-Register-ServerTask.ps1 -Apply)") }
    $bad = @()
    $a = @($t.Actions)
    $exe = Join-Path $p.TestCopy $s.server.exe
    if ($a.Count -ne 1 -or $a[0].Execute -ne $exe -or $a[0].Arguments -ne (Get-ServerArgLine) -or $a[0].WorkingDirectory -ne $p.TestCopy) { $bad += "task action is not $exe $(Get-ServerArgLine) in $($p.TestCopy)" }
    if (($t.Principal.UserId -split '\\')[-1] -ne $s.account) { $bad += "task runs as $($t.Principal.UserId), not $($s.account)" }
    if ("$($t.Principal.LogonType)" -ne 'Password') { $bad += "task logon type $($t.Principal.LogonType), not Password" }
    if ("$($t.Principal.RunLevel)" -ne 'Limited') { $bad += "task run level $($t.Principal.RunLevel), not Limited" }
    $u = Get-TestAccount
    if ($u) {
        $rights = Get-AccountRights $u.SID.Value
        if ($rights -notcontains 'SeBatchLogonRight') { $bad += "$($s.account) lacks 'Log on as a batch job' (SeBatchLogonRight; 17-Register-ServerTask.ps1 -Apply grants it)" }
        if ($rights -contains 'SeDenyBatchLogonRight') { $bad += "$($s.account) is denied batch logon (SeDenyBatchLogonRight)" }
    }
    return ,$bad
}

# Local security policy user rights through LSA (advapi32). Register-ScheduledTask does not grant the
# "Log on as a batch job" right a stored-password task needs (only the Task Scheduler UI does): without it the task
# never starts (LastTaskResult 267011, found on the Azure VM 2026-10-22).
if (-not ('RlbLsa' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class RlbLsa {
    [StructLayout(LayoutKind.Sequential)] struct LsaString { public ushort Length; public ushort MaximumLength; public IntPtr Buffer; }
    [StructLayout(LayoutKind.Sequential)] struct LsaAttributes { public int Length; public IntPtr RootDirectory; public IntPtr ObjectName; public int Attributes; public IntPtr SecurityDescriptor; public IntPtr SecurityQualityOfService; }
    [DllImport("advapi32.dll")] static extern uint LsaOpenPolicy(IntPtr system, ref LsaAttributes attributes, int access, out IntPtr policy);
    [DllImport("advapi32.dll")] static extern uint LsaAddAccountRights(IntPtr policy, byte[] sid, LsaString[] rights, int count);
    [DllImport("advapi32.dll")] static extern uint LsaRemoveAccountRights(IntPtr policy, byte[] sid, bool all, LsaString[] rights, int count);
    [DllImport("advapi32.dll")] static extern uint LsaEnumerateAccountRights(IntPtr policy, byte[] sid, out IntPtr rights, out int count);
    [DllImport("advapi32.dll")] static extern uint LsaClose(IntPtr handle);
    [DllImport("advapi32.dll")] static extern uint LsaFreeMemory(IntPtr buffer);
    [DllImport("advapi32.dll")] static extern int LsaNtStatusToWinError(uint status);
    const uint NotFound = 0xC0000034;  // STATUS_OBJECT_NAME_NOT_FOUND: the account holds no rights
    static IntPtr Open(int access) {
        LsaAttributes a = new LsaAttributes(); IntPtr h;
        uint st = LsaOpenPolicy(IntPtr.Zero, ref a, access, out h);
        if (st != 0) throw new Win32Exception(LsaNtStatusToWinError(st));
        return h;
    }
    static byte[] Sid(string sid) { SecurityIdentifier s = new SecurityIdentifier(sid); byte[] b = new byte[s.BinaryLength]; s.GetBinaryForm(b, 0); return b; }
    public static string[] Get(string sid) {
        IntPtr h = Open(0x00000800), p; int n;  // POLICY_LOOKUP_NAMES
        try {
            uint st = LsaEnumerateAccountRights(h, Sid(sid), out p, out n);
            if (st == NotFound) return new string[0];
            if (st != 0) throw new Win32Exception(LsaNtStatusToWinError(st));
            List<string> list = new List<string>(); int size = Marshal.SizeOf(typeof(LsaString));
            for (int i = 0; i < n; i++) { LsaString s = (LsaString)Marshal.PtrToStructure(new IntPtr(p.ToInt64() + i * size), typeof(LsaString)); list.Add(Marshal.PtrToStringUni(s.Buffer, s.Length / 2)); }
            LsaFreeMemory(p);
            return list.ToArray();
        } finally { LsaClose(h); }
    }
    public static void Set(string sid, string right, bool grant) {
        IntPtr h = Open(0x00000811);  // POLICY_LOOKUP_NAMES | POLICY_CREATE_ACCOUNT | POLICY_VIEW_LOCAL_INFORMATION
        LsaString[] r = new LsaString[1];
        r[0].Buffer = Marshal.StringToHGlobalUni(right); r[0].Length = (ushort)(right.Length * 2); r[0].MaximumLength = (ushort)(right.Length * 2 + 2);
        try {
            uint st = grant ? LsaAddAccountRights(h, Sid(sid), r, 1) : LsaRemoveAccountRights(h, Sid(sid), false, r, 1);
            if (st != 0 && !(st == NotFound && !grant)) throw new Win32Exception(LsaNtStatusToWinError(st));
        } finally { Marshal.FreeHGlobal(r[0].Buffer); LsaClose(h); }
    }
}
'@
}
function Get-AccountRights([string]$Sid) { return ,@([RlbLsa]::Get($Sid)) }
function Grant-AccountRight([string]$Sid, [string]$Right) { [RlbLsa]::Set($Sid, $Right, $true) }
function Revoke-AccountRight([string]$Sid, [string]$Right) { [RlbLsa]::Set($Sid, $Right, $false) }

# rust_server.exe processes from the test copy running as the test account (PIDs).
function Get-TestServerPids {
    $s = $script:RlbSettings
    $exe = Join-Path (Get-RlbPaths).TestCopy $s.server.exe
    $ids = @()
    foreach ($c in @(Get-CimInstance Win32_Process -Filter "Name='$($s.server.exe)'" -ErrorAction SilentlyContinue)) {
        if ($c.ExecutablePath -ne $exe) { continue }
        $o = Invoke-CimMethod -InputObject $c -MethodName GetOwner -ErrorAction SilentlyContinue
        if ($o -and $o.User -eq $s.account) { $ids += [int]$c.ProcessId }
    }
    return ,$ids
}

function Get-PidFromFile([string]$Name) {
    $f = Join-Path (Get-RlbPaths).Run $Name
    if (-not (Test-Path -LiteralPath $f)) { return $null }
    $id = [int](Get-Content -Raw -LiteralPath $f).Trim()
    return Get-Process -Id $id -ErrorAction SilentlyContinue
}

# Every check 05-Start-Server.ps1 needs before it runs the original server. Returns rows Check/Status/Detail.
function Test-RlbLockdown {
    $s = $script:RlbSettings
    $p = Get-RlbPaths
    $rows = New-Object System.Collections.Generic.List[object]
    function Add-Row([string]$Check, [string]$Status, [string]$Detail) { $rows.Add([pscustomobject]@{ Check = $Check; Status = $Status; Detail = $Detail }) }

    $u = Get-TestAccount
    if ($u -and $u.Enabled) {
        $std = Test-TestAccountIsStandard
        if ($std.Standard) { Add-Row 'test account is a standard user' 'PASS' ("$($s.account) groups: " + ($std.Groups -join ', ')) }
        else { Add-Row 'test account is a standard user' 'FAIL' ("$($s.account) is in: " + ($std.Groups -join ', ')) }
    } else { Add-Row 'test account is a standard user' 'FAIL' "$($s.account) missing or disabled (01-New-ServerAccount.ps1)" }

    $exe = Join-Path $p.TestCopy $s.server.exe
    $rules = Get-FirewallRules
    $want = @(
        @{ Name = 'RLB host test: block server outbound'; Direction = 'Outbound' },
        @{ Name = 'RLB host test: block server inbound'; Direction = 'Inbound' },
        @{ Name = 'RLB host test: block test account outbound'; Direction = 'Outbound' }
    )
    foreach ($w in $want) {
        $r = @($rules | Where-Object { $_.DisplayName -eq $w.Name })
        if ($r.Count -eq 1 -and $r[0].Enabled -eq 'True' -and $r[0].Action -eq 'Block' -and $r[0].Direction -eq $w.Direction -and $r[0].Profile -eq 'Any') { Add-Row $w.Name 'PASS' 'enabled, block, all profiles' }
        else { Add-Row $w.Name 'FAIL' 'missing or changed (03-Set-Firewall.ps1)' }
    }
    $app = @($rules | Where-Object { $_.DisplayName -like 'RLB host test: block server *' } | Get-NetFirewallApplicationFilter)
    if ($app.Count -eq 2 -and @($app | Where-Object { $_.Program -ne $exe }).Count -eq 0) { Add-Row 'program rules point at the test copy' 'PASS' $exe }
    else { Add-Row 'program rules point at the test copy' 'FAIL' ("programs: " + (($app | ForEach-Object { $_.Program }) -join ', ')) }

    $profiles = @(Get-NetFirewallProfile)
    $off = @($profiles | Where-Object { $_.Enabled -ne 'True' })
    if ($off.Count -eq 0) { Add-Row 'Windows Firewall on (all profiles)' 'PASS' 'Domain, Private, Public' } else { Add-Row 'Windows Firewall on (all profiles)' 'FAIL' ("off: " + (($off | ForEach-Object { $_.Name }) -join ', ')) }

    if (Test-Path -LiteralPath $exe) {
        $h = Get-Sha256 $exe
        if ($h -eq $s.server.exeSha256) { Add-Row 'rust_server.exe is the verified Unity player' 'PASS' $h } else { Add-Row 'rust_server.exe is the verified Unity player' 'FAIL' "SHA-256 $h" }
    } else { Add-Row 'rust_server.exe is the verified Unity player' 'FAIL' "missing $exe (02-Prepare-Server.ps1)" }

    $left = @($s.server.removeFromTestCopy | Where-Object { Test-Path -LiteralPath (Join-Path $p.TestCopy $_) })
    if ($left.Count -eq 0) { Add-Row 'unverified files removed from the test copy' 'PASS' ($s.server.removeFromTestCopy -join ', ') } else { Add-Row 'unverified files removed from the test copy' 'FAIL' ("still present: " + ($left -join ', ')) }

    $ini = Join-Path $p.TestCopy 'LumaEmu.ini'
    if (Test-Path -LiteralPath $ini) {
        $text = [IO.File]::ReadAllText($ini)
        $bad = @()
        foreach ($sec in $s.server.lumaEmu.PSObject.Properties) { foreach ($kv in $sec.Value.PSObject.Properties) { if ($text -notmatch ('(?m)^' + [regex]::Escape($kv.Name) + '\s*=\s*' + [regex]::Escape($kv.Value) + '\s*$')) { $bad += "$($kv.Name)=$($kv.Value)" } } }
        if ($bad.Count -eq 0) { Add-Row 'LumaEmu offline settings' 'PASS' 'Offline=1, Master=0, UnlockDLC=2' } else { Add-Row 'LumaEmu offline settings' 'FAIL' ("not set: " + ($bad -join ', ')) }
    } else { Add-Row 'LumaEmu offline settings' 'FAIL' "missing $ini" }

    $acl = (Get-Acl -LiteralPath $p.Secrets -ErrorAction SilentlyContinue)
    if ($acl -and -not @($acl.Access | Where-Object { $_.IdentityReference -match ('\\' + [regex]::Escape($s.account) + '$') -or $_.IdentityReference -match '^(BUILTIN\\Users|Everyone|NT AUTHORITY\\Authenticated Users)$' }).Count) { Add-Row 'secrets folder closed to the test account' 'PASS' $p.Secrets }
    else { Add-Row 'secrets folder closed to the test account' 'FAIL' "$($p.Secrets) is readable by the test account or all users" }

    # librust.dll -> the zip's LumaEmu steam_api.dll -> MSVCR120/MSVCP120 (Visual C++ 2013, x86). Missing on Windows
    # Server 2022: the server then logs DllNotFoundException for librust.dll (found on the Azure VM, 2026-10-21).
    if ((Test-Path "$env:SystemRoot\SysWOW64\msvcr120.dll") -and (Test-Path "$env:SystemRoot\SysWOW64\msvcp120.dll")) { Add-Row 'Visual C++ 2013 x86 runtime' 'PASS' 'msvcr120/msvcp120 present' }
    else { Add-Row 'Visual C++ 2013 x86 runtime' 'FAIL' 'install Microsoft Visual C++ 2013 Redistributable (x86) from aka.ms/highdpimfc2013x86enu' }
    if (@(Get-Process Procmon, Procmon64 -ErrorAction SilentlyContinue).Count) { Add-Row 'Process Monitor recording' 'PASS' 'running' } else { Add-Row 'Process Monitor recording' 'WARN' 'not running (05-Start-Server.ps1 starts it unless -NoProcmon)' }
    return ,$rows
}
