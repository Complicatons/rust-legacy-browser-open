// RustLegacyHostSetup.exe: the installer a server owner downloads (HOST-APP-PLAN.md "Owner installer"). Built by
// tools/build-host-installer.mjs with the .NET Framework compiler every Windows has; the kit zip is embedded as a resource.
//   (no arguments)  wizard: welcome (version, signature) → your server (folder or RustLegacyServer.zip, SHA-256 checked by
//                   the app's own host/setup.mjs) → options → install (Install-RustLegacyHost.ps1 -Apply) → open dashboard
//   /dashboard      opens the installed dashboard in a browser, signed in (the Start menu shortcut of a kit without the
//                   desktop app; with it, the shortcut opens the app, host/desktop)
//   /uninstall      Windows' list of installed apps: asks, then runs Uninstall-RustLegacyHost.ps1 -Apply from a copy of itself in %TEMP%
//   /silent         unattended: /server=<dir> | /serverzip=<zip>, /accept, /opengateway, /blockoutbound, /installdir=,
//                   /datadir=, /log=<file>; with /uninstall: /restoreserver, /removedata. Exit code 0 on success.
//   /snapshot=<dir> [/server=<dir>]  saves each wizard page as a PNG and exits, installing nothing (tests, docs)
// The wizard never starts the original server: the owner does that from the dashboard after the Setup page.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

static class Setup
{
    public const string Service = "RustLegacyHost";
    public static readonly string DefaultInstall = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Rust Legacy Host");
    public static readonly string DefaultData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Rust Legacy Host");
    public static readonly string Self = Assembly.GetExecutingAssembly().Location;
    static readonly Dictionary<string, string> opts = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    public static bool Has(string k) { return opts.ContainsKey(k); }
    public static string Opt(string k, string def) { string v; return opts.TryGetValue(k, out v) && v != "" ? v : def; }

