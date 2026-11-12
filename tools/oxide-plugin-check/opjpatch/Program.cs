// Applies the Modifiers and Fields of Oxide's RustLegacy.opj to a copy of Assembly-CSharp (metadata only; hooks are
// IL injections that don't change what a plugin can compile against, so they are skipped). Nothing is loaded or run.
using System.Text.Json;
using Mono.Cecil;
var (opj, input, oxideCore, output) = (args[0], args[1], args[2], args[3]);
var doc = JsonDocument.Parse(File.ReadAllText(opj).TrimStart('﻿'));
var resolver = new DefaultAssemblyResolver(); resolver.AddSearchDirectory(Path.GetDirectoryName(input)); resolver.AddSearchDirectory(Path.GetDirectoryName(oxideCore));
var asm = AssemblyDefinition.ReadAssembly(input, new ReaderParameters { AssemblyResolver = resolver });
var core = AssemblyDefinition.ReadAssembly(oxideCore);
var m = asm.MainModule;
foreach (var man in doc.RootElement.GetProperty("Manifests").EnumerateArray())
{
    if (man.GetProperty("AssemblyName").GetString() != "Assembly-CSharp.dll") continue;
    foreach (var mod in man.GetProperty("Modifiers").EnumerateArray())
    {
        var type = m.GetType(mod.GetProperty("TypeName").GetString());
        var name = mod.GetProperty("Signature").GetProperty("Name").GetString();
        var exp = mod.GetProperty("TargetExposure").EnumerateArray().Select(e => e.GetInt32()).ToArray();
        if (mod.GetProperty("Type").GetInt32() != 0) throw new Exception("only field modifiers handled: " + mod);
        var f = type.Fields.Single(x => x.Name == name);
        f.Attributes &= ~FieldAttributes.FieldAccessMask;
        // Oxide patcher Exposure: 0 Private, 1 Protected, 2 Public, 3 Internal, 4 Static
        f.Attributes |= exp.Contains(2) ? FieldAttributes.Public : exp.Contains(1) ? FieldAttributes.Family : exp.Contains(3) ? FieldAttributes.Assembly : FieldAttributes.Private;
        if (exp.Contains(4)) f.Attributes |= FieldAttributes.Static;
        Console.WriteLine($"modifier {type.Name}.{name} -> {f.Attributes}");
    }
    foreach (var fld in man.GetProperty("Fields").EnumerateArray())
    {
        var type = m.GetType(fld.GetProperty("TypeName").GetString());
        var ft = fld.GetProperty("FieldType").GetString().Split('|'); // "Oxide.Core|Oxide.Core.Libraries.Covalence.IPlayer"
        var t = core.MainModule.GetType(ft[1]);
        type.Fields.Add(new FieldDefinition(fld.GetProperty("Name").GetString(), FieldAttributes.Public, m.ImportReference(t)));
        Console.WriteLine($"field {type.Name}.{fld.GetProperty("Name").GetString()} : {ft[1]}");
    }
}
asm.Write(output);
