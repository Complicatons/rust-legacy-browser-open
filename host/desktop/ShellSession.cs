// One PowerShell or CMD tab: a real shell in a Windows pseudo console (ConPTY, Windows 10 1809 and later), so colours,
// cursor movement and interactive programs work as in Windows Terminal. It runs as the Windows account that opened the
// app (this process's own token), never as the service, in a Job Object: closing the tab, quitting the app, or the app
// ending any other way ends the shell and everything started from it (KILL_ON_JOB_CLOSE).
// Output is UTF-8 VT text from the pseudo console, decoded across read boundaries; input is written back as UTF-8.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace RustLegacyHostApp
{
    public sealed class ShellSession : IDisposable
    {
        public readonly int Id;
        public event Action<string> Output;
        public event Action<int?> Exited;
        IntPtr pc = IntPtr.Zero, job = IntPtr.Zero, process = IntPtr.Zero, attrList = IntPtr.Zero;
        SafeFileHandle inputWrite, outputRead;
        FileStream input;
        readonly object gate = new object();
        int disposed;

        ShellSession(int id) { Id = id; }

        // Full paths, so nothing on PATH can stand in for the shell.
        public static string CommandLine(string shell)
        {
            string sys = Environment.GetFolderPath(Environment.SpecialFolder.System);
            if (shell == "powershell") return "\"" + Path.Combine(sys, @"WindowsPowerShell\v1.0\powershell.exe") + "\" -NoLogo";
            if (shell == "cmd") return "\"" + Path.Combine(sys, "cmd.exe") + "\"";
            throw new HostError("bad-request", "unknown shell");
        }

        public static ShellSession Start(int id, string shell, string folder, int cols, int rows)
        {
            var s = new ShellSession(id);
            try { s.Launch(CommandLine(shell), folder, (short)cols, (short)rows); }
            catch (EntryPointNotFoundException) { s.Dispose(); throw new HostError("conpty-unavailable", "this Windows is older than Windows 10 1809, which has no pseudo console"); }
            catch (HostError) { s.Dispose(); throw; }
            catch (Exception e) { s.Dispose(); throw new HostError("shell-failed", e.Message); }
            return s;
        }

        void Launch(string commandLine, string folder, short cols, short rows)
        {
            // Pipes: we write the shell's input and read its output; the pseudo console holds the other ends.
            if (!CreatePipe(out SafeFileHandle inputRead, out inputWrite, IntPtr.Zero, 0)) throw new System.ComponentModel.Win32Exception();
            if (!CreatePipe(out outputRead, out SafeFileHandle outputWrite, IntPtr.Zero, 0)) throw new System.ComponentModel.Win32Exception();
            int hr = CreatePseudoConsole(new COORD { X = cols, Y = rows }, inputRead, outputWrite, 0, out pc);
            inputRead.Dispose(); outputWrite.Dispose(); // the pseudo console has its own copies
            if (hr != 0) throw new System.ComponentModel.Win32Exception(hr);

            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            attrList = Marshal.AllocHGlobal(size);
            if (!InitializeProcThreadAttributeList(attrList, 1, 0, ref size)) throw new System.ComponentModel.Win32Exception();
            if (!UpdateProcThreadAttribute(attrList, 0, (IntPtr)PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, pc, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero)) throw new System.ComponentModel.Win32Exception();

            var si = new STARTUPINFOEX();
            si.StartupInfo.cb = Marshal.SizeOf<STARTUPINFOEX>();
            si.lpAttributeList = attrList;
            // Suspended until it is in the job, so nothing it starts can escape the job.
            if (!CreateProcessW(null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, false,
                EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT, IntPtr.Zero, folder, ref si, out PROCESS_INFORMATION pi))
                throw new System.ComponentModel.Win32Exception();
            process = pi.hProcess;
            job = CreateJobObject(IntPtr.Zero, null);
            var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            info.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            int len = Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
            IntPtr ptr = Marshal.AllocHGlobal(len);
            try { Marshal.StructureToPtr(info, ptr, false); SetInformationJobObject(job, 9 /* JobObjectExtendedLimitInformation */, ptr, (uint)len); }
            finally { Marshal.FreeHGlobal(ptr); }
            if (!AssignProcessToJobObject(job, process)) { TerminateProcess(process, 1); CloseHandle(pi.hThread); throw new System.ComponentModel.Win32Exception(); }
            ResumeThread(pi.hThread);
            CloseHandle(pi.hThread);

            input = new FileStream(inputWrite, FileAccess.Write, 1);
            new Thread(ReadLoop) { IsBackground = true, Name = "shell-" + Id + "-out" }.Start();
            new Thread(WaitLoop) { IsBackground = true, Name = "shell-" + Id + "-wait" }.Start();
        }

        void ReadLoop()
        {
            var decoder = new UTF8Encoding(false).GetDecoder();
            var bytes = new byte[16384];
            var chars = new char[16384 + 4];
            try
            {
                using (var output = new FileStream(outputRead, FileAccess.Read, 1))
                {
                    int n;
                    while ((n = output.Read(bytes, 0, bytes.Length)) > 0)
                    {
                        int c = decoder.GetChars(bytes, 0, n, chars, 0, false);
                        if (c > 0) Output?.Invoke(new string(chars, 0, c));
                    }
                }
            }
            catch (IOException) { }      // the pipe closed: the pseudo console is gone
            catch (ObjectDisposedException) { }
        }

        void WaitLoop()
        {
            WaitForSingleObject(process, 0xFFFFFFFF);
            int? code = GetExitCodeProcess(process, out uint c) ? (int)c : (int?)null;
            Exited?.Invoke(code);
            // The pseudo console keeps the output pipe open until it is closed; closing it ends ReadLoop.
            ThreadPool.QueueUserWorkItem(_ => Dispose());
        }

        public void Write(string data)
        {
            if (string.IsNullOrEmpty(data)) return;
            byte[] b = Encoding.UTF8.GetBytes(data);
            lock (gate)
            {
                if (disposed != 0) return;
                try { input.Write(b, 0, b.Length); input.Flush(); } catch (IOException) { } catch (ObjectDisposedException) { }
            }
        }

        public void Resize(int cols, int rows)
        {
            lock (gate) if (disposed == 0 && pc != IntPtr.Zero) ResizePseudoConsole(pc, new COORD { X = (short)cols, Y = (short)rows });
        }

        // Ends the shell and its whole tree, then frees the pseudo console. ClosePseudoConsole can wait for its output to
        // be read, and ReadLoop keeps reading until then, so this never runs on the window's thread.
        public void Dispose()
        {
            if (Interlocked.Exchange(ref disposed, 1) != 0) return;
            lock (gate)
            {
                if (job != IntPtr.Zero) { TerminateJobObject(job, 1); CloseHandle(job); job = IntPtr.Zero; }
                try { input?.Dispose(); } catch (Exception) { }
                if (pc != IntPtr.Zero) { ClosePseudoConsole(pc); pc = IntPtr.Zero; }
                if (attrList != IntPtr.Zero) { DeleteProcThreadAttributeList(attrList); Marshal.FreeHGlobal(attrList); attrList = IntPtr.Zero; }
            }
            // The process handle stays open until WaitLoop has read the exit code.
            ThreadPool.QueueUserWorkItem(_ => { Thread.Sleep(2000); if (process != IntPtr.Zero) { CloseHandle(process); process = IntPtr.Zero; } });
        }

        // ---------- Win32 ----------
        const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000, CREATE_SUSPENDED = 0x00000004, CREATE_UNICODE_ENVIRONMENT = 0x00000400;
        const int PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016;
        [StructLayout(LayoutKind.Sequential)] struct COORD { public short X, Y; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct STARTUPINFO { public int cb; public string lpReserved, lpDesktop, lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
        [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
        [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
        [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_BASIC_LIMIT_INFORMATION { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
        [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
        [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }

        [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out SafeFileHandle read, out SafeFileHandle write, IntPtr attributes, int size);
        [DllImport("kernel32.dll")] static extern int CreatePseudoConsole(COORD size, SafeFileHandle input, SafeFileHandle output, uint flags, out IntPtr pc);
        [DllImport("kernel32.dll")] static extern int ResizePseudoConsole(IntPtr pc, COORD size);
        [DllImport("kernel32.dll")] static extern void ClosePseudoConsole(IntPtr pc);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returnSize);
        [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool CreateProcessW(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string currentDirectory, ref STARTUPINFOEX startupInfo, out PROCESS_INFORMATION info);
        [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
        [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
        [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job, uint code);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    }
}
