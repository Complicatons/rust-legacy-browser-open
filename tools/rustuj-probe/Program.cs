// Read-only survey of a community client/server package's managed assemblies (OFFSHOOT-COMPATIBILITY-PLAN.md work
// item 1: Rustuj's server framework is still unconfirmed). Earlier attempts used ILSpy's command line to fully
// decompile every non-stock assembly to C# source, which either ran out of time on a large assembly or failed
// outright on one earlier recon found had no ordinary MZ/PE header (analysis/rustuj-recon/2026-10-26-findings.md).
// This tool skips full decompilation entirely: Mono.Cecil reads only the metadata and IL it needs to list type/
// method/field names and Ldstr string operands, which is enough to grep for login/handshake/anti-cheat keywords,
// and is both much faster than a full decompile and more informative about *why* a file can't be read (the
// specific exception) than ILSpy's plain failure. Never loads or executes any assembly into a CLR -- the same
// static-analysis-only convention as tools/vanilla-patcher.
using System.Text.RegularExpressions;
using Mono.Cecil;
using Mono.Cecil.Cil;

if (args.Length != 1) { Console.Error.WriteLine("Usage: RustujProbe <directory>"); return 2; }
string root = Path.GetFullPath(args[0]);
if (!Directory.Exists(root)) { Console.Error.WriteLine($"Not a directory: {root}"); return 2; }

// Same keyword set as deploy/azure-test/scripts/30-Survey-Offshoots.ps1's $hitWords, for consistent greppable output.
var hitWords = new Regex(
    "SteamTicket|StartUserAuth|BeginAuth|AuthorisationRoutine|OnPlayerApproval|ReadConnectionData|Approve|Deny|Kick|" +
    "HWID|HardwareId|MachineGuid|token|session|password|login|handshake|anticheat|anti-cheat|RustBuster|BAC|Luma|" +
    "SteamID|whitelist|signature|https?://",
    RegexOptions.IgnoreCase | RegexOptions.Compiled);

var files = Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)
    .Where(f => f.EndsWith(".dll", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
    .OrderBy(f => f).ToList();
Console.WriteLine($"{files.Count} .dll/.exe file(s) under {root}");

int readable = 0, unreadable = 0;
foreach (var path in files) {
    string rel = Path.GetRelativePath(root, path);
    try {
        using var module = ModuleDefinition.ReadModule(path, new ReaderParameters { ReadingMode = ReadingMode.Deferred });
        readable++;
        var types = module.Types.Where(t => t.Name != "<Module>").ToList();
        int methods = types.Sum(t => t.Methods.Count);
        Console.WriteLine($"MANAGED {rel}: {module.Assembly.Name.Name}, {types.Count} type(s), {methods} method(s)");

        var hits = new List<string>();
        foreach (var type in types) {
            if (hitWords.IsMatch(type.FullName)) hits.Add($"type   {type.FullName}");
            foreach (var field in type.Fields) if (hitWords.IsMatch(field.Name)) hits.Add($"field  {type.Name}.{field.Name}");
            foreach (var method in type.Methods) {
                if (hitWords.IsMatch(method.Name)) hits.Add($"method {type.Name}.{method.Name}");
                // Each method's body is read on its own: one malformed method must not hide hits in the rest of
                // the file (same per-item isolation as vanilla-patcher's ProbeSites).
                if (!method.HasBody) continue;
                try {
                    foreach (var instr in method.Body.Instructions)
                        if (instr.OpCode == OpCodes.Ldstr && instr.Operand is string s && hitWords.IsMatch(s))
                            hits.Add($"string \"{Truncate(s, 120)}\" in {type.Name}.{method.Name}");
                } catch { /* one method's IL failing to read is not fatal to the rest of the file */ }
            }
        }
        foreach (var h in hits.Distinct().Take(500)) Console.WriteLine($"  hit: {h}");
        if (hits.Count > 500) Console.WriteLine($"  ... {hits.Count - 500} more hit(s), truncated");
    } catch (Exception e) {
        unreadable++;
        Console.WriteLine($"UNREADABLE {rel}: {e.GetType().Name}: {e.Message}");
    }
}
Console.WriteLine($"{readable} readable, {unreadable} unreadable.");
return 0;

static string Truncate(string s, int max) => s.Length > max ? s[..max] + "…" : s;
