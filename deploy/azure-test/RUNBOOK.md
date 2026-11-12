# Azure test VM runbook (owner)

The original Rust Legacy server runs on a **Windows VM in Azure** (UK West, Standard_D2as_v7: 2 vCPU, 8 GB), not on your PC ([SERVER-TESTING-PLAN.md](../../SERVER-TESTING-PLAN.md) section 11). On the VM it is locked down exactly as in [deploy/host-test](../host-test/RUNBOOK.md): separate standard account, firewall, offline emulator, `VAC2.dll` removed, Process Monitor. Our website, gateway and sidecar run next to it. You play from your PC in a dedicated browser profile.

```
Your PC (your IP only)                      Azure VM (UK West)
  Edge test profile  --http :8080-->          website/central (node)   private address, port 8080
                     --wss  :28443-->         gateway (node, TLS)      private address, port 28443
                                              sidecar (node)           127.0.0.1:28090
                                              rust_server.exe          127.0.0.1 UDP 29015 (locked down)
```

Azure's network security group lets **only your IP** reach RDP (3389), the website (8080) and the gateway (28443). Nothing reaches the server's port 29015 from outside. The VM shuts itself down at 23:00 UTC every night.

**Cost:** roughly $0.15–0.20 an hour while running (D2as_v7 Windows; check the Azure pricing calculator). The plan was B2ms in UK South, but on 2026-10-21 the free subscription offered no VM sizes at all in UK South and only the newest v7 sizes in UK West. It's covered by the free account's $200 credit for 30 days. A stopped ("deallocated") VM costs nothing for compute; only the disk is charged, pennies a day. Delete everything when finished.

## 1. Azure account (you)

1. Create a free account at azure.microsoft.com/free. Microsoft asks for a phone number and a card for identity checks; the $200 credit is used first.
2. Sign in to portal.azure.com and open **Cloud Shell** (the `>_` button at the top) in **PowerShell** mode. Accept the storage prompt.

## 2. Create the VM (you, one paste)

1. In Cloud Shell, upload `deploy\azure-test\cloudshell\New-RlbTestVm.ps1` with **Manage files > Upload**.
2. Run it, giving your home IP address. Search "what is my IP" on your PC to find it:
   ```powershell
   ./New-RlbTestVm.ps1 -MyIp <your IP>
   ```
3. It asks for the VM administrator password (user `rlbadmin`). Note the **public IP** it prints at the end.

If your home IP changes later, update the two rules in the portal: VM > Networking > `rdp-from-owner` and `web-from-owner`.

## 3. Copy the kit (you)

1. On your PC, build the kit: `node tools\build-azure-kit.mjs`. It writes `build\azure-test\rlb-azure-kit.zip`, about 1.9 GB, plus a `.sha256` file.
2. Connect with **Remote Desktop** (`mstsc`) to the public IP as `rlbadmin`.
3. Copy the zip in Explorer on your PC and paste it into the VM's `C:\`.
4. Extract it on the VM to `C:\RLB-kit`.

The kit contains our private code and the recovered game assets. It only goes to your own VM.

## 4. Set up the VM (you, in PowerShell as administrator on the VM)

```powershell
cd C:\RLB-kit\app\deploy\azure-test\scripts
Set-ExecutionPolicy -Scope Process Bypass
.\00-Install-Node.ps1 -Apply                  # official Node.js installer, hash-checked; then open a NEW admin PowerShell
cd C:\RLB-kit\app\deploy\host-test\scripts
Set-ExecutionPolicy -Scope Process Bypass
.\01-New-ServerAccount.ps1 -Apply             # you type a password for rlbserver
.\02-Prepare-Server.ps1 -ZipPath C:\RLB-kit\server\RustLegacyServer.zip -Apply
..\..\azure-test\scripts\01-Set-AzureConfig.ps1 -PublicIp <VM public IP> -Apply
.\03-Set-Firewall.ps1 -Apply
.\04-Test-Isolation.ps1 -Apply                # must end "Isolation check passed"
.\08-New-Secrets.ps1 -Apply
.\09-New-GatewayCert.ps1 -IpAddress <VM public IP> -Apply   # note the fingerprint it prints
.\10-Patch-TestCopy.ps1 -Apply
.\11-Initialize-Central.ps1 -Apply
```

**Also install Microsoft's Visual C++ 2013 Redistributable (x86)** (aka.ms/highdpimfc2013x86enu, check it is signed by Microsoft): the server's `librust.dll` loads the emulator's `steam_api.dll`, which needs `MSVCR120`/`MSVCP120`. Windows Server 2022 lacks them and the server then fails with `DllNotFoundException: librust.dll`. The lock-down check refuses to start without it.

`04-Test-Isolation.ps1` warns that the VM is online: that is expected in the cloud, because the VM itself needs internet. The firewall still blocks the server and the `rlbserver` account from it. DNS lookups would go out through Windows' DNS service; Process Monitor and the report show any.

## 5. P1: the server on its own (you start it)

