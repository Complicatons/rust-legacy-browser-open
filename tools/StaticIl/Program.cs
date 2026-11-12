// Reads PE/CLI metadata and CIL bytes. Never loads or invokes the input assembly.
using System.Reflection;
using System.Reflection.Emit;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

if (args.Length < 2) throw new ArgumentException("Usage: StaticIl input.dll output.txt [type-regex]");
using var stream = File.OpenRead(args[0]);
using var pe = new PEReader(stream);
if (!pe.HasMetadata) throw new BadImageFormatException("Input has no CLI metadata");
var md = pe.GetMetadataReader();
using var output = new StreamWriter(args[1]);
var filter = args.Length > 2 ? new Regex(args[2], RegexOptions.IgnoreCase) : null;
var ops = typeof(OpCodes).GetFields(BindingFlags.Public | BindingFlags.Static)
    .Where(f => f.FieldType == typeof(OpCode)).Select(f => (OpCode)f.GetValue(null)!)
    .ToDictionary(o => unchecked((ushort)o.Value));
output.WriteLine($"FILE {Path.GetFullPath(args[0])}");
stream.Position = 0;
output.WriteLine($"SHA256 {Convert.ToHexString(SHA256.HashData(stream))}");
output.WriteLine($"MVID {md.GetGuid(md.GetModuleDefinition().Mvid)}");
output.WriteLine("STATIC ONLY: target assembly was not loaded or executed.");
foreach (var ah in md.AssemblyReferences) {
    var a = md.GetAssemblyReference(ah);
    output.WriteLine($"REFERENCE {md.GetString(a.Name)} {a.Version}");
}
foreach (var th in md.TypeDefinitions) {
    var t = md.GetTypeDefinition(th);
    var tn = Name(th);
    if (filter != null && !filter.IsMatch(tn)) continue;
    output.WriteLine($"\nTYPE 0x{MetadataTokens.GetToken(th):x8} {tn}");
    foreach (var fh in t.GetFields()) {
        var f = md.GetFieldDefinition(fh);
        var c = f.GetDefaultValue();
        output.WriteLine($"FIELD 0x{MetadataTokens.GetToken(fh):x8} {md.GetString(f.Name)} {(c.IsNil ? "" : "CONSTANT " + Convert.ToHexString(md.GetBlobBytes(md.GetConstant(c).Value)))}");
    }
    foreach (var mh in t.GetMethods()) {
        var m = md.GetMethodDefinition(mh);
        output.WriteLine($"\nMETHOD 0x{MetadataTokens.GetToken(mh):x8} {tn}::{md.GetString(m.Name)} RVA 0x{m.RelativeVirtualAddress:x}");
        var imp = m.GetImport();
        if (!imp.Module.IsNil) output.WriteLine($"PINVOKE {md.GetString(md.GetModuleReference(imp.Module).Name)}::{md.GetString(imp.Name)}");
        if (m.RelativeVirtualAddress == 0) continue;
        try {
            var body = pe.GetMethodBody(m.RelativeVirtualAddress);
            var il = body.GetILBytes()!;
            output.WriteLine($"IL_SHA256 {Convert.ToHexString(SHA256.HashData(il))}");
            var i = 0;
            while (i < il.Length) {
                int start = i;
                ushort code = il[i++];
                if (code == 0xfe) code = (ushort)(0xfe00 | il[i++]);
                if (!ops.TryGetValue(code, out var op)) throw new BadImageFormatException($"Unknown opcode {code:x}");
                string operand = "";
                switch (op.OperandType) {
                    case OperandType.InlineNone: break;
                    case OperandType.ShortInlineI: operand = ((sbyte)il[i++]).ToString(); break;
                    case OperandType.ShortInlineVar: operand = il[i++].ToString(); break;
                    case OperandType.InlineVar: operand = BitConverter.ToUInt16(il, i).ToString(); i += 2; break;
                    case OperandType.InlineI: operand = BitConverter.ToInt32(il, i).ToString(); i += 4; break;
                    case OperandType.InlineI8: operand = BitConverter.ToInt64(il, i).ToString(); i += 8; break;
                    case OperandType.ShortInlineR: operand = BitConverter.ToSingle(il, i).ToString("R"); i += 4; break;
                    case OperandType.InlineR: operand = BitConverter.ToDouble(il, i).ToString("R"); i += 8; break;
                    case OperandType.ShortInlineBrTarget: operand = $"IL_{i + 1 + (sbyte)il[i]:x4}"; i++; break;
                    case OperandType.InlineBrTarget: operand = $"IL_{i + 4 + BitConverter.ToInt32(il, i):x4}"; i += 4; break;
                    case OperandType.InlineSwitch:
                        int count = BitConverter.ToInt32(il, i); i += 4;
                        int end = checked(i + count * 4);
                        var targets = new List<string>();
                        for (int j = 0; j < count; j++) { targets.Add($"IL_{end + BitConverter.ToInt32(il, i):x4}"); i += 4; }
                        operand = string.Join(", ", targets); break;
                    default:
                        int token = BitConverter.ToInt32(il, i); i += 4;
                        operand = $"0x{token:x8} {Name(MetadataTokens.Handle(token))}"; break;
                }
                output.WriteLine($"IL_{start:x4}: {op.Name} {operand}");
            }
            foreach (var e in body.ExceptionRegions) output.WriteLine($"EXCEPTION {e.Kind} try IL_{e.TryOffset:x4}+{e.TryLength} handler IL_{e.HandlerOffset:x4}+{e.HandlerLength}");
        } catch (Exception ex) { output.WriteLine($"DECODE_ERROR {ex.GetType().Name}: {ex.Message}"); }
    }
}
Console.WriteLine($"Wrote static IL to {args[1]}");

string Name(Handle h) {
    try {
        switch (h.Kind) {
            case HandleKind.TypeDefinition:
                var td = md.GetTypeDefinition((TypeDefinitionHandle)h);
                var parent = td.GetDeclaringType();
                return parent.IsNil ? Qualified(md.GetString(td.Namespace), md.GetString(td.Name)) : Name(parent) + "/" + md.GetString(td.Name);
            case HandleKind.TypeReference:
                var tr = md.GetTypeReference((TypeReferenceHandle)h);
                return Qualified(md.GetString(tr.Namespace), md.GetString(tr.Name));
            case HandleKind.MethodDefinition:
                var mm = md.GetMethodDefinition((MethodDefinitionHandle)h);
                return Name(mm.GetDeclaringType()) + "::" + md.GetString(mm.Name);
            case HandleKind.FieldDefinition:
                var ff = md.GetFieldDefinition((FieldDefinitionHandle)h);
                return Name(ff.GetDeclaringType()) + "::" + md.GetString(ff.Name);
            case HandleKind.MemberReference:
                var mr = md.GetMemberReference((MemberReferenceHandle)h);
                return Name(mr.Parent) + "::" + md.GetString(mr.Name);
            case HandleKind.MethodSpecification:
                return Name(md.GetMethodSpecification((MethodSpecificationHandle)h).Method) + "<generic>";
            case HandleKind.UserString:
                return JsonSerializer.Serialize(md.GetUserString((UserStringHandle)h));
            case HandleKind.ModuleReference:
                return md.GetString(md.GetModuleReference((ModuleReferenceHandle)h).Name);
            default: return h.Kind.ToString();
        }
    } catch (Exception ex) { return $"UNRESOLVED({ex.GetType().Name})"; }
}
string Qualified(string ns, string name) => ns.Length == 0 ? name : ns + "." + name;
