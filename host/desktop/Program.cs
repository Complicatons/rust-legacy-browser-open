// Rust Legacy Host desktop app (HOST-AND-LOADER-BUILD.md A1). A front end over the Windows service, never the engine:
// closing it or quitting it leaves the service and the game server running. One instance per Windows user: starting it
// again brings the open window forward.
//   --tray   start in the tray without a window (the installer's -StartAtSignIn entry)
//   --dev    trust any dashboard on the port (development against `node host/service.mjs run`, no service installed)
using System;
using System.Threading;
using System.Windows.Forms;

namespace RustLegacyHostApp
{
    static class Program
    {
        const string MutexName = @"Local\RustLegacyHost.App";
        const string ShowEventName = @"Local\RustLegacyHost.Show";

        [STAThread]
        static int Main(string[] args)
        {
            using (var single = new Mutex(true, MutexName, out bool first))
            {
                if (!first)
                {
                    // The open instance waits on this event and shows its window.
                    try { using (var show = EventWaitHandle.OpenExisting(ShowEventName)) show.Set(); } catch (Exception) { }
                    return 0;
                }
                using (var show = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName))
                {
                    ApplicationConfiguration.Initialize();
                    var settings = HostSettings.Load(args);
                    var form = new MainForm(settings, startHidden: Array.IndexOf(args, "--tray") >= 0);
                    var waiter = new Thread(() =>
                    {
                        while (show.WaitOne())
                        {
                            if (form.IsDisposed) return;
                            try { form.BeginInvoke(new Action(form.ShowWindow)); } catch (InvalidOperationException) { return; }
                        }
                    }) { IsBackground = true, Name = "show-window" };
                    waiter.Start();
                    Application.Run(form);
                }
            }
            return 0;
        }
    }
}
