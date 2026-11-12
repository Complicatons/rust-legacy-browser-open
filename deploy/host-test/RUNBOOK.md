# Host test runbook (owner)

The original Rust Legacy server runs **on this PC**, locked down (owner decision 2026-10-21, [SERVER-TESTING-PLAN.md](../../SERVER-TESTING-PLAN.md) section 10). It replaces the VM plan for P1–P8. The VM kit in `deploy/vm-test` stays available if you want stronger isolation later.

## What protects you

| Layer | What it does | Script |
|---|---|---|
| Verified files | `rust_server.exe` is Unity 4.5.5's own player (identical to Unity's signed installer except the icon). The scripts refuse any other hash. | 02, 05 |
| Unverified files removed | `VAC2.dll` (Valve signature broken: modified after signing) is moved out of the test copy. | 02 |
| Emulator offline | `LumaEmu.ini`: `Offline=1`, `Master=0` (no Valve master-server heartbeats), `UnlockDLC=2` (no DLC lookups online). | 02 |
| Separate account | The server runs as `rlbserver`, a standard user. It cannot open your processes, cannot read `C:\Users\<you>`, and cannot change system settings. | 01, 05 |
| Firewall | Inbound and outbound blocked for the server program. All outbound traffic is blocked for anything running as `rlbserver`. Loopback (127.0.0.1) still works, so our gateway can reach the server. Dropped packets are logged. | 03 |
| Folder permissions | `C:\RLB-host` is closed to other users. `rlbserver` can change only the test copy; it cannot reach the pristine original or the secrets. | 02 |
| Process Monitor | Records every file, registry, network and process event during the run. | 05, 07 |
| Report | Lists what the server wrote outside its folder, its registry writes, its network attempts, its child processes and DLL loads, and the firewall drops. | 07 |

**Residual risks** (why the network should be off during runs):
- **DNS:** lookups are made by Windows' DNS Client service, not by the program, so a blocked program can still cause DNS queries. Unplug the network cable or turn Wi-Fi off while the server runs. The gateway, central and the browser all work on 127.0.0.1.
- **Shared folders:** the server can still read anything that every user can read, such as `C:\Program Files` and drives with open permissions. Keep private files in your own profile folder.
- **Unverified code that is not Unity's:** `librust.dll`, the LumaEmu emulator DLLs and the Facepunch/uLink game code have no public reference copy to compare against. The game's managed code was decompiled and read for this project; the native DLLs were not.

## Before the first run (once)

1. Download **Process Monitor** from learn.microsoft.com/sysinternals (Microsoft-signed) and unzip it to `C:\Program Files\Sysinternals\`. Otherwise pass `-ProcmonExe <path>` to 05 and 07.
2. Open **PowerShell as administrator** in `deploy\host-test\scripts`. If scripts are blocked, run `Set-ExecutionPolicy -Scope Process Bypass` first; it lasts only for that window.

Every script prints its plan first. It changes nothing without `-Apply`, or `-ConfirmRunOriginalBinaries` for 05.
The host app's Setup page runs these same scripts with `-Json`, which only adds `##rlb {...}` lines (the plan and the result) to the output.

```powershell
.\01-New-ServerAccount.ps1 -Apply              # you type a password for rlbserver
.\02-Prepare-Server.ps1 -ZipPath "<path>\RustLegacyServer.zip" -Apply
.\03-Set-Firewall.ps1 -Apply
.\04-Test-Isolation.ps1 -Apply                 # must end "Isolation check passed"
```

`04-Test-Isolation.ps1` runs a small probe of our own as `rlbserver`. Connections to the internet and your router must fail, and a connection to 127.0.0.1 must work. It warns while the PC is online (the DNS caveat above).

## Each run (P1 server baseline first)

1. Unplug the network or turn Wi-Fi off.
2. Start the server:
   ```powershell
   .\05-Start-Server.ps1 -ConfirmRunOriginalBinaries
   ```
   This starts Process Monitor (accept its licence the first time), asks for the `rlbserver` password, and waits for UDP 29015.
