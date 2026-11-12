// Rust Legacy desktop launcher (DESKTOP-LAUNCHER-PLAN.md). One instance per Windows user (the proxy's pipe name is
// per user too). `--remove-profile` deletes the launch profile (for the uninstaller) without touching the game.
using System;
using System.Threading;
using System.Windows.Forms;

namespace RustLegacyLauncher
{
    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            if (args.Length == 1 && args[0] == "--remove-profile")
            {
                ProfileBuilder.Remove(Storage.ProfileDir);
                return 0;
            }
            using (var single = new Mutex(true, @"Local\RustLegacyLauncher", out bool first))
            {
                if (!first)
                {
                    MessageBox.Show("The launcher is already running. Look for its icon in the tray.", "Rust Legacy Launcher");
                    return 1;
                }
                ApplicationConfiguration.Initialize();
                Application.Run(new MainForm());
            }
            return 0;
        }
    }
}
