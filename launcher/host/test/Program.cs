// Launcher host tests. Run by node tools/build-launcher.mjs --test with the proxy-test folder as the argument
// (build/launcher/proxy-test: the x86 proxy, fake_upstream as steam_api_upstream.dll, proxy_client.exe).
// Everything happens in a temp folder with fake game files; no original game file is used or run.
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;
using RustLegacyLauncher;

static class Program
{
    static int failures;
    static void Check(bool ok, string what) { Console.WriteLine((ok ? "ok   " : "FAIL ") + what); if (!ok) failures++; }
    static string Code(Action a) { try { a(); return null; } catch (ProfileException e) { return e.Code; } }

    static int Main(string[] args)
    {
        string root = Path.Combine(Path.GetTempPath(), "rlb-launcher-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            Profile(root);
            Tokens(root);
            HardwareIds();
            if (args.Length > 0) PipeEndToEnd(args[0]).GetAwaiter().GetResult();
            else Console.WriteLine("skip pipe end-to-end (no proxy-test folder given)");
        }
        finally { try { ProfileBuilder.Remove(Path.Combine(root, "profile")); Directory.Delete(root, true); } catch (Exception) { } }
        Console.WriteLine(failures == 0 ? "all checks passed" : failures + " check(s) failed");
        return failures == 0 ? 0 : 1;
    }

    static void Write(string path, string text) { Directory.CreateDirectory(Path.GetDirectoryName(path)); File.WriteAllText(path, text); }

    static void Profile(string root)
    {
        string game = Path.Combine(root, "Rust Legacy"), profile = Path.Combine(root, "profile"), proxy = Path.Combine(root, "proxy.dll");
        Write(Path.Combine(game, "rust.exe"), "RUST");
        Write(Path.Combine(game, "steam_api.dll"), "STEAM");
        Write(Path.Combine(game, "steamclient.dll"), "CLIENT");
        Write(Path.Combine(game, "LumaEmu.ini"), "[Player]");
        Write(Path.Combine(game, "rust_Data", "Managed", "Assembly-CSharp.dll"), "GAME");
        Write(Path.Combine(game, "cfg", "client.cfg"), "input.mousespeed 5");
        Write(Path.Combine(game, "cfg", "favourites.cfg"), "serverfavourite.add \"old.example:28015\"");
        Write(proxy, "PROXY");

        Check(Code(() => ProfileBuilder.Validate(Path.Combine(root, "nope"))) == "game-not-found", "missing folder: game-not-found");
        string exe = ProfileBuilder.Build(game, proxy, profile, "play.example:28015");
        Check(exe == Path.Combine(profile, "rust.exe") && File.ReadAllText(exe) == "RUST", "profile has rust.exe");
        Check(SameFile(exe, Path.Combine(game, "rust.exe")), "rust.exe is a hard link to the player's file");
        Check(File.ReadAllText(Path.Combine(profile, "steam_api.dll")) == "PROXY", "steam_api.dll is the proxy");
        Check(SameFile(Path.Combine(profile, ProfileBuilder.Upstream), Path.Combine(game, "steam_api.dll")), "player's steam_api.dll linked as steam_api_upstream.dll");
        Check(File.ReadAllText(Path.Combine(game, "steam_api.dll")) == "STEAM", "player's own steam_api.dll unchanged");
        Check(ProfileBuilder.IsReparsePoint(Path.Combine(profile, "rust_Data")), "rust_Data is a junction");
        Check(File.ReadAllText(Path.Combine(profile, "rust_Data", "Managed", "Assembly-CSharp.dll")) == "GAME", "junction reaches the player's rust_Data");
        Check(!ProfileBuilder.IsReparsePoint(Path.Combine(profile, "cfg")), "cfg is a real folder");
        string[] fav = File.ReadAllLines(Path.Combine(profile, "cfg", "favourites.cfg"));
        Check(fav[0] == "serverfavourite.add \"play.example:28015\"" && fav.Contains("serverfavourite.add \"old.example:28015\""), "favourites: armed server first, player's own kept");
        Check(File.ReadAllText(Path.Combine(game, "cfg", "favourites.cfg")) == "serverfavourite.add \"old.example:28015\"", "player's favourites.cfg unchanged");
        File.WriteAllText(Path.Combine(profile, "cfg", "client.cfg"), "input.mousespeed 7");
        Check(File.ReadAllText(Path.Combine(game, "cfg", "client.cfg")) == "input.mousespeed 7", "settings saved in game reach the player's own cfg");

        ProfileBuilder.Build(game, proxy, profile, "other.example:28016");
        Check(File.ReadAllLines(Path.Combine(profile, "cfg", "favourites.cfg"))[0] == "serverfavourite.add \"other.example:28016\"", "rebuild replaces the profile");

        ProfileBuilder.Remove(profile);
        Check(!Directory.Exists(profile), "remove deletes the profile");
        Check(File.ReadAllText(Path.Combine(game, "rust_Data", "Managed", "Assembly-CSharp.dll")) == "GAME", "remove never follows the junction into rust_Data");
        Check(File.ReadAllText(Path.Combine(game, "rust.exe")) == "RUST" && File.ReadAllText(Path.Combine(game, "steam_api.dll")) == "STEAM"
            && File.Exists(Path.Combine(game, "cfg", "client.cfg")) && File.Exists(Path.Combine(game, "LumaEmu.ini")), "remove leaves every player file");

        string linked = Path.Combine(root, "profile-link");
        ProfileBuilder.CreateJunction(linked, game);
        ProfileBuilder.Remove(linked);
        Check(!Directory.Exists(linked) && File.Exists(Path.Combine(game, "rust.exe")), "a profile that is itself a junction is unlinked, not emptied");

        Check(Code(() => ProfileBuilder.Build(game, proxy, Path.Combine(game, "profile"), null)) == "bad-profile", "profile inside the game folder refused");
        Check(Code(() => ProfileBuilder.Build(game, proxy, profile, "evil\";quit")) == "bad-address", "server address with quotes refused");
        Check(Code(() => ProfileBuilder.Build(game, Path.Combine(root, "missing.dll"), profile, null)) == "proxy-missing", "missing proxy refused");
        File.Delete(Path.Combine(game, "steam_api.dll"));
        Check(Code(() => ProfileBuilder.Validate(game)) == "steam-api-missing", "no steam_api.dll: steam-api-missing");
    }

