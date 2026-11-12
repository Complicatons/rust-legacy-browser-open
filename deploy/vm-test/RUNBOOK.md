# VM test runbook (owner)

Step-by-step for [SERVER-TESTING-PLAN.md](../../SERVER-TESTING-PLAN.md): the original Rust Legacy server runs **only inside an isolated VMware VM**, our gateway and sidecar run next to it, and the central service plus the test browser stay on the host.

Rules that hold throughout:

- **No original binary ever runs on the host.** Host scripts (`deploy/vm-test/host/`) only run our Node code, read VMware's `.vmx` text, use Wireshark/Defender, and build ISOs.
- **Every VM script prints its plan and changes nothing without `-Apply`.** The only script that runs an original binary, `07-Start-Server.ps1`, needs `-ConfirmRunOriginalBinaries`, and it refuses unless the isolation check passes.
- **Each phase needs your explicit go-ahead.** The "You approve" column below lists what you are agreeing to.
- Files go **in** only on read-only ISOs. Logs come **out** only on the export disk, mapped **read-only** on the host.

## Topology

```
Host PC (192.168.56.1 on VMnet1)                      VM (192.168.56.10, host-only, no gateway, no DNS)
  Edge test profile -> http://192.168.56.1:8080/        rust_server.exe  UDP 29015 (VM loopback use)
  central (node tools/central.mjs) :8080  <-- http --   gateway (node, vm-test mode)  wss://192.168.56.10:28443/play
  Wireshark on VMnet1                    -- wss -->     sidecar (node) 127.0.0.1:28090 <-> patched Assembly-CSharp
```

| Setting | Value | Where |
|---|---|---|
| Host-only subnet | 192.168.56.0/24 (VMnet1, DHCP off) | `settings.json` |
| Central (host) | `http://192.168.56.1:8080/`, bound to the host-only address only | `config/central.vm-test.json` |
| Gateway (VM) | `mode: "vm-test"`, `testHostOnlyBind`, wss with a VM-made test certificate | `config/gateway.vm-test.json` |
| Sidecar (VM) | 127.0.0.1:28090, test ID namespace 9e16 + 1,000,000 | `config/sidecar.vm-test.json` |
| Server | shipped `Run Server.bat` args, port 29015 | `settings.json` |
| server.cfg | shipped values; only `rcon.password` replaced by a VM-generated secret | `server/server.cfg` |
| Server zip | 543,636,040 bytes, SHA-256 `98D7BD5C…FB3A15` | `analysis/INITIAL-FINDINGS.md` |

**Why the gateway may bind 192.168.56.10.** Production gateways serve TLS or listen on 127.0.0.1. `testHostOnlyBind` is a test-only exception that `validateConfig` accepts only with `mode: "vm-test"`. It requires a private /16../30 subnet and an IPv4 address inside it (never wildcard, loopback or public), a loopback server and sidecar, and a central URL and origins inside the subnet. At start-up it also checks that the address belongs to the machine and prints a loud banner. The website only accepts `wss://` endpoints, so the gateway also serves TLS with a self-signed certificate made **inside the VM**. The host trusts that one key **only in a dedicated Edge profile** (`--ignore-certificate-errors-spki-list`, after you compare fingerprints). Nothing is added to any certificate store.

**Secrets.** None are committed. In the VM, `03-New-Secrets.ps1` writes the control and plugin keys, the metrics token, the rcon password and the PFX passphrase to `C:\RLB\secrets`. On the host, `Initialize-HostCentral.ps1` writes the signing key to `%LOCALAPPDATA%\RLB-vm-test`. Exports redact every secret value.

## Before P0 (host, once)

