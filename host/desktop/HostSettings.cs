// Where the host is and whether the dashboard on its port really is ours.
//  - RustLegacyHost.json next to the exe, written by Install-RustLegacyHost.ps1: {"dataDir", "port", "root", "node",
//    "service"}. The data folder is closed to normal accounts, so the installer copies the port here; host.json in the
//    data folder wins when this account can read it. Without either: C:\ProgramData\Rust Legacy Host and port 28100.
//  - The owner token: <dataDir>\owner.token. The installer gives the installing account read access to that one file.
//    Opening it by its full path needs no right on the folder itself ("bypass traverse checking", which every account has).
//  - The listener check: the owner token and the shells go only to a dashboard served by the RustLegacyHost service
//    (the listening process is the service's own process or its direct child, node.exe). Another program that took the
//    port while the service was down gets neither. --dev skips the check, for development without the service.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace RustLegacyHostApp
{
    public sealed class HostError : Exception
    {
        public string Code;
        public HostError(string code, string message) : base(message) { Code = code; }
    }

    public sealed class HostSettings
    {
        public string DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Rust Legacy Host");
        public string Root;              // the server's scripts folder (C:\RLB-host) when there is one
        public string Service = "RustLegacyHost";
        public int Port = 28100;
        public bool Dev;
        public string Origin => "http://127.0.0.1:" + Port;
        public string TokenFile => Path.Combine(DataDir, "owner.token");
        public static string LocalDir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RustLegacyHost");

        public static HostSettings Load(string[] args)
        {
            var s = new HostSettings { Dev = Array.IndexOf(args, "--dev") >= 0 };
            try
            {
                string file = Path.Combine(AppContext.BaseDirectory, "RustLegacyHost.json");
                if (File.Exists(file))
                {
                    using (var doc = JsonDocument.Parse(File.ReadAllText(file)))
                    {
                        var r = doc.RootElement;
                        if (r.TryGetProperty("dataDir", out var d) && d.ValueKind == JsonValueKind.String) s.DataDir = d.GetString();
                        if (r.TryGetProperty("port", out var p) && p.TryGetInt32(out int port)) s.Port = port;
                        if (r.TryGetProperty("root", out var root) && root.ValueKind == JsonValueKind.String) s.Root = root.GetString();
                        if (r.TryGetProperty("service", out var sv) && sv.ValueKind == JsonValueKind.String) s.Service = sv.GetString();
                    }
                }
            }
            catch (Exception) { } // a damaged settings file: the defaults
            try
            {
                using (var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(s.DataDir, "host.json"))))
                    if (doc.RootElement.TryGetProperty("listen", out var l) && l.TryGetProperty("port", out var p) && p.TryGetInt32(out int port)) s.Port = port;
            }
            catch (Exception) { } // usually: this account may not read the data folder (the installer's copy above is used)
            if (s.Port < 1 || s.Port > 65535) s.Port = 28100;
            if (s.Root == null && Directory.Exists(@"C:\RLB-host")) s.Root = @"C:\RLB-host";
            return s;
        }

        public string ReadToken()
        {
            try
            {
                string t = File.ReadAllText(TokenFile).Trim();
                if (t.Length < 20) throw new HostError("token-unreadable", "owner.token is empty or damaged");
                return t;
            }
            catch (HostError) { throw; }
            catch (UnauthorizedAccessException) { throw new HostError("token-unreadable", "this Windows account may not read " + TokenFile); }
            catch (FileNotFoundException) { throw new HostError("token-unreadable", TokenFile + " does not exist yet (has the service started once?)"); }
            catch (DirectoryNotFoundException) { throw new HostError("token-unreadable", DataDir + " does not exist (is the host installed?)"); }
            catch (IOException e) { throw new HostError("token-unreadable", e.Message); }
        }

        // The shells start in the server's folder: C:\RLB-host when it exists, else the data folder when this account
        // may open it, else the user's own folder.
        public string ShellFolder()
        {
            foreach (string dir in new[] { Root, DataDir })
            {
                if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) continue;
                try { using (var e = Directory.EnumerateFileSystemEntries(dir).GetEnumerator()) e.MoveNext(); return dir; }
                catch (UnauthorizedAccessException) { }
                catch (IOException) { }
            }
            return Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        }

        // True when the process listening on 127.0.0.1:<port> is the RustLegacyHost service or its child.
        public bool ListenerIsHost(out string why)
        {
            if (Dev) { why = "development mode (--dev)"; return true; }
            int listener = ListenerPid(Port);
            if (listener <= 0) { why = "nothing is listening on 127.0.0.1:" + Port; return false; }
            int service = ServicePid(Service);
            if (service <= 0) { why = "the " + Service + " service is not running"; return false; }
            if (listener == service || ParentPid(listener) == service) { why = null; return true; }
            why = "the program on port " + Port + " is not the " + Service + " service";
            return false;
        }

        // ---------- Win32: the TCP listener table, the service's process ID, a process's parent ----------
        [StructLayout(LayoutKind.Sequential)]
        struct MIB_TCPROW_OWNER_PID { public uint state, localAddr, localPort, remoteAddr, remotePort, owningPid; }
        const int AF_INET = 2, TCP_TABLE_OWNER_PID_LISTENER = 3;
        [DllImport("iphlpapi.dll", SetLastError = true)]
        static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool order, int af, int tableClass, uint reserved);

        static int ListenerPid(int port)
        {
            int size = 0;
            GetExtendedTcpTable(IntPtr.Zero, ref size, false, AF_INET, TCP_TABLE_OWNER_PID_LISTENER, 0);
            IntPtr buf = Marshal.AllocHGlobal(size);
            try
            {
                if (GetExtendedTcpTable(buf, ref size, false, AF_INET, TCP_TABLE_OWNER_PID_LISTENER, 0) != 0) return -1;
                int n = Marshal.ReadInt32(buf), rowSize = Marshal.SizeOf<MIB_TCPROW_OWNER_PID>();
                for (int i = 0; i < n; i++)
                {
                    var row = Marshal.PtrToStructure<MIB_TCPROW_OWNER_PID>(buf + 4 + i * rowSize);
                    int p = (int)(((row.localPort & 0xFF) << 8) | ((row.localPort >> 8) & 0xFF)); // network byte order
                    // 127.0.0.1 is 0x0100007F in memory order; 0.0.0.0 also takes loopback connections.
                    if (p == port && (row.localAddr == 0x0100007F || row.localAddr == 0)) return (int)row.owningPid;
                }
                return -1;
            }
            finally { Marshal.FreeHGlobal(buf); }
        }

        [StructLayout(LayoutKind.Sequential)]
        struct SERVICE_STATUS_PROCESS { public uint serviceType, currentState, controlsAccepted, win32ExitCode, serviceSpecificExitCode, checkPoint, waitHint, processId, serviceFlags; }
        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr OpenSCManager(string machine, string db, uint access);
        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr OpenService(IntPtr scm, string name, uint access);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool QueryServiceStatusEx(IntPtr service, int level, out SERVICE_STATUS_PROCESS status, int size, out int needed);
        [DllImport("advapi32.dll")] static extern bool CloseServiceHandle(IntPtr h);
        const uint SC_MANAGER_CONNECT = 1, SERVICE_QUERY_STATUS = 4, SERVICE_RUNNING = 4;

        // Any signed-in account may query a service's status (the default service security), no administrator rights.
        static int ServicePid(string name)
        {
            IntPtr scm = OpenSCManager(null, null, SC_MANAGER_CONNECT);
            if (scm == IntPtr.Zero) return -1;
            try
            {
                IntPtr svc = OpenService(scm, name, SERVICE_QUERY_STATUS);
                if (svc == IntPtr.Zero) return -1;
                try
                {
                    if (!QueryServiceStatusEx(svc, 0, out var st, Marshal.SizeOf<SERVICE_STATUS_PROCESS>(), out _)) return -1;
                    return st.currentState == SERVICE_RUNNING ? (int)st.processId : -1;
                }
                finally { CloseServiceHandle(svc); }
            }
            finally { CloseServiceHandle(scm); }
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct PROCESSENTRY32 { public uint size, usage, processId; public IntPtr defaultHeapId; public uint moduleId, threads, parentProcessId; public int priClassBase; public uint flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string exeFile; }
        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snap, ref PROCESSENTRY32 e);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snap, ref PROCESSENTRY32 e);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

        // The snapshot lists every process with its parent without opening any of them (no rights on other accounts' processes).
        static int ParentPid(int pid)
        {
            IntPtr snap = CreateToolhelp32Snapshot(2 /* TH32CS_SNAPPROCESS */, 0);
            if (snap == new IntPtr(-1)) return -1;
            try
            {
                var e = new PROCESSENTRY32 { size = (uint)Marshal.SizeOf<PROCESSENTRY32>() };
                for (bool ok = Process32FirstW(snap, ref e); ok; ok = Process32NextW(snap, ref e))
                    if (e.processId == (uint)pid) return (int)e.parentProcessId;
                return -1;
            }
            finally { CloseHandle(snap); }
        }
    }
}