    [STAThread]
    static int Main(string[] args)
    {
        foreach (string a in args)
        {
            if (!a.StartsWith("/")) continue;
            int i = a.IndexOf('=');
            if (i < 0) opts[a.Substring(1)] = ""; else opts[a.Substring(1, i - 1)] = a.Substring(i + 1);
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
            if (Has("dashboard")) return OpenDashboard(true) ? 0 : 1;
            if (Has("uninstall")) return Uninstall();
            if (Has("silent")) return SilentInstall();
            var wizard = new Wizard();
            if (Has("snapshot")) wizard.Snapshot(Opt("snapshot", "."), Opt("server", null));
            Application.Run(wizard);
            return 0;
        }
        catch (Exception e)
        {
            Log("Error: " + e.Message);
            if (!Has("silent")) MessageBox.Show(e.Message, "Rust Legacy Host Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    public static void Log(string line)
    {
        string f = Opt("log", null);
        if (f != null) try { File.AppendAllText(f, DateTime.Now.ToString("s") + " " + line + Environment.NewLine); } catch { }
    }

    // ---------- The kit inside this exe ----------
    static string kitDir;
    public static string Kit(Action<int> progress)
    {
        if (kitDir != null) return kitDir;
        string root = Path.Combine(Path.GetTempPath(), "RustLegacyHostSetup-" + Guid.NewGuid().ToString("N").Substring(0, 8));
        using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("RustLegacyHost.zip"))
        using (ZipArchive zip = new ZipArchive(s, ZipArchiveMode.Read))
        {
            int n = 0, total = zip.Entries.Count;
            foreach (ZipArchiveEntry e in zip.Entries)
            {
                string dest = Path.GetFullPath(Path.Combine(root, e.FullName));
                if (!dest.StartsWith(root + Path.DirectorySeparatorChar)) throw new Exception("The setup program is damaged (bad path " + e.FullName + ")");
                if (e.FullName.EndsWith("/")) Directory.CreateDirectory(dest);
                else { Directory.CreateDirectory(Path.GetDirectoryName(dest)); e.ExtractToFile(dest, true); }
                if (progress != null && (++n % 200 == 0 || n == total)) progress(n * 100 / total);
            }
        }
        kitDir = Path.Combine(root, "RustLegacyHost");
        return kitDir;
    }
    public static void CleanKit() { if (kitDir != null) try { Directory.Delete(Path.GetDirectoryName(kitDir), true); } catch { } }

    // Runs a program and returns its exit code; each output line goes to onLine.
    public static int Run(string exe, string args, Action<string> onLine)
    {
        var psi = new ProcessStartInfo(exe, args) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8 };
        using (var p = Process.Start(psi))
        {
            p.OutputDataReceived += (o, e) => { if (e.Data != null && onLine != null) onLine(e.Data); };
            p.ErrorDataReceived += (o, e) => { if (e.Data != null && onLine != null) onLine(e.Data); };
            p.BeginOutputReadLine(); p.BeginErrorReadLine();
            p.WaitForExit();
            return p.ExitCode;
        }
    }
    public static string Q(string s) { return "\"" + s.Replace("\"", "\\\"") + "\""; }

    // host/setup.mjs in the kit: inspect <dir> | checkzip <zip> | unpack <zip> <dest>. Returns its JSON.
    public static Dictionary<string, object> Node(string verb, params string[] args)
    {
        string kit = Kit(null), sb = Q(Path.Combine(kit, "app", "host", "setup.mjs")) + " " + verb;
        foreach (string a in args) sb += " " + Q(a);
        var output = new StringBuilder();
        Run(Path.Combine(kit, "node", "node.exe"), sb, l => output.AppendLine(l));
        string text = output.ToString().Trim(), last = text.Substring(text.LastIndexOf('\n') + 1);
        try { return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(last); }
        catch { throw new Exception("The setup check gave no answer: " + text); }
    }

    // ---------- Signature and version ----------
    public static string Signer()
    {
        try { var c = X509Certificate.CreateFromSignedFile(Self); var m = Regex.Match(c.Subject, "CN=\"?([^,\"]+)"); return m.Success ? m.Groups[1].Value : c.Subject; }
        catch { return null; }
    }
    public static string Sha256Self()
    {
        using (var f = File.OpenRead(Self)) using (var h = SHA256.Create()) return BitConverter.ToString(h.ComputeHash(f)).Replace("-", "");
    }
    public static string InstalledVersion()
    {
        try
        {
            using (var k = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\" + Service))
                return k == null ? null : (string)k.GetValue("DisplayVersion");
        }
        catch { return null; }
    }
    public static string InstalledDir()
    {
        try
        {
            using (var k = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\" + Service))
                return k == null ? null : (string)k.GetValue("InstallLocation");
        }
        catch { return null; }
    }

    // ---------- Install ----------
    public class Choices { public string Install = DefaultInstall, Data = DefaultData, Server, ServerZip; public bool Accept, OpenGateway = true, BlockOutbound = true; }

    public static int Install(Choices c, Action<string> onLine)
    {
        string kit = Kit(null);
        string server = c.Server;
        if (c.ServerZip != null)
        {
            string dest = Path.Combine(c.Data, "server");
            onLine("Checking and unpacking " + c.ServerZip + " into " + dest + " ...");
            var r = Node("unpack", c.ServerZip, dest);
            if (r.ContainsKey("error")) { onLine("Error: " + r["error"]); return 1; }
            server = (string)r["dir"];
        }
        string a = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File " + Q(Path.Combine(kit, "Install-RustLegacyHost.ps1")) + " -Apply"
            + " -InstallDir " + Q(c.Install) + " -DataDir " + Q(c.Data) + " -SetupExe " + Q(Self);
        if (server != null) a += " -ServerDir " + Q(server) + (c.Accept ? " -AcceptServerBuild" : "");
        if (c.OpenGateway) a += " -OpenGateway";
        if (c.BlockOutbound && server != null) a += " -BlockServerOutbound";
        // The sign-in link is for the browser only, never the log on screen.
        return Run(Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe"), a, l => onLine(Regex.Replace(l, "#token=[A-Za-z0-9_-]+", "#token=…")));
    }

    static int SilentInstall()
    {
        var c = new Choices { Install = Opt("installdir", DefaultInstall), Data = Opt("datadir", DefaultData), Server = Opt("server", null), ServerZip = Opt("serverzip", null),
            Accept = Has("accept"), OpenGateway = Has("opengateway"), BlockOutbound = Has("blockoutbound") };
        Log("Rust Legacy Host Setup " + BuildInfo.Version + " (silent), signed: " + (Signer() ?? "no"));
        int code = Install(c, Log);
        Log("exit " + code);
        CleanKit();
        return code;
    }

    // ---------- Dashboard ----------
    public static bool OpenDashboard(bool showErrors)
    {
        string install = InstalledDir() ?? DefaultInstall, settings = Path.Combine(install, @"service\RustLegacyHostService.json");
        try
        {
            var w = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(settings));
            var host = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText((string)w["config"]));
            int port = 28100;
            object listen; if (host.TryGetValue("listen", out listen) && listen is Dictionary<string, object> && ((Dictionary<string, object>)listen).ContainsKey("port")) port = Convert.ToInt32(((Dictionary<string, object>)listen)["port"]);
            string token = File.ReadAllText(Path.Combine((string)w["dataDir"], "owner.token")).Trim();
            // explorer.exe hands the link to the signed-in user's own browser, not an elevated one.
            Process.Start(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"), "\"http://127.0.0.1:" + port + "/#token=" + token + "\"");
            return true;
        }
        catch (Exception e)
        {
            if (showErrors) MessageBox.Show("The dashboard is not ready: " + e.Message + "\n\nIs the Rust Legacy Host service running? (Services → Rust Legacy Host)", "Rust Legacy Host", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return false;
        }
    }

    // The desktop app (host/desktop) when the kit had it: it signs the owner in by itself. explorer.exe starts it as the
    // signed-in user, not elevated like this program.
    public static bool OpenApp()
    {
        string app = Path.Combine(InstalledDir() ?? DefaultInstall, @"desktop\RustLegacyHost.exe");
        if (!File.Exists(app)) return false;
        Process.Start(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"), "\"" + app + "\"");
        return true;
    }

    // ---------- Uninstall ----------
    static int Uninstall()
    {
        string install = Opt("installdir", InstalledDir() ?? DefaultInstall);
        // Run from a copy in %TEMP% so the install folder can be deleted.
        if (!Has("fromtemp") && Self.StartsWith(install, StringComparison.OrdinalIgnoreCase))
        {
            string copy = Path.Combine(Path.GetTempPath(), "RustLegacyHostUninstall-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".exe");
            File.Copy(Self, copy);
            var rest = new StringBuilder("/fromtemp /installdir=" + Q(install));
            foreach (var kv in opts) if (kv.Key != "installdir") rest.Append(" /" + kv.Key + (kv.Value != "" ? "=" + Q(kv.Value) : ""));
            var p = Process.Start(copy, rest.ToString());
            if (Has("silent")) { p.WaitForExit(); return p.ExitCode; }
            return 0;
        }
        bool restore = Has("restoreserver"), remove = Has("removedata");
        if (!Has("silent"))
        {
            using (var f = new UninstallForm()) { if (f.ShowDialog() != DialogResult.OK) return 1; restore = f.Restore; remove = f.RemoveData; }
        }
        string script = Path.Combine(install, "Uninstall-RustLegacyHost.ps1");
        if (!File.Exists(script)) throw new Exception(script + " is missing. Delete the service and the folder by hand.");
        string a = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File " + Q(script) + " -Apply -InstallDir " + Q(install) + (restore ? " -RestoreServer" : "") + (remove ? " -RemoveData" : "");
        var log = new StringBuilder();
        int code = Run(Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe"), a, l => { log.AppendLine(l); Log(l); });
        if (!Has("silent")) MessageBox.Show(code == 0 ? "Rust Legacy Host was removed." : "Uninstall did not finish:\n\n" + log, "Rust Legacy Host", MessageBoxButtons.OK, code == 0 ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
        return code;
    }
}

// ---------- Look: the site's near-black surfaces and orange accent ----------
static class Look
{
    public static readonly Color K = Color.FromArgb(10, 10, 10), K1 = Color.FromArgb(17, 17, 17), K2 = Color.FromArgb(24, 24, 24), Line = Color.FromArgb(54, 54, 54);
    public static readonly Color W = Color.FromArgb(242, 239, 233), W2 = Color.FromArgb(185, 181, 174), W3 = Color.FromArgb(127, 123, 117);
    public static readonly Color Or = Color.FromArgb(205, 90, 40), Teal = Color.FromArgb(95, 169, 160), Amber = Color.FromArgb(232, 169, 58), Red = Color.FromArgb(239, 107, 95);
    public static readonly Font Body = new Font("Segoe UI", 10f), Small = new Font("Segoe UI", 9f), Mono = new Font("Consolas", 9f), Title = new Font("Segoe UI Black", 20f), Eyebrow = new Font("Consolas", 8.5f, FontStyle.Bold);
    public static Label Text(string t, Font f, Color c, int w) { return new Label { Text = t, Font = f, ForeColor = c, AutoSize = true, MaximumSize = new Size(w, 0), Margin = new Padding(0, 0, 0, 10) }; }
    public static Button Btn(string t, bool primary)
    {
        var b = new Button { Text = t, FlatStyle = FlatStyle.Flat, Font = new Font("Segoe UI Semibold", 9.5f), ForeColor = primary ? Color.White : W, BackColor = primary ? Or : K2, AutoSize = true, MinimumSize = new Size(96, 34), Padding = new Padding(10, 2, 10, 2), Cursor = Cursors.Hand };
        b.FlatAppearance.BorderColor = primary ? Or : Line;
        return b;
    }
    public static TextBox Box(bool readOnly) { return new TextBox { BackColor = K, ForeColor = W, BorderStyle = BorderStyle.FixedSingle, Font = Body, ReadOnly = readOnly }; }
    public static CheckBox Check(string t, bool on) { return new CheckBox { Text = t, Checked = on, ForeColor = W2, Font = Body, AutoSize = true, MaximumSize = new Size(600, 0), Margin = new Padding(0, 4, 0, 8) }; }
}

class Wizard : Form
{
    readonly Panel body = new Panel { Dock = DockStyle.Fill, BackColor = Look.K1, Padding = new Padding(36, 24, 36, 12) };
    readonly Button back = Look.Btn("Back", false), next = Look.Btn("Next", true), cancel = Look.Btn("Cancel", false);
    readonly Label step = new Label { ForeColor = Look.Or, Font = Look.Eyebrow, AutoSize = true, Location = new Point(36, 20) };
    readonly Setup.Choices c = new Setup.Choices();
    int page;
    bool kitReady, checkedOk, installing, done;
    Dictionary<string, object> inspected;
    readonly string installed = Setup.InstalledVersion();

    // Server page
    readonly RadioButton useDir = new RadioButton { Text = "My server folder (the one with rust_server.exe)", Checked = true }, useZip = new RadioButton { Text = "RustLegacyServer.zip (unpacked for you)" }, useLater = new RadioButton { Text = "Later: I will choose it on the dashboard's Setup page" };
    readonly TextBox path = Look.Box(false), result = Look.Box(true);
    readonly CheckBox accept = Look.Check("This is my own build: run it even though it is not the verified one, and record its SHA-256", false);
    readonly Button browse = Look.Btn("Browse…", false), check = Look.Btn("Check", false);
    // Options page
    readonly TextBox installDir = Look.Box(false), dataDir = Look.Box(false);
    readonly CheckBox openGateway = Look.Check("Let browser players reach the gateway through Windows Firewall", true);
    readonly CheckBox blockOut = Look.Check("Keep the game server offline: block its outgoing internet", true);
    // Install page
    readonly TextBox log = Look.Box(true);
    readonly ProgressBar bar = new ProgressBar { Style = ProgressBarStyle.Marquee, Height = 6, Dock = DockStyle.Top };

    public Wizard()
    {
        Text = "Rust Legacy Host Setup";
        try { Icon = Icon.ExtractAssociatedIcon(Setup.Self); } catch { }
        ClientSize = new Size(720, 520); FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; StartPosition = FormStartPosition.CenterScreen;
        BackColor = Look.K1; ForeColor = Look.W; Font = Look.Body;
        var head = new Panel { Dock = DockStyle.Top, Height = 92, BackColor = Look.K };
        head.Controls.Add(step);
        head.Controls.Add(new Label { Text = "RUST LEGACY HOST", Font = Look.Title, ForeColor = Look.W, AutoSize = true, Location = new Point(32, 38) });
        head.Paint += (s, e) => { e.Graphics.FillRectangle(new SolidBrush(Look.Or), 0, head.Height - 3, 120, 3); };
        var foot = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 64, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(24, 14, 24, 14), BackColor = Look.K };
        foot.Controls.Add(next); foot.Controls.Add(back); foot.Controls.Add(cancel);
        Controls.Add(body); Controls.Add(foot); Controls.Add(head);
        back.Click += (s, e) => Show(page - 1);
        next.Click += (s, e) => Next();
        cancel.Click += (s, e) => Close();
        FormClosing += (s, e) => { if (installing) { e.Cancel = true; return; } Setup.CleanKit(); };
        foreach (var r in new[] { useDir, useZip, useLater }) { r.ForeColor = Look.W2; r.AutoSize = true; r.Margin = new Padding(0, 2, 0, 4); r.CheckedChanged += (s, e) => { checkedOk = false; result.Text = ""; accept.Visible = false; Buttons(); }; }
        browse.Click += (s, e) => Browse();
        check.Click += (s, e) => Check();
        path.TextChanged += (s, e) => { checkedOk = false; Buttons(); };
        accept.CheckedChanged += (s, e) => Buttons();
        installDir.Text = Setup.InstalledDir() ?? c.Install; dataDir.Text = c.Data;
        result.Multiline = true; result.ScrollBars = ScrollBars.Vertical; result.Font = Look.Mono; result.Height = 110;
        log.Multiline = true; log.ScrollBars = ScrollBars.Vertical; log.Font = Look.Mono; log.Dock = DockStyle.Fill; log.WordWrap = true;
        // Unpack the kit while the owner reads the first page.
        new Thread(() =>
        {
            try { Setup.Kit(p => BeginInvoke((Action)(() => step.Text = "PREPARING " + p + "%"))); BeginInvoke((Action)(() => { kitReady = true; Show(page); })); }
            catch (Exception e) { BeginInvoke((Action)(() => { MessageBox.Show("The setup program could not unpack itself: " + e.Message, Text); Close(); })); }
        }) { IsBackground = true }.Start();
        Show(0);
    }

    // /snapshot: walks the pages without installing, saving page-<n>.png for each (page 1 after checking /server=).
    public void Snapshot(string dir, string server)
    {
        Directory.CreateDirectory(dir);
        int stage = 0;
        var t = new System.Windows.Forms.Timer { Interval = 400 };
        Action<string> save = n => { using (var b = new Bitmap(Width, Height)) { DrawToBitmap(b, new Rectangle(0, 0, Width, Height)); b.Save(Path.Combine(dir, n), System.Drawing.Imaging.ImageFormat.Png); } };
        t.Tick += (s, e) =>
        {
            if (!kitReady) return;
            if (stage == 0 && !Regex.IsMatch(Controls.Count > 0 ? AllText(body) : "", "SHA-256 [0-9A-F]{64}")) return;
            if (stage == 0) { save("page-0.png"); Show(1); if (server != null) { path.Text = server; Check(); } stage = 1; return; }
            if (stage == 1) { if (server != null && (result.Text == "" || result.Text.StartsWith("Checking"))) return; save("page-1.png"); File.WriteAllText(Path.Combine(dir, "check.txt"), result.Text); Show(2); stage = 2; return; }
            if (stage == 2) { save("page-2.png"); t.Stop(); Close(); }
        };
        Shown += (s, e) => t.Start();
    }
    static string AllText(Control c) { var sb = new StringBuilder(c.Text); foreach (Control x in c.Controls) sb.Append(" ").Append(AllText(x)); return sb.ToString(); }

    FlowLayoutPanel Page(string eyebrow)
    {
        body.Controls.Clear();
        step.Text = eyebrow;
        var f = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true };
        body.Controls.Add(f);
        return f;
    }
    void Buttons()
    {
        back.Visible = page > 0 && page < 3; cancel.Visible = page < 4;
        next.Text = page == 2 ? (installed != null ? "Update" : "Install") : page == 4 ? "Finish" : "Next";
        next.Enabled = kitReady && !installing && (page != 1 || useLater.Checked || (checkedOk && (accept.Checked || !accept.Visible)));
        check.Enabled = kitReady && path.Text.Trim() != "";
        path.Enabled = browse.Enabled = !useLater.Checked;
    }

    void Show(int p)
    {
        page = p;
        int w = 610;
        if (p == 0)
        {
            var f = Page("STEP 1 OF 4 · WELCOME");
            f.Controls.Add(Look.Text("Version " + BuildInfo.Version + (installed != null ? "  ·  installed now: " + installed : ""), Look.Eyebrow, Look.W3, w));
            f.Controls.Add(Look.Text(installed != null
                ? "This updates Rust Legacy Host on this PC. Your settings, secrets, logs and backups stay as they are."
                : "This installs Rust Legacy Host: a Windows service that runs your own Legacy server with the gateway that lets browser players in, watches it and restarts it if it freezes, and gives you a dashboard on this PC and on the website.", Look.Body, Look.W, w));
            f.Controls.Add(Look.Text("We never supply the game's server files. You point the app at your own copy; it checks the SHA-256 and starts it only after you confirm it on the dashboard.", Look.Body, Look.W2, w));
            string signer = Setup.Signer();
            var sig = Look.Text(signer != null ? "Signed by " + signer + "." : "This installer is NOT code-signed yet, so Windows SmartScreen warns about it. Compare its SHA-256 below with the one on your-domain.example/docs/install-the-host-app before you go on.", Look.Body, signer != null ? Look.Teal : Look.Amber, w);
            f.Controls.Add(sig);
            var sha = Look.Text("SHA-256 …", Look.Mono, Look.W3, w);
            f.Controls.Add(sha);
            new Thread(() => { string h = Setup.Sha256Self(); BeginInvoke((Action)(() => sha.Text = "SHA-256 " + h)); }) { IsBackground = true }.Start();
        }
        else if (p == 1)
        {
            var f = Page("STEP 2 OF 4 · YOUR SERVER");
            f.Controls.Add(Look.Text("Where is your Rust Legacy server? The app checks rust_server.exe's SHA-256 against the verified build and works out how to make the server browser ready.", Look.Body, Look.W, w));
            f.Controls.Add(useDir); f.Controls.Add(useZip); f.Controls.Add(useLater);
            var row = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.LeftToRight, WrapContents = false, Margin = new Padding(0, 8, 0, 8) };
            path.Width = 380; row.Controls.Add(path); row.Controls.Add(browse); row.Controls.Add(check);
            f.Controls.Add(row);
            result.Width = w; f.Controls.Add(result);
            accept.Visible = inspected != null && accept.Visible; f.Controls.Add(accept);
        }
        else if (p == 2)
        {
            var f = Page("STEP 3 OF 4 · OPTIONS");
            f.Controls.Add(Look.Text("Install folder", Look.Eyebrow, Look.W3, w)); installDir.Width = w; f.Controls.Add(installDir);
            f.Controls.Add(Look.Text("Data folder (settings, secrets, logs, backups; only administrators and the app can open it)", Look.Eyebrow, Look.W3, w)); dataDir.Width = w; f.Controls.Add(dataDir);
            f.Controls.Add(new Label { Height = 8 });
            f.Controls.Add(openGateway);
            blockOut.Enabled = !useLater.Checked; f.Controls.Add(blockOut);
            f.Controls.Add(Look.Text("Recommended for a stock server. Leave it off if your plugins call web services (Discord, stats sites).", Look.Small, Look.W3, w));
            f.Controls.Add(Look.Text("The app runs as its own Windows account, NT SERVICE\\RustLegacyHost: no password, not an administrator. It can change only its data folder and your server folder.", Look.Small, Look.W3, w));
        }
        else if (p == 3)
        {
            var f = Page("STEP 4 OF 4 · INSTALLING");
            body.Controls.Clear();
            body.Controls.Add(log); body.Controls.Add(bar);
        }
        else
        {
            var f = Page(done ? "DONE" : "SOMETHING WENT WRONG");
            f.Controls.Add(Look.Text(done ? "Rust Legacy Host is running." : "The install did not finish. The log below says where it stopped; nothing half-done is started.", Look.Body, done ? Look.W : Look.Red, w));
            if (done)
            {
                f.Controls.Add(Look.Text("Next, on the dashboard's Setup page: make your server browser ready, connect it to the website with an enrolment code from Your servers, set its public address, and confirm that the app may start it.", Look.Body, Look.W2, w));
                f.Controls.Add(Look.Text("Open the dashboard any time from the Start menu: Rust Legacy Host.", Look.Body, Look.W2, w));
            }
            else { var copy = Look.Box(true); copy.Multiline = true; copy.Height = 220; copy.Width = w; copy.Font = Look.Mono; copy.ScrollBars = ScrollBars.Vertical; copy.Text = log.Text; f.Controls.Add(copy); }
        }
        Buttons();
    }

    void Browse()
    {
        if (useZip.Checked)
        {
            using (var d = new OpenFileDialog { Filter = "Server package (*.zip)|*.zip", Title = "Choose RustLegacyServer.zip" }) if (d.ShowDialog(this) == DialogResult.OK) path.Text = d.FileName;
        }
        else using (var d = new FolderBrowserDialog { Description = "Choose the folder that holds rust_server.exe" }) if (d.ShowDialog(this) == DialogResult.OK) path.Text = d.SelectedPath;
    }

    void Check()
    {
        string target = path.Text.Trim().Trim('"');
        check.Enabled = false; result.Text = "Checking (a large file takes a few seconds)…"; accept.Visible = false; checkedOk = false; Buttons();
        bool zip = useZip.Checked;
        new Thread(() =>
        {
            string text; bool ok = false, unverified = false;
            try
            {
                var r = Setup.Node(zip ? "checkzip" : "inspect", target);
                if (r.ContainsKey("error")) text = "✗ " + r["error"];
                else if (zip)
                {
                    ok = (bool)r["verified"];
                    text = (ok ? "✓ The verified server package." : "✗ This is not the verified package. Unpack it yourself and choose the folder instead.") + "\r\nSHA-256 " + r["sha256"];
                }
                else
                {
                    inspected = r;
                    var exe = (Dictionary<string, object>)r["exe"]; var ready = (Dictionary<string, object>)r["browserReady"];
                    ok = (bool)r["found"]; unverified = ok && !(bool)exe["verified"];
                    var sb = new StringBuilder();
                    if (!ok) sb.AppendLine("✗ No rust_server.exe in this folder.");
                    else
                    {
                        sb.AppendLine(((bool)exe["verified"] ? "✓ rust_server.exe is the verified build." : "! rust_server.exe is not the verified build.") + "  SHA-256 " + exe["sha256"]);
                        sb.AppendLine("Server build: " + Frame(r["framework"] as string));
                        sb.AppendLine((bool)ready["possible"] ? "✓ Can be made browser ready (" + (ready["how"] as string == "oxide" ? "our Oxide plugin" : "our adapter patch") + ") on the dashboard." : "! " + ready["reason"]);
                    }
                    foreach (object n in (System.Collections.ArrayList)r["notes"]) sb.AppendLine("• " + n);
                    text = sb.ToString();
                }
            }
            catch (Exception e) { text = "✗ " + e.Message; }
            BeginInvoke((Action)(() =>
            {
                result.Text = text; checkedOk = ok; accept.Visible = unverified; accept.Checked = false;
                blockOut.Checked = inspected == null || (inspected["framework"] as string ?? "").StartsWith("stock");
                Buttons();
            }));
        }) { IsBackground = true }.Start();
    }
    static string Frame(string f)
    {
        switch (f) { case "stock": return "stock Legacy server"; case "stock-patched": return "stock, already browser ready"; case "oxide": return "Oxide"; case "fougerite": return "Fougerite"; case "modded": return "a modified build we do not know"; default: return "unknown"; }
    }

    void Next()
    {
        if (page == 4) { if (done && !Setup.OpenApp()) Setup.OpenDashboard(true); Close(); return; }
        if (page < 2) { Show(page + 1); return; }
        // Install
        c.Install = installDir.Text.Trim(); c.Data = dataDir.Text.Trim();
        c.Server = useDir.Checked ? path.Text.Trim().Trim('"') : null; c.ServerZip = useZip.Checked ? path.Text.Trim().Trim('"') : null;
        c.Accept = accept.Visible && accept.Checked; c.OpenGateway = openGateway.Checked; c.BlockOutbound = blockOut.Checked && !useLater.Checked;
        Show(3); installing = true; Buttons();
        new Thread(() =>
        {
            int code;
            try { code = Setup.Install(c, l => BeginInvoke((Action)(() => log.AppendText(l + Environment.NewLine)))); }
            catch (Exception e) { BeginInvoke((Action)(() => log.AppendText("Error: " + e.Message + Environment.NewLine))); code = 1; }
            BeginInvoke((Action)(() => { installing = false; done = code == 0; Show(4); }));
        }) { IsBackground = true }.Start();
    }
}

class UninstallForm : Form
{
    readonly CheckBox restore = Look.Check("Put my server's own files back (undo browser ready)", true), data = Look.Check("Also delete settings, secrets, logs and backups", false);
    public bool Restore { get { return restore.Checked; } }
    public bool RemoveData { get { return data.Checked; } }
    public UninstallForm()
    {
        Text = "Remove Rust Legacy Host"; ClientSize = new Size(520, 230); FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = MinimizeBox = false; StartPosition = FormStartPosition.CenterScreen;
        BackColor = Look.K1; ForeColor = Look.W; Font = Look.Body;
        var f = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, Padding = new Padding(24, 20, 24, 0) };
        f.Controls.Add(Look.Text("This stops the Rust Legacy Host service and removes the app. Your game server's saves are never deleted.", Look.Body, Look.W, 470));
        f.Controls.Add(restore); f.Controls.Add(data);
        var row = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 60, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(20, 12, 20, 12), BackColor = Look.K };
        var ok = Look.Btn("Remove", true); var no = Look.Btn("Cancel", false);
        ok.Click += (s, e) => { DialogResult = DialogResult.OK; Close(); };
        no.Click += (s, e) => { DialogResult = DialogResult.Cancel; Close(); };
        row.Controls.Add(ok); row.Controls.Add(no);
        Controls.Add(f); Controls.Add(row);
    }
}