1. Install **VMware Workstation Pro** (vmware.com) and download a **Windows 10 22H2 / 11 Enterprise evaluation ISO** (microsoft.com/evalcenter). Use official sites only.
2. Install **Wireshark** (wireshark.org; includes Npcap) on the host to capture on VMnet1.
3. Download into `build\vm-test\installers\` (official sites only; the ISO builder never downloads anything):
   - `node-v<LTS>-x64.msi` from nodejs.org (required in the VM)
   - `Wireshark-<ver>-x64.exe` from wireshark.org (VM loopback captures, optional)
   - `ProcessMonitor.zip` and `TCPView.zip` from learn.microsoft.com/sysinternals (optional)
4. For P4 and later: `deploy\vm-test\host\Build-AdapterOutputs.ps1 -AllowNuGetRestore`. This builds the adapter DLL and a self-contained `VanillaPatcher.exe`, and **downloads NuGet packages**.
5. Build the tools ISO: `node tools\build-vm-iso.mjs`. It writes `build\vm-test\rlb-vm-tools.iso`, plus `.sha256` and `.contents.txt` beside it. It finds and verifies `RustLegacyServer.zip` itself, and lists any gaps (for example, no Node MSI).

## P0: VM build and isolation (no original code)

**You approve:** creating the VM, running our setup scripts, installing Node in the VM.

1. **Virtual Network Editor** (Edit > Virtual Network Editor > Change Settings), VMnet1 (Host-only):
   - Subnet IP `192.168.56.0`, mask `255.255.255.0`.
   - Untick "Use local DHCP service".
   - Tick "Connect a host virtual adapter".
   - Check that the host adapter "VMware Network Adapter VMnet1" now has `192.168.56.1`. If not, set it in its IPv4 properties, with no gateway and no DNS.
2. **New VM** (Custom): Windows 10/11 x64, 4 vCPU, 8 GB RAM, 80 GB disk (single file). Network: **Host-only**.
3. **VM settings** before the first boot:
   - Network Adapter: Host-only (VMnet1), the **only** adapter. Remove any NAT or bridged adapter.
   - Options > Shared Folders: **Disabled**.
   - Options > Guest Isolation: untick **drag and drop** and **copy and paste**.
   - Options > VMware Tools: no time sync is fine.
   - Remove USB Controller, Sound Card (optional), Printer, Serial/Parallel ports and Floppy.
   - Add Hard Disk > SCSI > 4 GB, file `rlb-export.vmdk`. In its Advanced settings set **Independent, Persistent**, so exports survive snapshot reverts.
   - CD/DVD: the Windows ISO for now.
   - Close the settings dialog. In the `.vmx` file (VM powered off) make sure these lines exist:
     ```
     isolation.tools.hgfs.disable = "TRUE"
     isolation.tools.copy.disable = "TRUE"
     isolation.tools.paste.disable = "TRUE"
     isolation.tools.dnd.disable = "TRUE"
     isolation.tools.unity.disable = "TRUE"
     ```
4. **Install Windows** with a local account (no network, so choose "I don't have internet" and use a limited setup). Keep Defender on. Install VMware Tools from VM > Install VMware Tools; it is optional, but gives a better display.
5. In the VM, attach `rlb-vm-tools.iso` as the CD (Connected). Open an **elevated** PowerShell:
   ```
   Set-ExecutionPolicy -Scope Process Bypass
   D:\app\deploy\vm-test\scripts\01-Configure-Guest.ps1 -Apply -InitializeExportDisk
   D:\app\deploy\vm-test\scripts\00-Test-Isolation.ps1
   D:\app\deploy\vm-test\scripts\02-Install-Tools.ps1 -Apply
   D:\app\deploy\vm-test\scripts\03-New-Secrets.ps1 -Apply
   ```
   Replace `D:` with the CD drive letter. From here on you can run the scripts from `C:\RLB\app\deploy\vm-test\scripts`. If you want VM-side captures, install Wireshark/Npcap from `D:\installers` by hand and tick "Support loopback traffic".
6. **Host check** (VM running): `deploy\vm-test\host\Test-HostIsolation.ps1 -VmxPath "<VM folder>\<name>.vmx" -CaptureSeconds 120 -ConfirmCapture`, then run `00-Test-Isolation.ps1` in the VM while it captures. Expected:
   - the `.vmx` checks PASS;
   - the VM answers ping;
   - every captured packet from 192.168.56.10 goes to 192.168.56.0/24 or to broadcast/multicast;
   - no DNS answers.
7. **Snapshot `clean-tools`.** Exit: both isolation checks pass.

## P1: Server baseline (runs original code)

**You approve:** unpacking the zip in the VM and **running `rust_server.exe`** in the VM, with Procmon and capture on.

1. In the VM: `04-Unpack-Server.ps1 -Apply`. It verifies size, SHA-256 and the Assembly-CSharp hash, then unpacks to `C:\RLB\server\original` and marks it read-only.
2. `05-New-TestCopy.ps1 -Apply` (unpatched copy, rcon password set).
3. **Snapshot `p1-before-run`.**
4. Host: start a Wireshark capture on VMnet1, or run `Test-HostIsolation.ps1 -CaptureSeconds 600 -ConfirmCapture`.
5. VM: `07-Start-Server.ps1 -ConfirmRunOriginalBinaries -Procmon -Capture -Phase P1`. Wait for "listening on UDP 29015". Let it run about 10 minutes.
6. VM: `08-Stop-Server.ps1 -Apply`, then `13-Collect-Logs.ps1 -Apply -Phase P1 -ToExportVolume`.
7. Exit criteria:
   - the server reached "server started";
   - UDP 29015 was listening;
   - `test-copy-changes.csv` shows writes only under the server folder;
   - Procmon shows nothing outside it;
   - the captures show blocked outbound attempts only (uLink analytics, Steam). Anything else: stop and investigate.
8. Shut down, export (see "Exporting results"), then **revert to `p1-before-run`**, or keep the state for P3 if the run was clean.

## P2: Native client baseline (optional)

**You approve:** installing and running the original client in the VM. This needs separate approval and a 3D-capable VM. It is not scripted here. If the client cannot run without Steam, skip it.

## P3: Handshake against the unmodified server

**You approve:** running the server (as P1) **and** our gateway/sidecar in the VM, plus central on the host.

1. Host: `Initialize-HostCentral.ps1 -Apply`, then `Set-HostFirewall.ps1 -Apply` (elevated; one inbound rule, VM to 8080 only), then `Start-HostCentral.ps1` (leave it open).
2. Host browser (any profile for now): open `http://192.168.56.1:8080/`, register a test account (email + password; the verification link prints in the central console), then go to Owner panel > Register server:
   - name `VM test`;
   - endpoint `wss://192.168.56.10:28443/play`.

   Note the **server id** and the **enrolment code** (valid 15 minutes).