On the VM:
1. Download Process Monitor from learn.microsoft.com/sysinternals and unzip it to `C:\Program Files\Sysinternals\`.
2. Start the server: `.\05-Start-Server.ps1 -ConfirmRunOriginalBinaries`. Its console window starts hidden: a click into a visible server console (QuickEdit) freezes the whole server, so use `-ShowConsole` only to watch, never click into it.
3. Wait a few minutes, then stop it: `.\06-Stop-Server.ps1 -Apply`.
4. Collect the results: `.\07-Collect.ps1 -Apply`.
5. Copy `C:\RLB-host\export\<time>\summary.txt` back to your PC through Remote Desktop and send it to me.

**Password-free start (once, you):** so Claude can restart the server through Cloud Shell Run Command without you, register the server task. On the VM, in an elevated PowerShell:
```powershell
cd C:\RLB-kit\app\deploy\host-test\scripts
Set-ExecutionPolicy -Scope Process Bypass
.\17-Register-ServerTask.ps1 -Apply           # type the rlbserver password into the Windows prompt
```
Add `-AtBoot` to also start the server 2 minutes after every VM start (SYSTEM task; `-NoProcmon`; log in `C:\RLB-host\logs\boot-start-*.log`). From then on `.\05-Start-Server.ps1 -ConfirmRunOriginalBinaries -ViaTask [-NoProcmon]` runs the same lock-down checks, checks the task still runs exactly `rust_server.exe` + the shipped arguments as `rlbserver` (not elevated), starts it and records the PID; `06-Stop-Server.ps1 -Apply` stops it as before. `17-Register-ServerTask.ps1 -Remove -Apply` (or `99-Remove.ps1`) deletes the tasks and the stored password. Without `-ViaTask`, 05 still asks for the password as before.

## Kit updates without Remote Desktop

Updates go through the private storage container `kits` in storage account `rlbtestkitexample` (resource group `rlb-test-rg`, UK West, Standard_LRS, HTTPS only, TLS 1.2, no public blob access). Nobody types or stores an account key. Cloud Shell signs a **container SAS bound to the stored access policy `deploy`** (read/create/write/list, a few hours). Deleting the policy revokes every SAS made from it at once.

**1. Cloud Shell:** make the SAS (the key is fetched by az and never shown):
```powershell
$a='rlbtestkitexample'; $e=(Get-Date).ToUniversalTime().AddHours(6).ToString('yyyy-MM-ddTHH:mmZ')
az storage container policy create --account-name $a -c kits -n deploy --permissions rcwl --expiry $e --auth-mode key -o none   # 'policy update' if it exists
$sas=az storage container generate-sas --account-name $a -n kits --policy-name deploy --https-only -o tsv
```

**2. The VM** sends its own manifest, so only changed files travel:
```powershell
$m='param($ContainerSasUrl); & C:\RLB-kit\app\deploy\azure-test\scripts\02-Send-KitManifest.ps1 -Apply -ContainerSasUrl $ContainerSasUrl'
az vm run-command create -g rlb-test-rg --vm-name rlb-test-vm --location ukwest --name rlbManifest --script $m --protected-parameters ("ContainerSasUrl=https://rlbtestkitexample.blob.core.windows.net/kits?"+$sas) --async-execution false -o none
az vm run-command show -g rlb-test-rg --vm-name rlb-test-vm --name rlbManifest --instance-view --query "instanceView.[executionState,output,error]" -o tsv
```
The SAS goes only in `--protected-parameters` (not shown in the run command's stored definition), never in `--parameters`.

**3. Your PC:** put the same SAS URL in `$env:RLB_KIT_SAS`, then:
```powershell
deploy\azure-test\pc\Publish-Kit.ps1 -Apply
```
It builds `build\azure-test\updates\rlb-kit-update-<time>.tar` with `node tools\build-kit-update.mjs` and uploads it with curl.exe. It prints the name and SHA-256.

What the update contains:
- The kit's app files that differ from the VM's manifest (`-Full`: all of them).
- It leaves out central's own files (`tools/central.mjs`, `central/`, `site/`), so the VM keeps the central it was set up with. `-WithCentral` includes them.
- It leaves out the adapter (`adapter/vanilla`, `build/vm-test/adapter`): the VM's test copy is already patched, and a checkout's fresh source timestamps would make `10-Patch-TestCopy` call the DLL stale. `-WithAdapter` includes it.
- Recovered assets and `node_modules` come from the checkout it runs in; junctions to the main checkout work.

**4. The VM** installs it. Run `03-Install-KitUpdate.ps1 -Name <tar> -Sha256 <hash> -ContainerSasUrl <protected> -Apply` through Run Command. It:
1. downloads the tar;
2. refuses unless the SHA-256 matches;
3. refuses paths outside the app folder, and central's files unless `-WithCentral`;
4. backs up every file it replaces to `C:\RLB-host\run\kit-backup-<time>\`;
5. unpacks into `C:\RLB-kit\app`;
6. restarts gateway + sidecar (15/14) and central, detached, unless `-NoRestart`.

The original server is not touched.

**4b. When Rust Legacy Host runs on the VM as a service (since 2026-10-29),** use `04-Install-KitViaHost.ps1 -Name <tar> -Sha256 <hash> -ContainerSasUrl <protected> -Apply` instead. 03's restarts would fight the service:
- The service runs central, sidecar and gateway from `C:\Program Files\Rust Legacy Host\app`, not from `C:\RLB-kit\app`.
- When central is killed without a stop marker, the service restarts the old copy.
- The service never restarts parts that a script started.
- At the next VM start, the service brings back its own copies.

04 does the following:
1. runs 03 `-NoRestart` (download, hash, backup, unpack into `C:\RLB-kit\app`, which the boot task's 05/06/10 use). `-SkipKit` means 03 already ran;
2. unpacks the same tar into the service's app folder with the service's Node and `tools\kit-install.mjs`, backing up to `C:\RLB-host\run\host-backup-<time>\`. The service account itself only reads that folder, on purpose;
3. asks the service (`tools\host-control.mjs`, loopback API, owner token) to restart only the running parts whose files changed. A full kit no longer restarts everything. If `host\` changed, the whole service restarts;
4. only if the adapter changed: stops the server through the service (saving first; 06 if that fails), restores `Assembly-CSharp.dll`, runs `10-Patch-TestCopy -Apply`, and starts the server through the service (the boot task, so 05's checks still run);
5. on failure, rolls the app folder back and restarts the same parts.

Exit 3 means the service isn't running: use 03.

**When finished:**
```powershell
az storage container policy delete --account-name rlbtestkitexample -c kits -n deploy --auth-mode key
```
Delete old blobs from time to time. The storage costs pennies a month.

**Why Node on your PC might not reach the VM.** If a VPN uses split tunnelling and excludes `node.exe`, Node leaves through a different public IP than Edge, curl and PowerShell. The NSG rules `rdp-from-owner` and `web-from-owner` allow only one source IP, so Azure silently drops Node's packets: every VM port times out from Node, while Node reaches every other host.

Check it by comparing `curl https://api.ipify.org` with `node -e "fetch('https://api.ipify.org').then(r=>r.text()).then(console.log)"`.