3. Let it run. For P1, wait until `output_log.txt` shows the server started, then a few minutes more.
4. Stop it:
   ```powershell
   .\06-Stop-Server.ps1 -Apply
   ```
5. Collect the evidence:
   ```powershell
   .\07-Collect.ps1 -Apply
   ```
   It writes `C:\RLB-host\export\<time>\summary.txt` and the CSVs and logs.
6. Send me `summary.txt`. I'll read it and the CSVs before the next phase.

**P1 pass:** the server reaches "server started" and listens on UDP 29015. Every expected outbound attempt shows as blocked: the uLink analytics beacon, Steam/LumaEmu, and Unity's hardware survey. Nothing is written outside `C:\RLB-host\server\test` and the `rlbserver` profile, and no unexpected process is started.

Later phases (P3 handshake, P4 browser join through the adapter, P5–P8) add our gateway, sidecar and central on 127.0.0.1: next section.

## P3 onwards: browser join through our bridge

Everything below is our own code on 127.0.0.1, so it needs no administrator rights. Patching changes only the test copy.

**Once:**
```powershell
.\08-New-Secrets.ps1 -Apply        # control/plugin keys, metrics token, certificate passphrase
.\09-New-GatewayCert.ps1 -Apply    # gateway test certificate for 127.0.0.1 (key only in C:\RLB-host\secrets)
.\10-Patch-TestCopy.ps1 -Apply     # VanillaPatcher on the test copy's Assembly-CSharp.dll + rustlegacybrowser.cfg
.\11-Initialize-Central.ps1 -Apply # website state in C:\RLB-host\central
```

1. Run `.\12-Start-Central.ps1` in its own window. It keeps running there.
2. Open http://127.0.0.1:8080/ in any browser and register an account.
3. On **/owner**, add a server with the endpoint `wss://127.0.0.1:28443/play`.
4. Copy the server id and the enrolment code, then run this within 15 minutes:
   ```powershell
   .\13-Enrol-Gateway.ps1 -ServerId <id> -Code <code> -Apply
   ```

`10-Patch-TestCopy.ps1` refuses an adapter DLL older than its source. Rebuild it with `deploy\vm-test\host\Build-AdapterOutputs.ps1` (packages are already cached), or with `dotnet build adapter\vanilla -c Release --no-restore -p:RefDir=<full path to analysis\server-audit\rust_server_Data\Managed>` and copy the DLL to `build\vm-test\adapter`. If you re-run `02-Prepare-Server.ps1`, re-run `10-Patch-TestCopy.ps1` too: it recreates the test copy unpatched.

**Each run:**
1. Start central with `12-Start-Central.ps1`, in its own window.
2. Start the server with `05-Start-Server.ps1 -ConfirmRunOriginalBinaries` (elevated).
3. Start the bridge: `14-Start-Bridge.ps1 -Apply`.
4. Open the test browser with `16-Start-TestBrowser.ps1`. It checks the certificate the gateway presents against the one from step 09, then opens a separate Edge profile that trusts only that key.
5. Join from the server browser.

To stop:
1. Run `15-Stop-Bridge.ps1 -Apply`.
2. Run `06-Stop-Server.ps1 -Apply`.
3. Run `07-Collect.ps1 -Apply`.
4. Press Ctrl+C in the central window.

**Automated rows:** copy `deploy\host-test\config\native-test.host-test.json`, fill in the server id, and set the password environment variables it names. Then run:
```powershell
npm run test:native -- --config <copy>
```
For load, run `npm run soak:bots -- --config <copy>`.

**Rehearsed 2026-10-21** with our own code in a scratch folder, without the original server:
- secrets, certificate and patching all worked;
- the patcher check, patch and verify all passed;
- central started, an owner account and server were created, and the gateway enrolled;
- the gateway and sidecar ran, and the certificate fingerprint and IP SAN matched;
- 23 of 23 heartbeats succeeded, and central showed the server online.

## Undo

```powershell
.\99-Remove.ps1 -Apply                              # firewall rules removed, logging restored
.\99-Remove.ps1 -Apply -RemoveAccount -RemoveFiles  # also deletes rlbserver and C:\RLB-host (central data, keys, test browser profile)
```
