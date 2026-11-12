// The launcher window: a WebView2 showing launcher/ui (served from the exe's web\ folder on a virtual host, never
// from the network), the tray icon, and the message bridge that hosts.mjs webviewHost() talks to:
//   page → host  {id, method, params}       host → page  {id, result} | {id, error}
//   host → page  {event: 'ticketRequest', requestId} | {event: 'gameExited'} | {event: 'signOut'}
// The host does what a page cannot: HTTP without CORS or cookies, DPAPI for the token, the remembered login name in
// settings.json, the hardware ID (HardwareId), building the launch profile, starting and watching the game, and
// answering the steam_api proxy over its pipe (TicketPipe).
using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace RustLegacyLauncher
{
    public sealed class MainForm : Form
    {
        const string AppHost = "launcher.rustlegacy.internal";
        static readonly HttpClient Http = new HttpClient(new SocketsHttpHandler { UseCookies = false, AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(15) };

        readonly WebView2 view = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(10, 10, 10) };
        readonly NotifyIcon tray = new NotifyIcon();
        readonly TicketPipe pipe = new TicketPipe();
        readonly ConcurrentDictionary<int, TaskCompletionSource<Ticket>> tickets = new ConcurrentDictionary<int, TaskCompletionSource<Ticket>>();
        Settings settings = Storage.LoadSettings();
        Process game;
        string phase = "starting";
        int nextTicket;
        bool quitting;

        public MainForm()
        {
            Text = "Rust Legacy Launcher";
            // The height follows the page (OnState "height"): each step is as tall as its content, no taller.
            ClientSize = new Size(420, 600);
            MinimumSize = new Size(360, 320);
            BackColor = Color.FromArgb(10, 10, 10);
            StartPosition = FormStartPosition.CenterScreen;
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            Controls.Add(view);

            tray.Icon = Icon;
            tray.Text = "Rust Legacy Launcher";
            tray.Visible = true;
            tray.DoubleClick += (s, e) => ShowWindow();
            tray.ContextMenuStrip = new ContextMenuStrip();
            tray.ContextMenuStrip.Items.Add("Open", null, (s, e) => ShowWindow());
            tray.ContextMenuStrip.Items.Add("Sign out", null, (s, e) => Post(new JsonObject { ["event"] = "signOut" }));
            tray.ContextMenuStrip.Items.Add("Quit", null, (s, e) => Quit());

            pipe.RequestTicket = AskPageForTicket;
            pipe.LogPath = Path.Combine(Storage.Root, "pipe.log");
            Load += async (s, e) => await StartView();
        }

        async Task StartView()
        {
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Storage.Root, "webview"));
            await view.EnsureCoreWebView2Async(env);
            var core = view.CoreWebView2;
            core.Settings.AreDevToolsEnabled = Debugger.IsAttached;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.SetVirtualHostNameToFolderMapping(AppHost, Path.Combine(AppContext.BaseDirectory, "web"), CoreWebView2HostResourceAccessKind.Deny);
            // The window only ever shows our page; links go to the player's browser.
            core.NavigationStarting += (s, e) => { if (!e.Uri.StartsWith("https://" + AppHost + "/")) { e.Cancel = true; OpenExternal(e.Uri); } };
            core.NewWindowRequested += (s, e) => { e.Handled = true; OpenExternal(e.Uri); };
            core.WebMessageReceived += (s, e) => _ = HandleMessage(e.WebMessageAsJson);
            core.Navigate("https://" + AppHost + "/ui/index.html");
        }

        void Post(JsonNode message)
        {
            string json = message.ToJsonString();
            if (InvokeRequired) BeginInvoke(new Action(() => view.CoreWebView2?.PostWebMessageAsJson(json)));
            else view.CoreWebView2?.PostWebMessageAsJson(json);
        }

        async Task HandleMessage(string json)
        {
            JsonNode msg;
            try { msg = JsonNode.Parse(json); } catch (JsonException) { return; }
            string method = (string)msg?["method"];
            JsonNode p = msg?["params"];
            JsonNode id = msg?["id"]?.DeepClone();
            if (method == "state") { OnState(p); return; }
            if (method == "ticket") { OnTicket(p); return; }
            if (id == null) return;
            try
            {
                JsonNode result = await Run(method, p);
                Post(new JsonObject { ["id"] = id, ["result"] = result });
            }
            catch (Exception e)
            {
                string code = e is ProfileException pe ? pe.Code : e is HostError he ? he.Code : "launch-failed";
                Post(new JsonObject { ["id"] = id, ["error"] = code });
            }
        }

        sealed class HostError : Exception { public string Code; public HostError(string code) : base(code) { Code = code; } }

        async Task<JsonNode> Run(string method, JsonNode p)
        {
            switch (method)
            {
                case "settings":
                    return new JsonObject { ["centralUrl"] = settings.CentralUrl, ["gameFolder"] = settings.GameFolder, ["login"] = settings.Login };
                case "fetch":
                    return await Fetch(p);
                case "loadToken":
                    return Storage.LoadToken();
                case "saveToken":
                    Storage.SaveToken((string)p?["token"]);
                    return null;
                case "saveLogin":
                    settings.Login = Storage.CleanLogin((string)p?["login"]);
                    Storage.SaveSettings(settings);
                    return null;
                case "hardwareId":
                    // WMI off the UI thread; computed once per run.
                    return await Task.Run(() => HardwareId.Current);
                case "chooseGameFolder":
                    return ChooseGameFolder();
                case "openUrl":
                    OpenExternal((string)p?["url"]);
                    return null;
                case "launchGame":
                    Launch(p);
                    return null;
                default:
                    throw new HostError("unknown-method");
            }
        }

        // The page's HTTP: https anywhere (central and the gateways it names), http only to this PC.
        static async Task<JsonNode> Fetch(JsonNode p)
        {
            if (!Uri.TryCreate((string)p?["url"], UriKind.Absolute, out Uri url) || !Storage.IsAllowedCentral(url)) throw new HostError("network");
            var method = new HttpMethod(((string)p["method"] ?? "GET").ToUpperInvariant());
            if (method != HttpMethod.Get && method != HttpMethod.Post) throw new HostError("network");
            var req = new HttpRequestMessage(method, url);
            string body = (string)p["body"];
            if (body != null) req.Content = new StringContent(body, Encoding.UTF8, "application/json");
            string auth = (string)p["headers"]?["authorization"];
            if (auth != null && auth.StartsWith("Bearer ")) req.Headers.TryAddWithoutValidation("Authorization", auth);
            try
            {
                using (var res = await Http.SendAsync(req))
                    return new JsonObject { ["status"] = (int)res.StatusCode, ["body"] = await res.Content.ReadAsStringAsync() };
            }
            catch (Exception) { throw new HostError("network"); }
        }

        string ChooseGameFolder()
        {
            using (var dlg = new FolderBrowserDialog { Description = "Choose your Rust Legacy folder (the one with rust.exe)", UseDescriptionForTitle = true, SelectedPath = settings.GameFolder ?? "" })
            {
                if (dlg.ShowDialog(this) != DialogResult.OK) return null;
                try { ProfileBuilder.Validate(dlg.SelectedPath); }
                catch (ProfileException e) { MessageBox.Show(this, e.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return null; }
                settings.GameFolder = dlg.SelectedPath;
                Storage.SaveSettings(settings);
                return dlg.SelectedPath;
            }
        }

        // Builds the profile, arms the pipe with this server's character, starts the player's own game from the profile.
        void Launch(JsonNode p)
        {
            if (game != null && !game.HasExited) throw new HostError("already-running");
            if (!ulong.TryParse((string)p?["backendId"], out ulong backendId) || backendId == 0) throw new HostError("launch-failed");
            string host = (string)p["native"]?["host"];
            int port = (int?)p["native"]?["port"] ?? 0;
            string favourite = !string.IsNullOrEmpty(host) && port > 0 ? host + ":" + port : null;
            string proxy = Path.Combine(AppContext.BaseDirectory, "proxy", "steam_api.dll");
            string exe = ProfileBuilder.Build(settings.GameFolder, proxy, Storage.ProfileDir, favourite);
            pipe.Arm(backendId, (string)p["name"]);
            try
            {
                game = Process.Start(new ProcessStartInfo(exe) { WorkingDirectory = Path.GetDirectoryName(exe), UseShellExecute = false });
            }
            catch (Exception) { pipe.Disarm(); throw new HostError("launch-failed"); }
            game.EnableRaisingEvents = true;
            game.Exited += (s, e) => { pipe.Disarm(); Post(new JsonObject { ["event"] = "gameExited" }); };
        }

        // Called on a pipe thread when the proxy asks for a ticket; the page fetches it (core.mjs requestTicket).
        Task<Ticket> AskPageForTicket(CancellationToken ct)
        {
            int requestId = Interlocked.Increment(ref nextTicket);
            var tcs = new TaskCompletionSource<Ticket>(TaskCreationOptions.RunContinuationsAsynchronously);
            tickets[requestId] = tcs;
            ct.Register(() => { if (tickets.TryRemove(requestId, out var t)) t.TrySetResult(null); });
            Post(new JsonObject { ["event"] = "ticketRequest", ["requestId"] = requestId });
            return tcs.Task;
        }

        void OnTicket(JsonNode p)
        {
            int requestId = (int?)p?["requestId"] ?? 0;
            if (!tickets.TryRemove(requestId, out var tcs)) return;
            JsonNode t = p["ticket"];
            Ticket ticket = null;
            if (t != null && ulong.TryParse((string)t["backendId"], out ulong id))
            {
                try { ticket = new Ticket { BackendId = id, Envelope = Convert.FromBase64String((string)t["envelope"] ?? "") }; }
                catch (FormatException) { ticket = null; }
            }
            tcs.TrySetResult(ticket);
        }

        void OnState(JsonNode p)
        {
            phase = (string)p?["phase"] ?? phase;
            string server = (string)p?["server"];
            string text = phase == "in-game" ? "Playing on " + server : phase == "connected" ? "Connected to " + server : "Rust Legacy Launcher";
            tray.Text = text.Length > 63 ? text.Substring(0, 63) : text;
            if (p?["height"] is JsonNode h) FitHeight((int)h);
        }

        // Grows or shrinks the window to the page's content height, keeping its top edge where it is and staying
        // on the screen it is on. A maximised or minimised window is left alone.
        void FitHeight(int contentHeight)
        {
            if (WindowState != FormWindowState.Normal || contentHeight <= 0) return;
            Rectangle area = Screen.FromControl(this).WorkingArea;
            int chrome = Height - ClientSize.Height;
            int height = Math.Max(MinimumSize.Height, Math.Min(contentHeight + chrome, area.Height));
            if (Math.Abs(height - Height) < 4) return;
            int top = Math.Max(area.Top, Math.Min(Top, area.Bottom - height));
            SetBounds(Left, top, Width, height);
        }

        static void OpenExternal(string url)
        {
            if (Uri.TryCreate(url, UriKind.Absolute, out Uri u) && Storage.IsAllowedCentral(u))
                Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true });
        }

        void ShowWindow() { Show(); WindowState = FormWindowState.Normal; Activate(); }

        bool InGame => phase == "in-game" || phase == "launching" || (game != null && !game.HasExited);

        // Closing the window while playing keeps the launcher in the tray: the heartbeat is what keeps the session.
        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!quitting && e.CloseReason == CloseReason.UserClosing && InGame)
            {
                e.Cancel = true;
                Hide();
                tray.ShowBalloonTip(4000, "Still connected", "The launcher keeps you signed in while you play. Quit from the tray icon.", ToolTipIcon.Info);
                return;
            }
            base.OnFormClosing(e);
        }

        void Quit()
        {
            if (InGame && MessageBox.Show(this, "Quitting ends your session. The server removes you within a minute.", Text, MessageBoxButtons.OKCancel, MessageBoxIcon.Warning) != DialogResult.OK) return;
            quitting = true;
            Close();
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            pipe.Dispose();
            tray.Visible = false;
            tray.Dispose();
            base.OnFormClosed(e);
        }
    }
}