    static void Tokens(string root)
    {
        Storage.Root = Path.Combine(root, "store");
        byte[] sealedBytes = Storage.Protect(Encoding.UTF8.GetBytes("secret-token"));
        Check(!Encoding.UTF8.GetString(sealedBytes).Contains("secret-token"), "token is not stored in clear");
        Storage.SaveToken("secret-token");
        Check(Storage.LoadToken() == "secret-token", "token round-trips through DPAPI");
        File.WriteAllBytes(Path.Combine(Storage.Root, "token.bin"), new byte[] { 1, 2, 3 });
        Check(Storage.LoadToken() == null, "damaged token file: sign in again");
        Storage.SaveToken(null);
        Check(!File.Exists(Path.Combine(Storage.Root, "token.bin")), "sign out deletes the token");
        Storage.SaveSettings(new Settings { CentralUrl = "http://evil.example/", GameFolder = @"D:\Games" });
        Check(Storage.LoadSettings().CentralUrl == new Settings().CentralUrl, "plain-http website (not this PC) refused");
        Storage.SaveSettings(new Settings { Login = Storage.CleanLogin("  rook@example.com ") });
        Check(Storage.LoadSettings().Login == "rook@example.com", "remembered login name round-trips, trimmed");
        Check(Storage.CleanLogin("   ") == null && Storage.CleanLogin(new string('a', 300)).Length == 254, "blank login forgets it; long ones are cut to the field's length");
        Check(!File.ReadAllText(Path.Combine(Storage.Root, "settings.json")).Contains("assword"), "settings.json has no password field");
    }

