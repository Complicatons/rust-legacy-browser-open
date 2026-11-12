// The window: a WebView2 showing the host service's own dashboard (http://127.0.0.1:<port>/), the tray icon, and the
// bridge that host/dashboard/desktop-bridge.mjs desktopBridge() talks to (tests/host-desktop.test.mjs pins both sides):
//   page → app  {id, method, params} → {id, result} | {id, error, message}     calls: app.info, app.token,
//                                                                                terminal.open, terminal.close
//   page → app  {method, params}                                               notices: terminal.input,
//                                                                                terminal.resize, tray.state
//   app → page  {event: 'terminal.data', tid, data} | {event: 'terminal.exit', tid, code} | {event: 'tray.action', action}
// Rules: messages count only from the dashboard's origin (e.Source), only these methods, and the owner token and the
// shells only while the port's listener is the RustLegacyHost service (HostSettings.ListenerIsHost). The window never
// shows another site: links open in the default browser (https only). Closing the window keeps the app in the tray;
// the service keeps running either way, and Quit ends only this app and its shells.
// Owner decision 7 (29 Oct 2026): while the offline page (OfflinePage.cs) is showing, and only then, the literal
// string message "service.start" is honoured: it elevates once (a single UAC prompt) to start the Windows service.
// This is the one exception to "messages count only from the dashboard's origin" — the offline page is ours too
// (NavigateToString, not a site), and the one message it may send is a fixed string the dashboard's bridge never uses.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace RustLegacyHostApp
{
    public sealed class MainForm : Form
    {
        const int MaxShells = 8;
        static readonly HashSet<string> Methods = new HashSet<string> { "app.info", "app.token", "terminal.open", "terminal.close", "terminal.input", "terminal.resize", "tray.state" };
        static readonly Color Ink = Color.FromArgb(10, 10, 10);

        readonly HostSettings host;
        readonly WebView2 view = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Ink };
        readonly NotifyIcon tray = new NotifyIcon();
        readonly Dictionary<int, ShellSession> shells = new Dictionary<int, ShellSession>();
        readonly Dictionary<string, Icon> trayIcons = new Dictionary<string, Icon>();
        readonly Timer probe = new Timer { Interval = 2000 };
        ToolStripMenuItem startItem, stopItem, restartItem;
        string trayState = "offline";
        bool allowShow, quitting, hintShown, offlineNavigation, viewStarted, showingOffline, startingService;
        int nextTid;

        public MainForm(HostSettings settings, bool startHidden)
        {
            host = settings;
            allowShow = !startHidden;
            Text = "Rust Legacy Host";
            BackColor = Ink;
            MinimumSize = new Size(900, 600);
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            WindowPlacement.Restore(this, new Size(1440, 900));
            Controls.Add(view);

            tray.Text = "Rust Legacy Host";
            tray.Icon = TrayIcon("offline");
            tray.Visible = true;
            tray.DoubleClick += (s, e) => ShowWindow();
            tray.BalloonTipClicked += (s, e) => ShowWindow();
            var menu = new ContextMenuStrip();
            var open = new ToolStripMenuItem("Open Rust Legacy Host", null, (s, e) => ShowWindow()) { Font = new Font(SystemFonts.MenuFont, FontStyle.Bold) };
            startItem = new ToolStripMenuItem("Start server", null, (s, e) => TrayAction("start"));
            stopItem = new ToolStripMenuItem("Stop server", null, (s, e) => TrayAction("stop"));
            restartItem = new ToolStripMenuItem("Restart server", null, (s, e) => TrayAction("restart"));
            menu.Items.AddRange(new ToolStripItem[] { open, new ToolStripSeparator(), startItem, stopItem, restartItem, new ToolStripSeparator(), new ToolStripMenuItem("Quit", null, (s, e) => Quit()) });
            menu.Opening += (s, e) => UpdateMenu();
            tray.ContextMenuStrip = menu;

            probe.Tick += async (s, e) => await ProbeService();
        }

        // Started in the tray (--tray): the window and its page exist, hidden, so the tray follows the server.
        protected override void SetVisibleCore(bool value)
        {
            if (!allowShow) { value = false; if (!IsHandleCreated) CreateHandle(); }
            base.SetVisibleCore(value);
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            DarkTitleBar();
            if (!viewStarted) { viewStarted = true; _ = StartView(); } // once, even if the handle is made again
        }

        async Task StartView()
        {
            try
            {
                _ = view.Handle; // hidden at start (--tray): the control still needs its window for WebView2
                var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(HostSettings.LocalDir, "webview"));
                await view.EnsureCoreWebView2Async(env);
            }
            catch (WebView2RuntimeNotFoundException)
            {
                MessageBox.Show(this, "Rust Legacy Host needs the Microsoft Edge WebView2 Runtime, which is not installed.\n\nGet it free from Microsoft: https://go.microsoft.com/fwlink/p/?LinkId=2124703\n\nThe server keeps running; its dashboard also opens in a browser on " + host.Origin + "/.", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                quitting = true; Close(); return;
            }
            var core = view.CoreWebView2;
            core.Settings.AreDevToolsEnabled = Debugger.IsAttached;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false; // Ctrl+1..9 and Ctrl+` are the app's own shortcuts
            core.Settings.IsGeneralAutofillEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.NavigationStarting += (s, e) =>
            {
                if (IsDashboard(e.Uri)) return;
                if (offlineNavigation) { offlineNavigation = false; return; } // our own "service not answering" page
                e.Cancel = true; OpenExternal(e.Uri);
            };
            core.NewWindowRequested += (s, e) => { e.Handled = true; OpenExternal(e.Uri); };
            core.NavigationCompleted += (s, e) => { if (!e.IsSuccess && !offlineNavigation && IsDashboard(core.Source)) ShowOffline(); };
            core.ProcessFailed += (s, e) => { if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited) return; core.Reload(); };
            core.WebMessageReceived += (s, e) =>
            {
                if (showingOffline) { if (!startingService && SafeMessageString(e) == "service.start") _ = StartServiceElevated(); return; }
                // Only the dashboard may use the bridge; an error page or anything else may not.
                if (!IsDashboard(e.Source)) return;
                string json;
                try { json = e.WebMessageAsJson; } catch (Exception) { return; }
                HandleMessage(json);
            };
            core.Navigate(host.Origin + "/");
        }

        bool IsDashboard(string uri) => uri != null && uri.StartsWith(host.Origin + "/", StringComparison.Ordinal);

        static string SafeMessageString(CoreWebView2WebMessageReceivedEventArgs e)
        {
            try { return e.TryGetWebMessageAsString(); } catch (Exception) { return null; }
        }

        // ---------- The service not answering ----------
        void ShowOffline(string notice = null)
        {
            SetTray("offline", "Rust Legacy Host: the service is not answering");
            showingOffline = true;
            offlineNavigation = true;
            view.CoreWebView2.NavigateToString(OfflinePage.Html(host.Port, notice));
            probe.Start();
        }

        async Task ProbeService()
        {
            probe.Stop();
            bool up = false;
            try { using (var c = new TcpClient()) { var t = c.ConnectAsync("127.0.0.1", host.Port); up = await Task.WhenAny(t, Task.Delay(1500)) == t && c.Connected; } }
            catch (Exception) { up = false; }
            if (up) { showingOffline = false; startingService = false; view.CoreWebView2.Navigate(host.Origin + "/"); }
            else probe.Start();
        }

        // Owner decision 7: one UAC prompt, from the offline page's own button. PowerShell's Start-Service is the
        // same command the page already tells the owner to run by hand, so a declined or missing-service failure
        // reads the same either way.
        async Task StartServiceElevated()
        {
            startingService = true;
            ShowOffline("starting");
            bool ok = false, cancelled = false;
            try
            {
                var psi = new ProcessStartInfo("powershell.exe", "-NoProfile -WindowStyle Hidden -Command \"try { Start-Service RustLegacyHost -ErrorAction Stop } catch { exit 1 }\"")
                { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden };
                using (var p = Process.Start(psi)) { await Task.Run(() => p.WaitForExit(20000)); ok = p.HasExited && p.ExitCode == 0; }
            }
            catch (Win32Exception ex) when (ex.NativeErrorCode == 1223) { cancelled = true; } // ERROR_CANCELLED: the owner declined the prompt
            catch (Exception) { }
            startingService = false;
            if (ok) { probe.Stop(); await ProbeService(); }
            else if (showingOffline) ShowOffline(cancelled ? "cancelled" : "failed");
        }

        // ---------- Bridge ----------
        void Post(JsonObject message)
        {
            string json = message.ToJsonString();
            if (InvokeRequired) OnUi(() => view.CoreWebView2?.PostWebMessageAsJson(json));
            else if (!IsDisposed) view.CoreWebView2?.PostWebMessageAsJson(json);
        }

        void OnUi(Action a)
        {
            if (IsDisposed) return;
            try { BeginInvoke(a); } catch (InvalidOperationException) { } // closing
        }

        void HandleMessage(string json)
        {
            JsonNode msg;
            try { msg = JsonNode.Parse(json); } catch (JsonException) { return; }
            if (!(msg is JsonObject)) return;
            string method = (string)msg["method"];
            JsonNode p = msg["params"];
            JsonNode id = msg["id"]?.DeepClone();
            if (method == null || !Methods.Contains(method)) { if (id != null) Post(new JsonObject { ["id"] = id, ["error"] = "unknown-method" }); return; }
            try
            {
                JsonNode result = Run(method, p);
                if (id != null) Post(new JsonObject { ["id"] = id, ["result"] = result });
            }
            catch (Exception e)
            {
                if (id == null) return;
                Post(new JsonObject { ["id"] = id, ["error"] = e is HostError he ? he.Code : "failed", ["message"] = e.Message });
            }
        }

        JsonNode Run(string method, JsonNode p)
        {
            switch (method)
            {
                case "app.info":
                    return new JsonObject
                    {
                        ["version"] = Application.ProductVersion, ["port"] = host.Port, ["dataDir"] = host.DataDir, ["root"] = host.ShellFolder(),
                        ["user"] = Environment.UserName, ["machine"] = Environment.MachineName,
                    };
                case "app.token":
                    RequireHost();
                    return new JsonObject { ["token"] = host.ReadToken() };
                case "terminal.open":
                    {
                        RequireHost();
                        string shell = (string)p?["shell"];
                        if (shell != "powershell" && shell != "cmd") throw new HostError("bad-request", "unknown shell");
                        if (shells.Count >= MaxShells) throw new HostError("too-many", "Close a tab first (" + MaxShells + " at most).");
                        int cols = Clamp((int?)p["cols"] ?? 100, 10, 500), rows = Clamp((int?)p["rows"] ?? 30, 4, 300);
                        int tid = ++nextTid;
                        var session = ShellSession.Start(tid, shell, host.ShellFolder(), cols, rows);
                        session.Output += data => Post(new JsonObject { ["event"] = "terminal.data", ["tid"] = tid, ["data"] = data });
                        session.Exited += code =>
                        {
                            Post(new JsonObject { ["event"] = "terminal.exit", ["tid"] = tid, ["code"] = code });
                            OnUi(() => shells.Remove(tid));
                        };
                        shells[tid] = session;
                        return new JsonObject { ["tid"] = tid };
                    }
                case "terminal.input":
                    {
                        string data = (string)p?["data"];
                        if (data != null && data.Length <= 65536 && shells.TryGetValue((int?)p["tid"] ?? 0, out var s)) s.Write(data);
                        return null;
                    }
                case "terminal.resize":
                    if (shells.TryGetValue((int?)p?["tid"] ?? 0, out var r)) r.Resize(Clamp((int?)p["cols"] ?? 100, 10, 500), Clamp((int?)p["rows"] ?? 30, 4, 300));
                    return null;
                case "terminal.close":
                    {
                        int tid = (int?)p?["tid"] ?? 0;
                        if (shells.TryGetValue(tid, out var s)) { shells.Remove(tid); Task.Run(() => s.Dispose()); }
                        return null;
                    }
                case "tray.state":
                    SetTray((string)p?["state"], (string)p?["text"]);
                    return null;
                default:
                    throw new HostError("unknown-method", method);
            }
        }

        static int Clamp(int v, int lo, int hi) => Math.Max(lo, Math.Min(hi, v));

        void RequireHost()
        {
            if (!host.ListenerIsHost(out string why)) throw new HostError("listener-unverified", "the dashboard on this port could not be confirmed as the Rust Legacy Host service (" + why + ")");
        }

        // ---------- Tray ----------
        static readonly Dictionary<string, (string title, string text)> Notices = new Dictionary<string, (string, string)>
        {
            ["crashed"] = ("The game server crashed", "It is being restarted. Open Rust Legacy Host for its log."),
            ["frozen"] = ("The game server froze", "The watchdog is restarting it and putting the last good save back."),
            ["failed"] = ("The game server stopped restarting", "It crashed too often. Start it again once you know why; its log is in the app."),
        };

        void SetTray(string state, string text)
        {
            if (state == null || Array.IndexOf(new[] { "running", "starting", "stopped", "crashed", "failed", "frozen", "offline" }, state) < 0) return;
            string previous = trayState;
            trayState = state;
            tray.Icon = TrayIcon(state);
            string tip = string.IsNullOrEmpty(text) ? "Rust Legacy Host" : text;
            tray.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip; // the tooltip's limit
            if (state != previous && Notices.TryGetValue(state, out var n))
                tray.ShowBalloonTip(8000, n.title, n.text, state == "crashed" ? ToolTipIcon.Warning : ToolTipIcon.Error);
        }

        void UpdateMenu()
        {
            bool known = trayState != "offline";
            startItem.Enabled = known && (trayState == "stopped" || trayState == "failed");
            stopItem.Enabled = known && trayState != "stopped";
            restartItem.Enabled = known && trayState == "running";
        }

        // Stop and restart can ask a question (save-and-quit), so the window comes forward first.
        void TrayAction(string action)
        {
            if (action != "start") ShowWindow();
            Post(new JsonObject { ["event"] = "tray.action", ["action"] = action });
        }

        // The dashboard's icon (host/dashboard/icon.svg) with its bottom bar in the state's colour.
        Icon TrayIcon(string state)
        {
            if (trayIcons.TryGetValue(state, out var cached)) return cached;
            Color bar = state == "running" ? Color.FromArgb(95, 169, 160) : state == "starting" ? Color.FromArgb(232, 169, 58)
                : state == "crashed" || state == "failed" || state == "frozen" ? Color.FromArgb(239, 107, 95) : Color.FromArgb(85, 82, 78);
            Color body = state == "offline" ? Color.FromArgb(110, 70, 52) : Color.FromArgb(205, 90, 40);
            int size = SystemInformation.SmallIconSize.Width;
            using (var bmp = new Bitmap(size, size))
            {
                using (var g = Graphics.FromImage(bmp))
                {
                    float u = size / 32f;
                    g.Clear(Ink);
                    using (var b = new SolidBrush(body)) g.FillRectangle(b, 5 * u, 5 * u, 22 * u, 22 * u);
                    using (var b = new SolidBrush(bar)) g.FillRectangle(b, 5 * u, 20 * u, 22 * u, 7 * u);
                }
                IntPtr h = bmp.GetHicon();
                var icon = (Icon)Icon.FromHandle(h).Clone();
                DestroyIcon(h);
                trayIcons[state] = icon;
                return icon;
            }
        }

        // ---------- Window ----------
        public void ShowWindow()
        {
            allowShow = true;
            Show();
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Activate();
        }

        static void OpenExternal(string url)
        {
            if (Uri.TryCreate(url, UriKind.Absolute, out Uri u) && u.Scheme == Uri.UriSchemeHttps)
                Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true });
        }

        // Closing the window keeps the app in the tray: it is how the owner hears about a crash or a freeze.
        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            WindowPlacement.Save(this);
            if (!quitting && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
                if (!hintShown) { hintShown = true; tray.ShowBalloonTip(5000, "Rust Legacy Host is in the tray", "Your server keeps running whether this window is open or not. Quit from the tray icon.", ToolTipIcon.Info); }
                return;
            }
            base.OnFormClosing(e);
        }

        void Quit()
        {
            if (shells.Count > 0 && MessageBox.Show(this, "Quitting closes your open PowerShell and CMD tabs and what runs in them. The server keeps running.", Text, MessageBoxButtons.OKCancel, MessageBoxIcon.Warning) != DialogResult.OK) return;
            quitting = true;
            Close();
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            probe.Dispose();
            foreach (var s in shells.Values) s.Dispose();
            shells.Clear();
            tray.Visible = false;
            tray.Dispose();
            base.OnFormClosed(e);
        }

        // A dark title bar to match the page (Windows 10 20H1 and later; ignored elsewhere), black caption on Windows 11.
        void DarkTitleBar()
        {
            int on = 1, caption = 0x000A0A0A;
            DwmSetWindowAttribute(Handle, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, ref on, sizeof(int));
            DwmSetWindowAttribute(Handle, 35 /* DWMWA_CAPTION_COLOR */, ref caption, sizeof(int));
        }

        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
        [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr handle);
    }

    // The window's size and place, per Windows user (%LOCALAPPDATA%\RustLegacyHost\window.json).
    static class WindowPlacement
    {
        static string File => Path.Combine(HostSettings.LocalDir, "window.json");
        public static void Restore(Form f, Size fallback)
        {
            f.StartPosition = FormStartPosition.CenterScreen;
            var area = Screen.PrimaryScreen.WorkingArea;
            f.ClientSize = new Size(Math.Min(fallback.Width, area.Width - 80), Math.Min(fallback.Height, area.Height - 80));
            try
            {
                using (var doc = JsonDocument.Parse(System.IO.File.ReadAllText(File)))
                {
                    var r = doc.RootElement;
                    var b = new Rectangle(r.GetProperty("x").GetInt32(), r.GetProperty("y").GetInt32(), r.GetProperty("w").GetInt32(), r.GetProperty("h").GetInt32());
                    if (b.Width >= f.MinimumSize.Width && b.Height >= f.MinimumSize.Height && Array.Exists(Screen.AllScreens, s => s.WorkingArea.IntersectsWith(b)))
                    {
                        f.StartPosition = FormStartPosition.Manual;
                        f.Bounds = b;
                        if (r.TryGetProperty("max", out var m) && m.GetBoolean()) f.WindowState = FormWindowState.Maximized;
                    }
                }
            }
            catch (Exception) { }
        }
        public static void Save(Form f)
        {
            try
            {
                var b = f.WindowState == FormWindowState.Normal ? f.Bounds : f.RestoreBounds;
                Directory.CreateDirectory(HostSettings.LocalDir);
                System.IO.File.WriteAllText(File, new JsonObject { ["x"] = b.X, ["y"] = b.Y, ["w"] = b.Width, ["h"] = b.Height, ["max"] = f.WindowState == FormWindowState.Maximized }.ToJsonString());
            }
            catch (Exception) { }
        }
    }
}