3. VM: `09-New-GatewayCert.ps1 -Apply`. Write down the fingerprint it prints.
4. VM: `10-Enrol-Gateway.ps1 -ServerId <id> -Code <code> -Apply`. Type both values (no clipboard), or build a handoff ISO on the host with `node tools\build-vm-iso.mjs --handoff <id> <code>`, attach it, and run without the parameters.
5. VM: `05-New-TestCopy.ps1 -Apply` (fresh, unpatched), then `07-Start-Server.ps1 -ConfirmRunOriginalBinaries -Capture -Phase P3`, then `11-Start-Bridge.ps1 -Apply`.
6. Host: `Start-TestBrowser.ps1 -Fingerprint "<fingerprint from step 3>"`. Sign in, publish the server once its heartbeat shows online, and join.
7. Expected: Lidgren/uLink handshake completes, then the server **denies** (no Steam ticket, unpatched server). The deny reason is in the gateway log. This proves transport compatibility up to authentication.
8. Stop (`12-Stop-Bridge.ps1 -Apply`, `08-Stop-Server.ps1 -Apply`), run `13-Collect-Logs.ps1 -Apply -Phase P3 -ToExportVolume`, then revert or snapshot.

## P4: Adapter and first browser join

**You approve:** patching the **test copy** with our patcher, and running the patched server.

1. Snapshot `p4-before-patch`.
2. VM: `05-New-TestCopy.ps1 -Apply`, then `06-Patch-TestCopy.ps1 -Apply`. The patcher runs check, patch and verify. The original is kept as `Assembly-CSharp.dll.rlb-original` and the pristine `C:\RLB\server\original` is untouched.
3. Start the server (`-Phase P4`), then `11-Start-Bridge.ps1 -Apply`, then join from the test browser profile.
4. Exit criteria: the browser account joins, spawns at a server spawn point and moves. There are no TruthDetector corrections or kicks while walking. The sidecar log shows the approval.

## P5 to P8

Same start/stop/collect cycle, with `-Phase P5` and so on. Snapshot before each phase.

| Phase | Extra setup | You approve |
|---|---|---|
| P5 gameplay matrix | `03-New-Secrets.ps1 -ShowRcon` gives the rcon password. Use `rcon.login <password>` from the browser F1 console for admin commands such as `airdrop.drop` and `env.time`. | running the patched server for the matrix |
| P6 mixed clients | a second test-profile browser window/account; native client only if P2 worked | as P5 |
| P7 anti-cheat/admin | set `"autoKick": true` in `C:\RLB\config\gateway.json` (shipped `truth.enforce "true"` stays on), restart the bridge. Website admin tools from the host: give the matrix account the admin role on the owner page, make a second plain account for `target`, optionally connect the desktop client in the VM as `desktop.name` (it gets kicked), then `npm run test:native -- --config <cfg> --rows "Admin tools"` | deliberate cheat tests from a modified browser build; the plugin kicking/banning test accounts |
| P8 soak | bots from the host (`tools/soak-bots.mjs`, when available) against the test site; `11-Start-Bridge.ps1 -Apply` as usual | 1-2 h run of the server |

