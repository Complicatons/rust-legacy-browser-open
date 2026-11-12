// Launch profile (DESKTOP-LAUNCHER-PLAN.md, "Proxy profile"): a folder under %LOCALAPPDATA%\RustLegacyLauncher\profile
// that looks like the player's game folder, so the player's own install never changes:
//   - every top-level file is a hard link to the player's file (a copy when the game is on another volume),
//   - every top-level folder is a directory junction to the player's folder (rust_Data, Mono, ...),
//   - except cfg, which is a real folder of hard links, so favourites.cfg can be our own copy with the armed server,
//   - steam_api.dll is our proxy, and the player's steam_api.dll is linked beside it as steam_api_upstream.dll.
// Unity resolves <exe>_Data next to the exe, and the Windows loader takes steam_api.dll from the exe's folder first.
// Remove() deletes only the profile's own entries: junctions are unlinked, never followed.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace RustLegacyLauncher
{
    public sealed class ProfileException : Exception
    {
        public string Code { get; }
        public ProfileException(string code, string message) : base(message) { Code = code; }
    }

    public static class ProfileBuilder
    {
        public const string Upstream = "steam_api_upstream.dll";

        // Checks the folder the player chose holds a Rust Legacy client.
        public static void Validate(string gameFolder)
        {
            if (string.IsNullOrEmpty(gameFolder) || !Directory.Exists(gameFolder)) throw new ProfileException("game-not-found", "Choose your Rust Legacy folder first.");
            if (!File.Exists(Path.Combine(gameFolder, "rust.exe")) || !Directory.Exists(Path.Combine(gameFolder, "rust_Data")))
                throw new ProfileException("game-not-found", "That folder has no rust.exe and rust_Data.");
            if (!File.Exists(Path.Combine(gameFolder, "steam_api.dll")))
                throw new ProfileException("steam-api-missing", "That folder has no steam_api.dll.");
        }

        // Builds (or rebuilds) the profile. Returns the path of the profile's rust.exe.
        public static string Build(string gameFolder, string proxyDll, string profile, string favourite)
        {
            Validate(gameFolder);
            if (!File.Exists(proxyDll)) throw new ProfileException("proxy-missing", "The launcher's steam_api proxy is missing; reinstall the launcher.");
            string game = Path.GetFullPath(gameFolder).TrimEnd('\\');
            string dir = Path.GetFullPath(profile).TrimEnd('\\');
            if (IsInside(dir, game) || IsInside(game, dir)) throw new ProfileException("bad-profile", "The profile folder cannot be inside the game folder.");
            Remove(dir);
            Directory.CreateDirectory(dir);

            foreach (string file in Directory.GetFiles(game))
            {
                string name = Path.GetFileName(file);
                if (name.Equals("steam_api.dll", StringComparison.OrdinalIgnoreCase)) LinkOrCopy(file, Path.Combine(dir, Upstream));
                else if (!name.Equals(Upstream, StringComparison.OrdinalIgnoreCase)) LinkOrCopy(file, Path.Combine(dir, name));
            }
            File.Copy(proxyDll, Path.Combine(dir, "steam_api.dll"), true);

            foreach (string sub in Directory.GetDirectories(game))
            {
                string name = Path.GetFileName(sub);
                if (name.Equals("cfg", StringComparison.OrdinalIgnoreCase)) continue;
                CreateJunction(Path.Combine(dir, name), sub);
            }

            // cfg: links, so settings the game saves land in the player's own files; favourites.cfg is our copy.
            string cfg = Path.Combine(dir, "cfg");
            Directory.CreateDirectory(cfg);
            string gameCfg = Path.Combine(game, "cfg");
            if (Directory.Exists(gameCfg))
                foreach (string file in Directory.GetFiles(gameCfg))
                    if (!Path.GetFileName(file).Equals("favourites.cfg", StringComparison.OrdinalIgnoreCase)) LinkOrCopy(file, Path.Combine(cfg, Path.GetFileName(file)));
            WriteFavourites(Path.Combine(gameCfg, "favourites.cfg"), Path.Combine(cfg, "favourites.cfg"), favourite);
            return Path.Combine(dir, "rust.exe");
        }

        // FavouriteList.Load runs cfg/favourites.cfg at startup; the armed server goes first.
        static void WriteFavourites(string original, string target, string favourite)
        {
            var lines = new List<string>();
            if (!string.IsNullOrEmpty(favourite))
            {
                if (favourite.IndexOfAny(new[] { '"', '\r', '\n', ';' }) >= 0) throw new ProfileException("bad-address", "Bad server address.");
                lines.Add("serverfavourite.add \"" + favourite + "\"");
            }
            if (File.Exists(original))
                foreach (string line in File.ReadAllLines(original))
                    if (!lines.Contains(line.Trim())) lines.Add(line);
            File.WriteAllText(target, string.Join("\r\n", lines) + "\r\n", new UTF8Encoding(false));
        }

        // Deletes the profile folder without ever following a junction or link into the player's files.
        public static void Remove(string profile)
        {
            string dir = Path.GetFullPath(profile).TrimEnd('\\');
            if (!Directory.Exists(dir) && !File.Exists(dir)) return;
            if (IsReparsePoint(dir)) { Directory.Delete(dir, false); return; }
            foreach (string entry in Directory.GetFileSystemEntries(dir))
            {
                var attr = File.GetAttributes(entry);
                if ((attr & FileAttributes.ReparsePoint) != 0)
                {
                    if ((attr & FileAttributes.Directory) != 0) Directory.Delete(entry, false); // unlinks the junction only
                    else File.Delete(entry);
                }
                else if ((attr & FileAttributes.Directory) != 0) Remove(entry);
                else
                {
                    if ((attr & FileAttributes.ReadOnly) != 0) File.SetAttributes(entry, attr & ~FileAttributes.ReadOnly);
                    File.Delete(entry); // a hard link: removes this name only, the player's file stays
                }
            }
            Directory.Delete(dir, false);
        }

        static void LinkOrCopy(string source, string target)
        {
            if (!CreateHardLinkW(target, source, IntPtr.Zero))
            {
                int err = Marshal.GetLastWin32Error();
                // ERROR_NOT_SAME_DEVICE (17), or a file system without hard links (FAT/exFAT: 1 / 50): copy instead.
                if (err == 17 || err == 1 || err == 50) File.Copy(source, target, true);
                else throw new Win32Exception(err, "Could not link " + source);
            }
        }

        public static bool IsReparsePoint(string path) =>
            (File.Exists(path) || Directory.Exists(path)) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0;

        static bool PathsEqual(string a, string b) =>
            string.Equals(Path.GetFullPath(a).TrimEnd('\\'), Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);

        static bool IsInside(string path, string folder) =>
            PathsEqual(path, folder) || path.StartsWith(folder + "\\", StringComparison.OrdinalIgnoreCase);

        // Directory junction (mount point): works across local volumes and needs no privilege, unlike symbolic links.
        public static void CreateJunction(string link, string target)
        {
            string full = Path.GetFullPath(target).TrimEnd('\\');
            Directory.CreateDirectory(link);
            string substitute = @"\??\" + full;
            byte[] sub = Encoding.Unicode.GetBytes(substitute), print = Encoding.Unicode.GetBytes(full);
            // REPARSE_DATA_BUFFER (MountPointReparseBuffer): tag, data length, reserved, 4 offsets/lengths, path buffer.
            int pathBytes = sub.Length + 2 + print.Length + 2;
            var buf = new byte[8 + 8 + pathBytes];
            BitConverter.GetBytes(0xA0000003u).CopyTo(buf, 0);              // IO_REPARSE_TAG_MOUNT_POINT
            BitConverter.GetBytes((ushort)(8 + pathBytes)).CopyTo(buf, 4);
            BitConverter.GetBytes((ushort)0).CopyTo(buf, 8);                // SubstituteNameOffset
            BitConverter.GetBytes((ushort)sub.Length).CopyTo(buf, 10);      // SubstituteNameLength
            BitConverter.GetBytes((ushort)(sub.Length + 2)).CopyTo(buf, 12); // PrintNameOffset
            BitConverter.GetBytes((ushort)print.Length).CopyTo(buf, 14);    // PrintNameLength
            sub.CopyTo(buf, 16);
            print.CopyTo(buf, 16 + sub.Length + 2);
            using (SafeFileHandle h = CreateFileW(link, 0x40000000 /* GENERIC_WRITE */, 0, IntPtr.Zero, 3 /* OPEN_EXISTING */,
                0x02000000 | 0x00200000 /* BACKUP_SEMANTICS | OPEN_REPARSE_POINT */, IntPtr.Zero))
            {
                if (h.IsInvalid) { int e = Marshal.GetLastWin32Error(); Directory.Delete(link, false); throw new Win32Exception(e, "Could not open " + link); }
                if (!DeviceIoControl(h, 0x000900A4 /* FSCTL_SET_REPARSE_POINT */, buf, buf.Length, IntPtr.Zero, 0, out _, IntPtr.Zero))
                {
                    int e = Marshal.GetLastWin32Error();
                    h.Dispose();
                    Directory.Delete(link, false);
                    throw new Win32Exception(e, "Could not link " + link + " to " + full);
                }
            }
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool CreateHardLinkW(string newFile, string existingFile, IntPtr security);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool DeviceIoControl(SafeFileHandle h, uint code, byte[] input, int inputSize, IntPtr output, int outputSize, out int returned, IntPtr overlapped);
    }
}
