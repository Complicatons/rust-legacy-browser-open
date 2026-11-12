// Reads a compiled plugin assembly (metadata + IL only, never loaded) and reports what Oxide 2.0's CompiledAssembly
// sandbox would replace with an UnauthorizedAccessException at load time, plus the methods of each plugin class.
using System.Text.Json;
using Mono.Cecil;
using Mono.Cecil.Cil;
string[] black = { "Oxide.Core.ServerConsole", "System.IO", "System.Net", "System.Xml", "System.Reflection.Assembly", "System.Reflection.Emit", "System.Threading",
    "System.Runtime.InteropServices", "System.Diagnostics", "System.Security", "System.Timers", "Mono.CSharp", "Mono.Cecil", "ServerFileSystem" };
string[] white = { "System.Diagnostics.Stopwatch", "System.IO.MemoryStream", "System.IO.Stream", "System.IO.BinaryReader", "System.IO.BinaryWriter", "System.Net.Dns",
    "System.Net.Dns.GetHostEntry", "System.Net.IPAddress", "System.Net.IPEndPoint", "System.Net.NetworkInformation",
    "System.Net.Sockets.SocketFlags", "System.Security.Cryptography", "System.Threading.Interlocked" };
bool Bad(string ns) => ns != null && black.Any(b => ns.StartsWith(b)) && !white.Any(w => ns.StartsWith(w));
var asm = AssemblyDefinition.ReadAssembly(args[0]);
var names = args.Skip(1).ToHashSet();
var blocked = new List<object>(); var classes = new Dictionary<string, object>();
void Walk(TypeDefinition t)
{
    foreach (var m in t.Methods)
    {
        string hit = null;
        if (m.Body == null) { if (m.HasPInvokeInfo) hit = "PInvoke"; }
        else
        {
            hit = m.Body.Variables.Select(v => v.VariableType.FullName).FirstOrDefault(Bad);
            if (hit == null) foreach (var i in m.Body.Instructions)
            {
                if (i.OpCode == OpCodes.Ldtoken && Bad((i.Operand as IMetadataTokenProvider)?.ToString())) { hit = i.Operand.ToString(); break; }
                if ((i.OpCode == OpCodes.Call || i.OpCode == OpCodes.Calli || i.OpCode == OpCodes.Callvirt || i.OpCode == OpCodes.Ldftn) && i.Operand is MethodReference mr)
                {
                    var ns = mr.DeclaringType.FullName;
                    if ((ns == "System.Type" && mr.Name == "GetType") || Bad(ns)) { hit = ns + "::" + mr.Name; break; }
                }
                if (i.OpCode == OpCodes.Ldfld && i.Operand is FieldReference fr && Bad(fr.FieldType.FullName)) { hit = fr.FieldType.FullName; break; }
            }
        }
        if (hit != null) blocked.Add(new { method = t.FullName + "::" + m.Name, uses = hit });
    }
    foreach (var n in t.NestedTypes) Walk(n);
}
foreach (var t in asm.MainModule.Types)
{
    Walk(t);
    if (t.Namespace == "Oxide.Plugins" && names.Contains(t.Name))
        classes[t.Name] = new {
            privateCtor = t.Methods.Any(m => !m.IsStatic && m.IsConstructor && !m.HasParameters && !m.IsPublic),
            methods = t.Methods.Where(m => !m.IsConstructor && !m.IsGetter && !m.IsSetter).Select(m => m.Name).Distinct().ToArray(),
            baseType = t.BaseType?.FullName };
}
Console.WriteLine(JsonSerializer.Serialize(new { blocked, classes, types = asm.MainModule.Types.Where(t => t.Name != "<Module>").Select(t => t.FullName).ToArray() }));