## P9: Teardown

1. VM (elevated): `99-Teardown.ps1 -Apply`. It stops everything, makes a final export, deletes the test copy, configs and secrets, and removes the firewall rules.
2. Shut down the VM and import the export (below).
3. **Revert to `clean-tools`.**
4. Host: `Set-HostFirewall.ps1 -Remove` (elevated). Stop central (Ctrl+C). Optionally delete `%LOCALAPPDATA%\RLB-vm-test`.
5. Write the findings into HANDOFF.md and GAP-AUDIT.md.

## Exporting results (one way, read-only)

1. VM: `13-Collect-Logs.ps1 -Apply -Phase Pn -ToExportVolume` copies `C:\RLB\export\<time>-Pn` to the RLB_EXPORT disk. That folder holds:
   - our logs;
   - the server's output_log, logs and cfg (secrets redacted);
   - the list of files changed in the test copy;
   - captures;
   - isolation, network and process snapshots;
   - Defender detections and event logs;
   - `MANIFEST.sha256`.
2. **Shut the VM down**.
3. VMware: File > Map Virtual Disks > Map, choose `rlb-export.vmdk`, keep **"Open file in read-only mode" ticked**, and pick a drive (for example Z:).
4. Host: `deploy\vm-test\host\Read-VmExport.ps1 -Source Z:\exports -Apply`. It copies only data file types into `%USERPROFILE%\RLB-vm-exports`. Executables and scripts are skipped and listed. It then verifies each manifest, marks the files read-only and runs a Defender scan.
5. Disconnect the mapping before powering the VM on again.

## Script reference

| VM script (`scripts/`) | Does | Switch |
|---|---|---|
| `00-Test-Isolation.ps1` | read-only isolation report | none |
| `01-Configure-Guest.ps1` | static IP, no gateway/DNS, IPv6 off, host-only firewall rules, export disk | `-Apply` (`-InitializeExportDisk`) |
| `02-Install-Tools.ps1` | verify ISO manifest, copy app, install Node MSI (signature checked), Sysinternals | `-Apply` |
| `03-New-Secrets.ps1` | VM secrets | `-Apply` (`-Rotate`, `-ShowRcon`) |
| `04-Unpack-Server.ps1` | verify zip hash, unpack pristine copy, manifest | `-Apply` (`-Replace`) |
| `05-New-TestCopy.ps1` | fresh test copy, test server.cfg | `-Apply` |
| `06-Patch-TestCopy.ps1` | adapter DLL + vanilla patcher on the copy | `-Apply` |
| `07-Start-Server.ps1` | **runs rust_server.exe** (shipped args) | `-ConfirmRunOriginalBinaries` (`-Procmon`, `-Capture`, `-Phase`) |
| `08-Stop-Server.ps1` | stop server, Procmon, dumpcap | `-Apply` |
| `09-New-GatewayCert.ps1` | VM-made test TLS certificate, prints fingerprint | `-Apply` |
| `10-Enrol-Gateway.ps1` | render configs, enrol with host central, check | `-Apply` |
| `11-Start-Bridge.ps1` / `12-Stop-Bridge.ps1` | sidecar + gateway | `-Apply` (`-NoLineOfSight`) |
| `13-Collect-Logs.ps1` | export folder (+ export disk) | `-Apply` (`-Phase`, `-ToExportVolume`) |
| `99-Teardown.ps1` | stop, export, delete test state | `-Apply` |

| Host script (`host/`) | Does |
|---|---|
| `Build-AdapterOutputs.ps1 -AllowNuGetRestore` | adapter DLL + self-contained patcher into `build\vm-test\adapter` (downloads NuGet packages) |
| `Initialize-HostCentral.ps1 -Apply` / `Start-HostCentral.ps1` | host central on 192.168.56.1:8080 |
| `Set-HostFirewall.ps1 -Apply` / `-Remove` | the one inbound rule (VM to central) |
| `Test-HostIsolation.ps1` | `.vmx` audit, VMnet1 checks, ping, capture analysis |
| `Start-TestBrowser.ps1 -Fingerprint …` | dedicated Edge profile pinned to the gateway test key |
| `Read-VmExport.ps1` | read-only export import + Defender scan |
| `node tools/build-vm-iso.mjs` | tools ISO (or `--handoff <id> <code>`) |
