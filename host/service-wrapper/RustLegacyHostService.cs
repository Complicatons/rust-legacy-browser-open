// Windows service wrapper for the Rust Legacy host app (HOST-APP-PLAN.md "Installer"). Built with the .NET Framework
// compiler every Windows has (tools/build-host-installer.mjs); no third-party service tool.
//  - Runs node.exe host/service.mjs run <host.json> in the app folder, its output appended to
//    <dataDir>\logs\service-<date>.log.
//  - Puts node, and so every part the host starts, in a Job Object that kills them all when the wrapper ends: nothing
//    outlives the service, even when it is killed.
//  - Stops gracefully: writes "stop" on node's stdin (the host stops each part it started), waits up to 25 s, then ends
//    the job. Restarts node if it exits on its own (5 s, doubling to 60 s).
//  - --console runs the same loop in a console (tests, troubleshooting); typing "stop" or closing stdin ends it.
// Settings: RustLegacyHostService.json next to the exe: {"node": "...", "app": "...", "config": "...", "dataDir": "..."}.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.ServiceProcess;
using System.Text.RegularExpressions;
using System.Threading;

public class RustLegacyHostService : ServiceBase
{
    const string Name = "RustLegacyHost";
    string node, app, config, dataDir;
    IntPtr job = IntPtr.Zero;
    Process child;
    Thread loop;
    volatile bool stopping;
    bool echo; // --console: log lines also go to stdout, interactive or not (tests run it from non-interactive sessions)
    readonly object gate = new object();

    public RustLegacyHostService() { ServiceName = Name; CanStop = true; CanShutdown = true; AutoLog = true; }

    public static int Main(string[] args)
    {
        var svc = new RustLegacyHostService();
        try { svc.LoadSettings(); }
        catch (Exception e) { Console.Error.WriteLine("RustLegacyHostService: " + e.Message); return 2; }
        if (args.Length > 0 && args[0] == "--console")
        {
            svc.echo = true;
            svc.Begin();
            Console.WriteLine("Rust Legacy host running under the wrapper. Type stop to end it.");
            string line;
            while ((line = Console.ReadLine()) != null && line.Trim() != "stop") { }
            svc.End();
            return 0;
        }
        ServiceBase.Run(svc);
        return 0;
    }

    // Minimal reader for the four flat string settings (no JSON library needed on .NET Framework 4).
    void LoadSettings()
    {
        string file = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "RustLegacyHostService.json");
        string text = File.ReadAllText(file);
        Func<string, string> get = key =>
        {
            Match m = Regex.Match(text, "\"" + key + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
            if (!m.Success) throw new Exception("missing \"" + key + "\" in " + file);
            return Regex.Unescape(m.Groups[1].Value);
        };
        node = get("node"); app = get("app"); config = get("config"); dataDir = get("dataDir");
    }

    protected override void OnStart(string[] args) { Begin(); }
    protected override void OnStop() { RequestAdditionalTime(30000); End(); }
    protected override void OnShutdown() { End(); }

    void Begin()
    {
        job = CreateJobObject(IntPtr.Zero, null);
        var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr ptr = Marshal.AllocHGlobal(size);
        Marshal.StructureToPtr(info, ptr, false);
        SetInformationJobObject(job, 9 /* JobObjectExtendedLimitInformation */, ptr, (uint)size);
        Marshal.FreeHGlobal(ptr);
        loop = new Thread(Run) { IsBackground = true };
        loop.Start();
    }

    void Run()
    {
        int delay = 5000;
        while (!stopping)
        {
            DateTime started = DateTime.UtcNow;
            try { StartNode(); child.WaitForExit(); }
            catch (Exception e) { Log("could not start node: " + e.Message); }
            if (stopping) break;
            Log("the host exited (code " + (child != null && child.HasExited ? child.ExitCode.ToString() : "?") + "); starting it again in " + delay / 1000 + " s");
            if ((DateTime.UtcNow - started).TotalMinutes > 10) delay = 5000;
            for (int waited = 0; waited < delay && !stopping; waited += 250) Thread.Sleep(250);
            delay = Math.Min(delay * 2, 60000);
        }
    }

    void StartNode()
    {
        var psi = new ProcessStartInfo(node, "host\\service.mjs run \"" + config + "\"")
        {
            WorkingDirectory = app, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
        };
        lock (gate)
        {
            child = Process.Start(psi);
            AssignProcessToJobObject(job, child.Handle);
        }
        child.OutputDataReceived += (s, e) => { if (e.Data != null) Log(e.Data); };
        child.ErrorDataReceived += (s, e) => { if (e.Data != null) Log(e.Data); };
        child.BeginOutputReadLine(); child.BeginErrorReadLine();
        Log("started the host (node PID " + child.Id + ")");
    }

    void End()
    {
        stopping = true;
        Process c; lock (gate) c = child;
        if (c != null && !c.HasExited)
        {
            try { c.StandardInput.WriteLine("stop"); c.StandardInput.Flush(); } catch { }
            if (!c.WaitForExit(25000)) Log("the host did not stop within 25 s; ending it");
        }
        if (job != IntPtr.Zero) { TerminateJobObject(job, 0); CloseHandle(job); job = IntPtr.Zero; }
        Log("stopped");
    }

    readonly object logGate = new object();
    void Log(string line)
    {
        try
        {
            string dir = Path.Combine(dataDir, "logs");
            Directory.CreateDirectory(dir);
            lock (logGate) File.AppendAllText(Path.Combine(dir, "service-" + DateTime.Now.ToString("yyyy-MM-dd") + ".log"), DateTime.Now.ToString("s") + " " + line + Environment.NewLine);
        }
        catch { }
        if (echo || Environment.UserInteractive) Console.WriteLine(line);
    }

    [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_BASIC_LIMIT_INFORMATION { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
}
