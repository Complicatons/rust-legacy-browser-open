// Per-user launcher files under %LOCALAPPDATA%\RustLegacyLauncher: settings.json (website address, game folder, and
// the login name when "Remember my email or username" is ticked; never a password),
// token.bin (the desktop session token, only when "Keep me signed in" is ticked, sealed with DPAPI for this Windows
// user) and profile\ (ProfileBuilder). launcher.json next to the exe sets the default website for new installs.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace RustLegacyLauncher
{
    public sealed class Settings
    {
        public string CentralUrl { get; set; } = "https://your-domain.example/";
        public string GameFolder { get; set; }
        // "Remember my email or username": prefilled on the sign-in form next time. Null when unticked.
        public string Login { get; set; }
    }

    public static class Storage
    {
        public static string Root { get; set; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RustLegacyLauncher");
        public static string ProfileDir => Path.Combine(Root, "profile");
        static string SettingsFile => Path.Combine(Root, "settings.json");
        static string TokenFile => Path.Combine(Root, "token.bin");
        static readonly JsonSerializerOptions Json = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };

        public static Settings LoadSettings()
        {
            Settings s = null;
            try { if (File.Exists(SettingsFile)) s = JsonSerializer.Deserialize<Settings>(File.ReadAllText(SettingsFile), Json); } catch (Exception) { s = null; }
            if (s == null)
            {
                s = new Settings();
                string defaults = Path.Combine(AppContext.BaseDirectory, "launcher.json");
                try { if (File.Exists(defaults)) s = JsonSerializer.Deserialize<Settings>(File.ReadAllText(defaults), Json) ?? s; } catch (Exception) { }
            }
            if (!Uri.TryCreate(s.CentralUrl, UriKind.Absolute, out var u) || !IsAllowedCentral(u)) s.CentralUrl = new Settings().CentralUrl;
            return s;
        }

        // https anywhere; plain http only to this PC (development against tools/central.mjs).
        public static bool IsAllowedCentral(Uri u) => u.Scheme == "https" || (u.Scheme == "http" && u.IsLoopback);

        public static void SaveSettings(Settings s)
        {
            Directory.CreateDirectory(Root);
            File.WriteAllText(SettingsFile, JsonSerializer.Serialize(s, Json));
        }

        // The remembered login name, trimmed and bounded like the form field; empty forgets it.
        public static string CleanLogin(string login)
        {
            string l = (login ?? "").Trim();
            return l.Length == 0 ? null : l.Length > 254 ? l.Substring(0, 254) : l;
        }

        public static string LoadToken()
        {
            try { return File.Exists(TokenFile) ? Encoding.UTF8.GetString(Unprotect(File.ReadAllBytes(TokenFile))) : null; }
            catch (Exception) { return null; } // another user's or a damaged file: sign in again
        }

        public static void SaveToken(string token)
        {
            if (string.IsNullOrEmpty(token)) { if (File.Exists(TokenFile)) File.Delete(TokenFile); return; }
            Directory.CreateDirectory(Root);
            File.WriteAllBytes(TokenFile, Protect(Encoding.UTF8.GetBytes(token)));
        }

        // DPAPI, current user scope (CryptProtectData without CRYPTPROTECT_LOCAL_MACHINE).
        [StructLayout(LayoutKind.Sequential)]
        struct Blob { public int Size; public IntPtr Data; }

        [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool CryptProtectData(ref Blob input, string description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out Blob output);

        [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool CryptUnprotectData(ref Blob input, IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out Blob output);

        [DllImport("kernel32.dll")]
        static extern IntPtr LocalFree(IntPtr mem);

        const int UiForbidden = 1;

        public static byte[] Protect(byte[] data) => Crypt(data, true);
        public static byte[] Unprotect(byte[] data) => Crypt(data, false);

        static byte[] Crypt(byte[] data, bool protect)
        {
            var handle = GCHandle.Alloc(data, GCHandleType.Pinned);
            try
            {
                var input = new Blob { Size = data.Length, Data = handle.AddrOfPinnedObject() };
                bool ok = protect
                    ? CryptProtectData(ref input, "Rust Legacy launcher", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, UiForbidden, out Blob output)
                    : CryptUnprotectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, UiForbidden, out output);
                if (!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                try { var result = new byte[output.Size]; Marshal.Copy(output.Data, result, 0, output.Size); return result; }
                finally { LocalFree(output.Data); }
            }
            finally { handle.Free(); }
        }
    }
}