    // Same vector as tests/launcher-host.test.mjs computes with node's crypto.
    static void HardwareIds()
    {
        Check(HardwareId.FromParts("6f1c0e2a-4b7d-4e8f-9a10-2b3c4d5e6f70", "4C4C4544-0042-3510-8051-B4C04F4E4D32", "1A2B3C4D") == "v1:eO_3TTbvS-zwoRnFMzCE2eF0yc8Xnwu7K2ufgVPHqaM", "hardware ID: formula matches the contract");
        Check(HardwareId.FromParts("", "", "") == "v1:hEOn1ZOpFeQBbPPDpu84W_EUkkt5sPYT2kvh-dhV_MY", "hardware ID: missing parts are empty strings");
        Check(HardwareId.NormaliseUuid("ffffffff-ffff-ffff-ffff-ffffffffffff") == "" && HardwareId.NormaliseUuid("00000000-0000-0000-0000-000000000000") == "", "placeholder SMBIOS UUIDs count as missing");
        Check(HardwareId.NormaliseUuid(" 4c4c4544-0042-3510-8051-b4c04f4e4d32 ") == "4C4C4544-0042-3510-8051-B4C04F4E4D32", "SMBIOS UUID upper case, trimmed");
        string mg = HardwareId.MachineGuid(), uuid = HardwareId.SystemUuid(), serial = HardwareId.VolumeSerial(@"C:\");
        Console.WriteLine("     this PC: MachineGuid " + (mg.Length > 0 ? "read" : "missing") + ", SMBIOS UUID " + (uuid.Length > 0 ? "read" : "missing") + ", C: serial " + (serial.Length > 0 ? "read" : "missing"));
        Check(Regex.IsMatch(mg, "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"), "MachineGuid read from the 64-bit registry");
        Check(Regex.IsMatch(serial, "^[0-9A-F]{8}$"), "C: volume serial read");
        string id = HardwareId.Current;
        Check(Regex.IsMatch(id, "^v1:[A-Za-z0-9_-]{43}$") && id == HardwareId.FromParts(mg, uuid, serial) && id == HardwareId.Current, "this PC's hardware ID: the contract's shape, stable");
        Check(!id.Contains(mg) && (uuid.Length == 0 || !id.Contains(uuid)), "raw IDs never appear in the value sent");
    }

    static async Task PipeEndToEnd(string proxyDir)
    {
        string name = "rlb-launcher-hosttest-" + Guid.NewGuid().ToString("N");
        string log = Path.Combine(Path.GetTempPath(), name + ".log");
        using (var pipe = new TicketPipe(name) { LogPath = log })
        {
            await Task.Delay(300);
            const ulong backend = 90000000004821733UL;
            byte[] envelope = Enumerable.Range(0, 53).Select(i => (byte)(i < 4 ? "RLBD"[i] : i)).ToArray();
            string hex = string.Concat(envelope.Select(b => b.ToString("x2")));

            string r = RunClient(proxyDir, name);
            Check(r.StartsWith("id=76561198000000001 len=11 ticket=") && r.Contains(" name=SteamName"), "not armed: the game sees the player's own Steam (" + r + ")");

            pipe.Arm(backend, "Website");
            pipe.RequestTicket = async ct => { await Task.Delay(200, ct); return new Ticket { BackendId = backend, Envelope = envelope }; };
            r = RunClient(proxyDir, name);
            Check(r == "id=" + backend + " len=53 ticket=" + hex + " name=Website", "armed: backend ID, launcher envelope, website name (" + r + ")");

            pipe.RequestTicket = ct => Task.FromResult<Ticket>(null);
            r = RunClient(proxyDir, name);
            Check(r.Contains(" len=0 ticket= ") && !r.Contains("53544541"), "refused: empty ticket, never the Steam one (" + r + ")");

            pipe.RequestTicket = ct => new TaskCompletionSource<Ticket>().Task; // the website never answers
            var sw = Stopwatch.StartNew();
            r = RunClient(proxyDir, name);
            Check(r.Contains(" len=0 ticket= ") && sw.Elapsed < TimeSpan.FromSeconds(10), "no answer: empty ticket within the server's 10 s (" + sw.Elapsed.TotalSeconds.ToString("0.0") + " s)");

            pipe.Disarm();
            await Task.Delay(1100);
            r = RunClient(proxyDir, name);
            Check(r.StartsWith("id=76561198000000001 len=11"), "disarmed (game exited): back to the player's own Steam");
        }
        string text = File.ReadAllText(log);
        Check(text.Contains("armed id=90000000004821733") && text.Contains("ticket id=90000000004821733 len=53") && text.Contains("ticket refused by the website or gateway")
            && text.Contains("no answer from the website or gateway in 8.5 s") && text.Contains("disarmed") && text.Contains("not armed"), "pipe.log: one line per request and arm/disarm");
        Check(!text.Contains("RLBD") && !text.Contains("0405060708"), "pipe.log never holds the envelope");
        File.Delete(log);
    }

    static string RunClient(string dir, string pipeName)
    {
        var psi = new ProcessStartInfo(Path.Combine(dir, "proxy_client.exe")) { WorkingDirectory = dir, UseShellExecute = false, RedirectStandardOutput = true };
        psi.Environment["RLB_LAUNCHER_PIPE"] = @"\\.\pipe\" + pipeName;
        using (var p = Process.Start(psi))
        {
            string output = p.StandardOutput.ReadToEnd().Trim();
            p.WaitForExit(30000);
            return output;
        }
    }

    // Two names for one file: same volume serial and file index.
    static bool SameFile(string a, string b)
    {
        BY_HANDLE_FILE_INFORMATION ia, ib;
        using (var fa = File.OpenHandle(a)) using (var fb = File.OpenHandle(b))
            return GetFileInformationByHandle(fa, out ia) && GetFileInformationByHandle(fb, out ib)
                && ia.VolumeSerialNumber == ib.VolumeSerialNumber && ia.FileIndexHigh == ib.FileIndexHigh && ia.FileIndexLow == ib.FileIndexLow;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct BY_HANDLE_FILE_INFORMATION
    {
        public uint FileAttributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime, LastAccessTime, LastWriteTime;
        public uint VolumeSerialNumber, FileSizeHigh, FileSizeLow, NumberOfLinks, FileIndexHigh, FileIndexLow;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetFileInformationByHandle(SafeFileHandle h, out BY_HANDLE_FILE_INFORMATION info);
}
