<#
.SYNOPSIS
  Creates the local STANDARD Windows account the original server runs as (default name rlbserver, from
  settings.json). It is in the Users group only. Standard users cannot open other users' processes, cannot read
  other users' profile folders (C:\Users\<you>), and cannot change system settings, so the server (and the modified
  VAC2.dll that the test copy drops anyway) cannot reach your own files or programs.
  You type the password; it is not stored anywhere by these scripts. The account is hidden from the sign-in screen.
  Elevated PowerShell. Dry run unless -Apply. 99-Remove.ps1 -RemoveAccount deletes it again.
#>
param([switch]$Apply, [switch]$Json)
. (Join-Path $PSScriptRoot '_Common.ps1')
$s = Get-RlbSettings
$name = $s.account

Write-Plan "Create the test account $name" @(
    "Refuse if $name already exists and is in any group other than Users",
    "New-LocalUser $name (password typed by you, never expires, cannot be changed by the account), member of Users only",
    "Hide $name from the sign-in screen (HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList, value 0)",
    'Print the account SID (the firewall rule in 03-Set-Firewall.ps1 blocks all outbound traffic for it)'
) -ChangesSecurity
Confirm-OrExit $Apply.IsPresent 'Apply'
Assert-Admin

$u = Get-TestAccount
if ($u) {
    $std = Test-TestAccountIsStandard
    if (-not $std.Standard) { throw "$name exists and is in: $($std.Groups -join ', '). Remove it from every group except Users first." }
    Write-Host "$name already exists as a standard user; keeping it." -ForegroundColor Yellow
} else {
    $pw = Read-Host -AsSecureString "Password for the new local account $name (it only runs the test server)"
    $u = New-LocalUser -Name $name -Password $pw -PasswordNeverExpires -UserMayNotChangePassword -AccountNeverExpires `
        -FullName 'Rust Legacy test server' -Description 'Runs the Rust Legacy test server'
    Add-LocalGroupMember -Group (Get-LocalGroup -SID 'S-1-5-32-545') -Member $name
}
$key = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList'
if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
New-ItemProperty -Path $key -Name $name -Value 0 -PropertyType DWord -Force | Out-Null
Write-Host ("{0} SID: {1}" -f $name, (Get-TestAccountSid)) -ForegroundColor Green
Write-Host 'Next: 02-Prepare-Server.ps1 -ZipPath <RustLegacyServer.zip> -Apply, then 03-Set-Firewall.ps1 -Apply.'
