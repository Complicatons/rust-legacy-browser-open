// The launcher's side of the steam_api proxy's pipe (launcher/proxy/steam_api_proxy.c has the protocol):
// \\.\pipe\rlb-launcher-<user SID>, message mode, ACL for the current user only. Two listeners are always waiting, so
// the proxy never sees "no pipe" between calls. 'I' is answered from the armed identity; 'T' asks the window for a
// fresh envelope (core.mjs requestTicket: new pass + gateway admit) and waits up to 8.5 s, inside the server's 10 s.
// With LogPath set (MainForm: %LOCALAPPDATA%\RustLegacyLauncher\pipe.log), one line per request and per arm/disarm:
// what the proxy asked, what it got and how long it took. Never the envelope bytes. Kept under 1 MB (one .1 copy).
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace RustLegacyLauncher
{
    public sealed class Ticket
    {
        public ulong BackendId;
        public byte[] Envelope;
    }

    public sealed class TicketPipe : IDisposable
    {
        public const int MaxTicket = 1024; // librust's buffer
        static readonly TimeSpan TicketWait = TimeSpan.FromSeconds(8.5);

        readonly string name;
        readonly CancellationTokenSource stop = new CancellationTokenSource();
        readonly object gate = new object();
        ulong armedId;
        string armedName = "";

        // Asked on every 'T' while armed; returns null when the website or gateway refused.
        public Func<CancellationToken, Task<Ticket>> RequestTicket;

        public string LogPath;
        readonly object logGate = new object();

        public static string DefaultName() => "rlb-launcher-" + WindowsIdentity.GetCurrent().User.Value;

        public TicketPipe(string pipeName = null)
        {
            name = pipeName ?? DefaultName();
            for (int i = 0; i < 2; i++) _ = Task.Run(Listen);
        }

        public void Arm(ulong backendId, string displayName)
        {
            lock (gate) { armedId = backendId; armedName = displayName ?? ""; }
            Log("armed id=" + backendId);
        }

        public void Disarm() { lock (gate) { armedId = 0; armedName = ""; } Log("disarmed"); }

        void Log(string line)
        {
            string path = LogPath;
            if (path == null) return;
            try
            {
                lock (logGate)
                {
                    var fi = new FileInfo(path);
                    if (fi.Exists && fi.Length > 1_000_000) { File.Copy(path, path + ".1", true); File.Delete(path); }
                    File.AppendAllText(path, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " " + line + Environment.NewLine);
                }
            }
            catch (Exception) { /* a log must never break the game's login */ }
        }

        public bool Armed { get { lock (gate) return armedId != 0; } }

        NamedPipeServerStream NewServer()
        {
            var security = new PipeSecurity();
            security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.ReadWrite | PipeAccessRights.CreateNewInstance, AccessControlType.Allow));
            return NamedPipeServerStreamAcl.Create(name, PipeDirection.InOut, NamedPipeServerStream.MaxAllowedServerInstances,
                PipeTransmissionMode.Message, PipeOptions.Asynchronous, 4096, 4096, security);
        }

        async Task Listen()
        {
            while (!stop.IsCancellationRequested)
            {
                NamedPipeServerStream server;
                try { server = NewServer(); await server.WaitForConnectionAsync(stop.Token); }
                catch (OperationCanceledException) { return; }
                catch (IOException) { await Task.Delay(200); continue; }
                _ = Task.Run(() => Listen()); // the next listener exists before this client is served
                await Serve(server);
                return;
            }
        }

        async Task Serve(NamedPipeServerStream server)
        {
            using (server)
            {
                try
                {
                    var req = new byte[16];
                    int n = await server.ReadAsync(req, 0, req.Length, stop.Token);
                    if (n < 1) return;
                    byte[] reply = await Answer((char)req[0]);
                    await server.WriteAsync(reply, 0, reply.Length, stop.Token);
                    await server.FlushAsync();
                }
                catch (Exception) { /* client went away; the proxy treats it as no answer */ }
            }
        }

        public async Task<byte[]> Answer(char op)
        {
            var sw = Stopwatch.StartNew();
            var (reply, outcome) = await AnswerCore(op);
            Log("request " + (op >= ' ' && op < 127 ? op.ToString() : "0x" + ((int)op).ToString("x2")) + ": " + outcome + " (" + sw.ElapsedMilliseconds + " ms)");
            return reply;
        }

        async Task<(byte[], string)> AnswerCore(char op)
        {
            ulong id; string display;
            lock (gate) { id = armedId; display = armedName; }
            if (id == 0) return (new byte[] { 0 }, "not armed, the game uses its own Steam");
            if (op == 'I')
            {
                byte[] nameBytes = Encoding.UTF8.GetBytes(display);
                if (nameBytes.Length > 63) Array.Resize(ref nameBytes, 63);
                return (Frame(1, id, nameBytes), "identity id=" + id);
            }
            if (op != 'T') return (new byte[] { 2 }, "unknown request, refused");
            Ticket t = null;
            bool timedOut = false;
            if (RequestTicket != null)
            {
                using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop.Token))
                {
                    timeout.CancelAfter(TicketWait);
                    try { t = await RequestTicket(timeout.Token).WaitAsync(timeout.Token); }
                    catch (OperationCanceledException) { t = null; timedOut = true; }
                }
            }
            if (t == null) return (new byte[] { 2 }, timedOut ? "ticket refused: no answer from the website or gateway in 8.5 s" : "ticket refused by the website or gateway");
            if (t.Envelope == null || t.Envelope.Length == 0 || t.Envelope.Length > MaxTicket || t.BackendId == 0) return (new byte[] { 2 }, "ticket refused: malformed (" + (t.Envelope?.Length ?? 0) + " bytes, id " + t.BackendId + ")");
            lock (gate) { if (armedId != 0) armedId = t.BackendId; }
            return (Frame(1, t.BackendId, t.Envelope), "ticket id=" + t.BackendId + " len=" + t.Envelope.Length);
        }

        static byte[] Frame(byte status, ulong id, byte[] data)
        {
            var b = new byte[11 + data.Length];
            b[0] = status;
            BitConverter.GetBytes(id).CopyTo(b, 1);
            BitConverter.GetBytes((ushort)data.Length).CopyTo(b, 9);
            data.CopyTo(b, 11);
            return b;
        }

        public void Dispose() { stop.Cancel(); }
    }
}