Fix it in one of two ways:
- stop excluding node.exe from the VPN tunnel;
- add the second IP to both NSG rules.

If your VPN exit IP changes, the NSG rules need the new one.

## 6. P3 onwards: playing from your PC

**On the VM:**
1. Run `.\12-Start-Central.ps1` in its own window.
2. On your PC, open `http://<VM public IP>:8080/` in any browser. Register, then on **/owner** add a server with the endpoint `wss://<VM public IP>:28443/play`.
3. Back on the VM, run `.\13-Enrol-Gateway.ps1 -ServerId <id> -Code <code> -Apply` within 15 minutes.
4. Start the server with `.\05-Start-Server.ps1 -ConfirmRunOriginalBinaries` (`-ViaTask` once the server task is registered, above).
5. Start the bridge with `.\14-Start-Bridge.ps1 -Apply`.

**On your PC:**
1. Open the test browser:
   ```powershell
   deploy\azure-test\pc\Start-TestBrowser.ps1 -VmIp <VM public IP> -Fingerprint <from step 09>
   ```
   It refuses if the gateway's certificate does not match, then opens a separate Edge profile that trusts only that key.
2. Join from the server browser.

**Automated rows from your PC:**
1. Copy `deploy\azure-test\config\native-test.azure-test.json`.
2. Replace `__PUBLIC_IP__` and fill in the server id.
3. Set the password environment variables it names.
4. Run:
   ```powershell
   npm run test:native -- --config <copy>
   ```

**Stop, on the VM:**
1. Run `15-Stop-Bridge.ps1 -Apply`.
2. Run `06-Stop-Server.ps1 -Apply`.
3. Run `07-Collect.ps1 -Apply`.
4. Press Ctrl+C in the central window.

## 7. Pause or finish (you, in Cloud Shell)

```powershell
az vm deallocate --resource-group rlb-test-rg --name rlb-test-vm   # pause: no compute charge
az vm start --resource-group rlb-test-rg --name rlb-test-vm        # resume (the public IP is static)
az group delete --name rlb-test-rg --yes                           # finished: deletes the VM, disk and IP
```

**Rehearsed 2026-10-21 on the owner's PC, without the original server:**
- **Configs and scripts:** the kit's Azure configs were rendered for a private address (the PC's LAN address standing in for the VM's). Secrets, certificate (IP SAN), patching and central setup ran.
- **Website and gateway:** the website listened on the private address and created an owner and a server. The gateway enrolled, listened with TLS, sent heartbeats and showed online; the certificate fingerprint matched.
- **Origin checks:** a WebSocket from the website's origin was accepted and one from a foreign origin was refused (403).
- **Kit:** extracted and served the website, `/play`, the engine files and the recovered assets on its own.
