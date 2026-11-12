// Hardware ID for ban linking (DESKTOP-LAUNCHER-PLAN.md "Hardware ID"):
//   "v1:" + base64url(SHA-256("rlb-hwid-v1\0" + MachineGuid + "\0" + SMBIOS system UUID + "\0" + C: volume serial))
// Only this hash leaves the PC (central keeps an HMAC of it). Each part is normalised so the same machine always gives
// the same value: MachineGuid lower case, the UUID upper case (as WMI shows it) with the all-0 / all-F placeholders some
// boards report treated as missing, the volume serial as 8 upper-case hex digits. A part that cannot be read (locked-down
// PC, WMI service off) is an empty string, so the launcher still works; the ID is just weaker.
// tests/launcher-host.test.mjs pins FromParts against the same formula in JS (test vector in test/Program.cs).
using System;
using System.Management;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;

namespace RustLegacyLauncher
{
    public static class HardwareId
    {
        const string Salt = "rlb-hwid-v1\0";
        // WMI takes a moment and the parts do not change while the launcher runs: read them once.
        static readonly Lazy<string> current = new Lazy<string>(() => FromParts(MachineGuid(), SystemUuid(), VolumeSerial(@"C:\")));
        public static string Current => current.Value;

        public static string FromParts(string machineGuid, string systemUuid, string volumeSerial)
        {
            byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes(Salt + (machineGuid ?? "") + "\0" + (systemUuid ?? "") + "\0" + (volumeSerial ?? "")));
            return "v1:" + Convert.ToBase64String(hash).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }

        // HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid, from the 64-bit registry view whatever this process is.
        public static string MachineGuid()
        {
            try
            {
                using (var hklm = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
                using (var key = hklm.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography"))
                    return ((key?.GetValue("MachineGuid") as string) ?? "").Trim().ToLowerInvariant();
            }
            catch (Exception) { return ""; }
        }

        // Win32_ComputerSystemProduct.UUID: the SMBIOS system UUID.
        public static string SystemUuid()
        {
            try
            {
                using (var searcher = new ManagementObjectSearcher("SELECT UUID FROM Win32_ComputerSystemProduct"))
                using (var results = searcher.Get())
                {
                    foreach (ManagementBaseObject o in results)
                    {
                        try { return NormaliseUuid(o["UUID"] as string); }
                        finally { o.Dispose(); }
                    }
                }
            }
            catch (Exception) { }
            return "";
        }

        public static string NormaliseUuid(string uuid)
        {
            string u = (uuid ?? "").Trim().ToUpperInvariant(), hex = u.Replace("-", "");
            return hex.Length == 0 || hex.Trim('0').Length == 0 || hex.Trim('F').Length == 0 ? "" : u;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool GetVolumeInformationW(string rootPath, StringBuilder volumeName, int volumeNameSize, out uint serial, out uint maxComponentLength, out uint flags, StringBuilder fileSystemName, int fileSystemNameSize);

        public static string VolumeSerial(string root)
        {
            try { return GetVolumeInformationW(root, null, 0, out uint serial, out _, out _, null, 0) ? serial.ToString("X8") : ""; }
            catch (Exception) { return ""; }
        }
    }
}
