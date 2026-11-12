// Adds the browser-admission hooks (adapter/vanilla) to an operator's own copy of the vanilla Rust Legacy server's
// Assembly-CSharp.dll. Reads and rewrites CLI metadata/IL with dnlib; never loads or runs the game assemblies.
// Refuses any build other than the one the hooks were traced against, keeps the original for `restore`, and never
// touches the native login path: every hook returns early for logins without an RLBA envelope.
// Uses dnlib, not Mono.Cecil: Cecil's writer corrupts the NestedClass table on at least one real-world build
// (genuine Fougerite 1.9.91 premade server), even on a zero-edit read+write round-trip with none of our edits
// applied -- confirmed a pure Cecil limitation on that file's shape, not anything about our patch logic. dnlib
// round-trips the same file cleanly (OFFSHOOT-COMPATIBILITY-PLAN.md work item 4, 2026-10-30).
using System.Security.Cryptography;
using dnlib.DotNet;
using dnlib.DotNet.Emit;

const string Target = "Assembly-CSharp.dll", Backup = "Assembly-CSharp.dll.rlb-original", Adapter = "RustLegacyBrowser.Vanilla.dll";
const string HooksType = "RustLegacyBrowser.Hooks";
// Distinct (method → hook) pairs after `patch`: 4 admission/chat + 17 evidence (ANTICHEAT-ADMIN-PLAN slice 8).
const int ExpectedSites = 21;
// SHA-256 of supported unpatched builds (traced in EXISTING-SERVER-INTEGRATION-PLAN.md).
var supported = new Dictionary<string, string> {
    ["CE0DD83271472454FC27CE137A9FA9D042B3A5F12FB26F1C7A67D61EEA3ACFBB"] = "Rust Legacy server (community package, May 2015 bundles)",
    // Fougerite's own public premade 1.9.91 server package (OFFSHOOT-COMPATIBILITY-PLAN.md work item 4): probe
    // found all 17 sites once the admission hook stopped depending on the method body's shape. Allowlisted so the
    // coordinator's next VM round can run a real patch+verify (not just probe) against the genuine file.
    ["C7D2AF703C455A5726ACA9D4945801E402A4D835128BCF9B5C333D5518F9AC2A"] = "Fougerite 1.9.91 premade server (Notulp/Fougerite, OriginalRustServerFilesFougerite1.9.91_Premade)",
};

if (args.Length != 2 || !new[] { "check", "patch", "verify", "restore", "probe" }.Contains(args[0])) {
    Console.Error.WriteLine("Usage: VanillaPatcher check|patch|verify|restore|probe <rust_server_Data/Managed>");
    return 2;
}
string dir = Path.GetFullPath(args[1]), target = Path.Combine(dir, Target), backup = Path.Combine(dir, Backup), adapter = Path.Combine(dir, Adapter);
string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)));
try {
    switch (args[0]) {
        case "check": {
            string h = Hash(target);
            Console.WriteLine($"{Target} SHA-256 {h}");
            if (!supported.TryGetValue(h, out var name)) { Console.WriteLine(Patched(target) ? "Already patched." : "Unsupported build: refusing."); return 1; }
            Console.WriteLine($"Supported: {name}");
            Console.WriteLine(File.Exists(adapter) ? $"Adapter present: {Adapter}" : $"Adapter missing: build adapter/vanilla and copy {Adapter} here.");
            foreach (var line in Plan(target, null)) Console.WriteLine("  would patch " + line);
            return File.Exists(adapter) ? 0 : 1;
        }
        // Read-only, like `check`, but reports against ANY build, allowlisted or not: for seeing whether our hook-site
        // pattern still matches a community build (e.g. a Fougerite-patched server) before deciding to allowlist it.
        // Never writes `target`, `backup` or `supported`; a probed build gains no capability `check`/`patch` refuse.
        case "probe": {
            string h = Hash(target);
            Console.WriteLine($"{Target} SHA-256 {h}");
            Console.WriteLine(supported.TryGetValue(h, out var known) ? $"Already supported: {known}" : "Not on the allowlist (that is fine for a probe).");
            if (Patched(target)) { Console.WriteLine("Already carries our hooks (RustLegacyBrowser.Hooks is referenced); nothing to probe."); return 1; }
            // One attempt per hook site, each isolated: a build that fails ONE lookup still reports every other site,
            // instead of the whole probe aborting on the first mismatch (Plan()/`check` do abort: fine for a build we
            // already trust, useless for diagnosing an unfamiliar one). Never calls Plan(), never writes anything.
            int found = 0, missing = 0;
            foreach (var (ok, line) in ProbeSites(target)) { Console.WriteLine(ok ? "  site found: " + line : "  NOT FOUND: " + line); if (ok) found++; else missing++; }
            Console.WriteLine($"{found} site(s) found, {missing} not found.");
            return missing == 0 ? 0 : 1;
        }
        case "patch": {
            string h = Hash(target);
            if (!supported.ContainsKey(h)) throw new InvalidOperationException(Patched(target) ? "Already patched (run restore first)." : $"Unsupported build {h}: refusing.");
            if (!File.Exists(adapter)) throw new FileNotFoundException($"Build adapter/vanilla and copy {Adapter} into {dir} first.");
            if (File.Exists(backup) && Hash(backup) != h) throw new InvalidOperationException($"{Backup} exists and differs from {Target}; resolve manually.");
            File.Copy(target, backup, overwrite: true);
            string temp = target + ".rlb-tmp";
            foreach (var line in Plan(backup, temp)) Console.WriteLine("patched " + line);
            // Self-check the file we just wrote before ever installing it: this is exactly the class of problem that
            // moved this tool from Mono.Cecil to dnlib (a writer that corrupts the file's own metadata on at least
            // one real-world build) -- a clean `patch` here is no guarantee the output is actually sound on every
            // build dnlib might ever mishandle too. An operator's live server must never be left on a file we can't
            // even read back correctly ourselves.
            var (checkSites, badTypes) = Sites(temp);
            if (badTypes.Count > 0) {
                File.Delete(temp);
                throw new InvalidOperationException($"Refusing to install: the patched file has malformed metadata ({badTypes.Count} type(s) unreadable, e.g. {badTypes[0]}). {Target} was not changed; {Backup} is still the original.");
            }
            if (checkSites.Count != ExpectedSites) {
                File.Delete(temp);
                throw new InvalidOperationException($"Refusing to install: expected {ExpectedSites} hook call(s) in the patched file, found {checkSites.Count}. {Target} was not changed; {Backup} is still the original.");
            }
            File.Move(temp, target, overwrite: true);
            Console.WriteLine($"Done. Original kept as {Backup}; `restore` puts it back.");
            return 0;
        }
        case "verify": {
            var (sites, badTypes) = Sites(target);
            foreach (var s in sites) Console.WriteLine("hook " + s);
            foreach (var b in badTypes) Console.WriteLine("UNREADABLE TYPE: " + b);
            bool ok = sites.Count == ExpectedSites && badTypes.Count == 0 && File.Exists(adapter);
            Console.WriteLine(ok ? "Patched build looks complete."
                : badTypes.Count > 0 ? "Patch output has malformed metadata (see UNREADABLE TYPE above); do not use -- `restore` and investigate."
                : "Patch incomplete or adapter missing.");
            return ok ? 0 : 1;
        }
        default: {
            if (!File.Exists(backup)) throw new FileNotFoundException("No backup to restore.");
            if (!supported.ContainsKey(Hash(backup))) throw new InvalidOperationException("Backup is not a supported original; refusing.");
            File.Copy(backup, target, overwrite: true);
            File.Delete(backup);
            Console.WriteLine("Original restored.");
            return 0;
        }
    }
} catch (Exception e) {
    // The full exception (type, message, stack trace), not just e.Message: a bare message cost a whole VM round
    // (2026-10-30) when "Specified argument was out of the range of valid values." alone didn't say which Cecil
    // call threw or why. This tool's whole output is already diagnostic text for an operator/developer, never a
    // user-facing message, so there is no reason to hide the trace behind a flag.
    Console.Error.WriteLine("Error: " + e);
    return 1;
}

// Every real parameter of `m`, excluding the hidden `this` dnlib adds at index 0 for an instance method -- the same
// view Mono.Cecil's own Parameters collection always gave for free, used throughout for build-shape matching.
static IEnumerable<Parameter> RealParams(MethodDef m) => m.Parameters.Where(p => !p.IsHiddenThisParameter);

// A module context whose resolver can load other assemblies (e.g. uLink) sitting beside `target` in `dir`, needed
// whenever a type/field/method reference crosses into a different module than the one being read.
static ModuleContext Context(string dir) {
    var asmResolver = new AssemblyResolver { EnableTypeDefCache = true };
    var ctx = new ModuleContext(asmResolver, new Resolver(asmResolver));
    asmResolver.DefaultModuleContext = ctx;
    asmResolver.PostSearchPaths.Add(dir);
    return ctx;
}

// Applies (output != null) or dry-runs the four injections; returns a description of each site.
List<string> Plan(string input, string? output) {
    var ctx = Context(dir);
    using var module = ModuleDefMD.Load(input, ctx);
    // Hooks() methods take Assembly-CSharp's own types as parameters (ConnectionAcceptor, BulletWeaponDataBlock,
    // ...), since the adapter was built against a copy of this same file. Registering `module` in the shared
    // resolver's cache means resolving that reference, while importing the Hooks methods below, lands back on this
    // exact instance -- letting TryToUseTypeDefs substitute the real local TypeDef instead of fabricating a
    // ModuleRef back to the adapter DLL for them (which CoreCLR then refuses to load).
    ((AssemblyResolver)ctx.AssemblyResolver).AddToCache(module);
    MethodDef Method(string type, string name) =>
        module.Find(type, false)?.Methods.SingleOrDefault(m => m.Name == name && m.HasBody) ?? throw new InvalidOperationException($"{type}.{name} not found");
    var approval = Method("ConnectionAcceptor", "uLink_OnPlayerApproval");
    var connected = Method("ConnectionAcceptor", "uLink_OnPlayerConnected");
    var disconnected = Method("ConnectionAcceptor", "uLink_OnPlayerDisconnected");
    var say = Method("chat", "say");
    foreach (var m in new[] { approval, connected, disconnected, say }) m.Body.SimplifyMacros(m.Parameters); // long branches, explicit operands

    // The approval hook now goes unconditionally at the very start of the method, for every build (stock or
    // patched): it builds its own ClientConnection from an independent copy of approval.loginData's bytes, so it
    // never needs to recognise any particular build's internal shape (OFFSHOOT-COMPATIBILITY-PLAN.md work item 4;
    // a Fougerite build replaces the whole method body with one call into its own framework, with nothing left to
    // pattern-match). approval.loginData is a readonly BitStream field — unsafe to read twice directly, since
    // reading advances its position — but BitStream's own public (byte[], bool) constructor opens a fresh,
    // independent read-only copy over the same bytes (ReadConnectionData's own order: Protocol, ConnectionMode,
    // then UserID/UserName/SteamTicket only when ConnectionMode == 2), so the rest of the method — stock's own
    // inline logic, or Fougerite's own dispatch — still runs exactly as it always has, never touched.
    var napprovalType = RealParams(approval).Single().Type.ToTypeDefOrRef().ResolveTypeDef() ?? throw new InvalidOperationException("Could not resolve uLink.NetworkPlayerApproval");
    var loginDataField = napprovalType.Fields.SingleOrDefault(f => f.Name == "loginData") ?? throw new InvalidOperationException("NetworkPlayerApproval.loginData not found");
    var bitStreamType = loginDataField.FieldType.ToTypeDefOrRef().ResolveTypeDef() ?? throw new InvalidOperationException("Could not resolve uLink.BitStream");
    var bitStreamCtor = bitStreamType.Methods.SingleOrDefault(m => m.IsConstructor && !m.IsStatic && RealParams(m).Count() == 2
        && RealParams(m).ElementAt(0).Type.FullName == "System.Byte[]" && RealParams(m).ElementAt(1).Type.FullName == "System.Boolean")
        ?? throw new InvalidOperationException("BitStream(byte[], bool) constructor not found");
    var dataGetter = bitStreamType.Methods.SingleOrDefault(m => m.Name == "get__data") ?? throw new InvalidOperationException("BitStream._data getter not found");
    var isTypeSafeField = bitStreamType.Fields.SingleOrDefault(f => f.Name == "isTypeSafe") ?? throw new InvalidOperationException("BitStream.isTypeSafe not found");
    MethodDef BitStreamRead(string name) => bitStreamType.Methods.SingleOrDefault(m => m.Name == name && RealParams(m).Count() == 0) ?? throw new InvalidOperationException($"BitStream.{name}() not found");
    var readInt32 = BitStreamRead("ReadInt32"); var readByte = BitStreamRead("ReadByte"); var readUInt64 = BitStreamRead("ReadUInt64");
    var readString = BitStreamRead("ReadString"); var readBytes = BitStreamRead("ReadBytes");
    var ccType = module.Find("ClientConnection", false) ?? throw new InvalidOperationException("ClientConnection not found");
    var ccCtor = ccType.Methods.SingleOrDefault(m => m.IsConstructor && !m.IsStatic && RealParams(m).Count() == 0) ?? throw new InvalidOperationException("ClientConnection() constructor not found");
    FieldDef CcField(string name) => ccType.Fields.SingleOrDefault(f => f.Name == name) ?? throw new InvalidOperationException($"ClientConnection.{name} not found");
    var fProtocol = CcField("Protocol"); var fMode = CcField("ConnectionMode"); var fUserID = CcField("UserID"); var fUserName = CcField("UserName"); var fSteamTicket = CcField("SteamTicket");
    var approvalStart = approval.Body.Instructions[0];

    var rets = connected.Body.Instructions.Where(i => i.OpCode == OpCodes.Ret).ToList();
    var sites = new List<string> {
        "ConnectionAcceptor.uLink_OnPlayerApproval: OnUserApprove at entry, from our own copy of loginData (works on any build, including one that rewrites the rest of the method)",
        $"ConnectionAcceptor.uLink_OnPlayerConnected: OnPlayerConnected before {rets.Count} return(s)",
        "ConnectionAcceptor.uLink_OnPlayerDisconnected: OnPlayerDisconnected at entry",
        "chat.say: OnChat at entry (consumes /browserlink)",
    };
    // Evidence hooks (adapter/vanilla/RustLegacyBrowserVanilla.Evidence.cs): exact overloads by parameter types, so a
    // different build fails here instead of patching the wrong method. Each hook only reads; none changes the result.
    MethodDef Exact(string type, string name, params string[] parameters) =>
        module.Find(type, false)?.Methods.SingleOrDefault(m => m.Name == name && m.HasBody && RealParams(m).Select(p => p.Type.FullName).SequenceEqual(parameters))
        ?? throw new InvalidOperationException($"{type}.{name}({string.Join(", ", parameters)}) not found");
    const string Info = "uLink.NetworkMessageInfo", Stream = "uLink.BitStream", Rep = "ItemRepresentation";
    var evidence = new List<(MethodDef method, string hook, bool atEntry, int[] args, int derefArg)>();
    void Entry(MethodDef m, string hook, params int[] args) => evidence.Add((m, hook, true, args, -1));
    void Exits(MethodDef m, string hook, int derefArg, params int[] args) => evidence.Add((m, hook, false, args, derefArg));
    var itmv = Exact("Inventory", "ITMV", "NetEntityID", "System.Byte", "System.Byte", Info);
    var itmg = Exact("Inventory", "ITMG", "NetEntityID", "System.Byte", "System.Byte", "System.Boolean", Info);
    Entry(itmv, "OnSlotMoveBefore", 0, 1, 2, 3, 4); Exits(itmv, "OnSlotMoveAfter", -1, 0);
    Entry(itmg, "OnSlotMoveBefore", 0, 1, 2, 3, 5); Exits(itmg, "OnSlotMoveAfter", -1, 0);
    Entry(Exact("Inventory", "ISMV", "System.Byte", "System.Byte", Info), "OnSlotOp", 3);
    Entry(Exact("Inventory", "ITSM", "System.Byte", "System.Byte", "System.Boolean", Info), "OnSlotOp", 4);
    Entry(Exact("Inventory", "ITSP", "System.Byte", Info), "OnSlotOp", 2);
    Exits(Exact("DropHelper", "DropItem", "Inventory", "System.Int32", "ItemPickup&"), "OnDropItemAfter", 1, 0, 2); // inventory, *dropped
    var death = Exact("DropHelper", "DropInventoryContents", "Inventory", "Inventory&");
    Entry(death, "OnDeathDropBefore", 0); Exits(death, "OnDeathDropAfter", 0, 1); // *droppedTo
    var use = Exact("ItemPickup", "PlayerUse", "Controllable");
    Entry(use, "OnPickupBefore", 0, 1); Exits(use, "OnPickupAfter", -1, 0);
    foreach (var weapon in new[] { "BulletWeaponDataBlock", "ShotgunDataBlock", "MeleeWeaponDataBlock", "BowWeaponDataBlock" })
        Entry(Exact(weapon, "DoAction1", Stream, Rep, Info + "&"), "OnWeaponAction", 0, 2);
    // ApplyDamage(hitObj, fromTransform, isHeadshot, endPos, bodyPart, rep): this, hitObj, endPos, bodyPart, rep.
    Entry(Exact("BulletWeaponDataBlock", "ApplyDamage", "UnityEngine.GameObject", "UnityEngine.Transform", "System.Boolean", "UnityEngine.Vector3", "BodyPart", Rep), "OnBulletHit", 0, 1, 4, 5, 6);
    foreach (var e in evidence) {
        int count = e.atEntry ? 1 : e.method.Body.Instructions.Count(i => i.OpCode == OpCodes.Ret);
        if (count == 0) throw new InvalidOperationException($"{e.method.DeclaringType.Name}.{e.method.Name} has no return");
        sites.Add($"{e.method.DeclaringType.Name}.{e.method.Name}: {e.hook} {(e.atEntry ? "at entry" : $"before {count} return(s)")}");
    }
    if (output == null) return sites;

    using var hooksModule = ModuleDefMD.Load(adapter, ctx);
    var hooks = hooksModule.Find(HooksType, false) ?? throw new InvalidOperationException($"{HooksType} missing from {Adapter}");
    // TryToUseTypeDefs + LocalTypeMapper: see their own comments. Both aim at the same bug -- the adapter's Hooks
    // methods take game types (ConnectionAcceptor, BulletWeaponDataBlock, ...) as parameters, and those are
    // *already* TypeDefs in `module` (the file being patched is literally their home assembly).
    var importer = new Importer(module, ImporterOptions.TryToUseTypeDefs, new GenericParamContext(), new LocalTypeMapper(module));
    IMethod Hook(string name) => importer.Import(hooks.Methods.Single(m => m.Name == name));

    // var cc = new ClientConnection(); var bs = new BitStream(approval.loginData._data, approval.loginData.isTypeSafe);
    // cc.Protocol = bs.ReadInt32(); cc.ConnectionMode = (int)bs.ReadByte();
    // if (cc.ConnectionMode == 2) { cc.UserID = bs.ReadUInt64(); cc.UserName = bs.ReadString(); cc.SteamTicket = bs.ReadBytes(); }
    // if (Hooks.OnUserApprove(cc, approval, this)) return;
    Insert(approval, approvalStart, retarget: false, () => {
        var vCc = new Local(importer.Import(ccType).ToTypeSig()); approval.Body.Variables.Add(vCc);
        var vBs = new Local(importer.Import(bitStreamType).ToTypeSig()); approval.Body.Variables.Add(vBs);
        var callHook = Instruction.Create(OpCodes.Ldloc, vCc); // also the branch target when ConnectionMode != 2
        return new[] {
            Instruction.Create(OpCodes.Newobj, (IMethod)importer.Import(ccCtor)), Instruction.Create(OpCodes.Stloc, vCc),
            Instruction.Create(OpCodes.Ldarg_1), Instruction.Create(OpCodes.Ldfld, (IField)importer.Import(loginDataField)), Instruction.Create(OpCodes.Callvirt, (IMethod)importer.Import(dataGetter)),
            Instruction.Create(OpCodes.Ldarg_1), Instruction.Create(OpCodes.Ldfld, (IField)importer.Import(loginDataField)), Instruction.Create(OpCodes.Ldfld, (IField)importer.Import(isTypeSafeField)),
            Instruction.Create(OpCodes.Newobj, (IMethod)importer.Import(bitStreamCtor)), Instruction.Create(OpCodes.Stloc, vBs),
            Instruction.Create(OpCodes.Ldloc, vCc), Instruction.Create(OpCodes.Ldloc, vBs), Instruction.Create(OpCodes.Callvirt, (IMethod)importer.Import(readInt32)), Instruction.Create(OpCodes.Stfld, (IField)importer.Import(fProtocol)),
            Instruction.Create(OpCodes.Ldloc, vCc), Instruction.Create(OpCodes.Ldloc, vBs), Instruction.Create(OpCodes.Callvirt, (IMethod)importer.Import(readByte)), Instruction.Create(OpCodes.Conv_I4), Instruction.Create(OpCodes.Stfld, (IField)importer.Import(fMode)),
            Instruction.Create(OpCodes.Ldloc, vCc), Instruction.Create(OpCodes.Ldfld, (IField)importer.Import(fMode)), Instruction.Create(OpCodes.Ldc_I4_2), Instruction.Create(OpCodes.Bne_Un, callHook),
            Instruction.Create(OpCodes.Ldloc, vCc), Instruction.Create(OpCodes.Ldloc, vBs), Instruction.Create(OpCodes.Callvirt, (IMethod)importer.Import(readUInt64)), Instruction.Create(OpCodes.Stfld, (IField)importer.Import(fUserID)),
            Instruction.Create(OpCodes.Ldloc, vCc), Instruction.Create(OpCodes.Ldloc, vBs), Instruction.Create(OpCodes.Callvirt, (IMethod)importer.Import(readString)), Instruction.Create(OpCodes.Stfld, (IField)importer.Import(fUserName)),
            Instruction.Create(OpCodes.Ldloc, vCc), Instruction.Create(OpCodes.Ldloc, vBs), Instruction.Create(OpCodes.Callvirt, (IMethod)importer.Import(readBytes)), Instruction.Create(OpCodes.Stfld, (IField)importer.Import(fSteamTicket)),
            callHook, Instruction.Create(OpCodes.Ldarg_1), Instruction.Create(OpCodes.Ldarg_0), Instruction.Create(OpCodes.Call, Hook("OnUserApprove")),
            Instruction.Create(OpCodes.Brfalse, approvalStart), Instruction.Create(OpCodes.Ret) };
    });
    foreach (var ret in rets)
        Insert(connected, ret, retarget: true, () => new[] { Instruction.Create(OpCodes.Ldarg_1), Instruction.Create(OpCodes.Call, Hook("OnPlayerConnected")) });
    Insert(disconnected, disconnected.Body.Instructions[0], retarget: false, () => new[] { Instruction.Create(OpCodes.Ldarg_1), Instruction.Create(OpCodes.Call, Hook("OnPlayerDisconnected")) });
    var first = say.Body.Instructions[0];
    Insert(say, first, retarget: false, () => new[] { Instruction.Create(OpCodes.Ldarg_0), Instruction.Create(OpCodes.Call, Hook("OnChat")), Instruction.Create(OpCodes.Brfalse, first), Instruction.Create(OpCodes.Ret) });
    // Evidence: argument i of the method (0 = this for instance methods) as the hook's parameters; derefArg is the
    // position of an out parameter read through its pointer (its value at the return). Entries never retarget (a loop
    // back to the start must not call again); returns do, so every path out passes through the hook. dnlib's own
    // Parameters list already puts `this` at index 0 for an instance method, exactly matching that convention.
    foreach (var m in evidence.Select(e => e.method).Distinct()) m.Body.SimplifyMacros(m.Parameters);
    foreach (var e in evidence) {
        var hook = Hook(e.hook);
        if (hook.MethodSig.Params.Count != e.args.Length) throw new InvalidOperationException($"{e.hook} takes {hook.MethodSig.Params.Count} arguments, the plan passes {e.args.Length}");
        Instruction[] Code() {
            var list = new List<Instruction>();
            for (int k = 0; k < e.args.Length; k++) {
                int a = e.args[k];
                var p = e.method.Parameters[a];
                list.Add(Instruction.Create(OpCodes.Ldarg, p));
                if (k == e.derefArg) list.Add(Instruction.Create(OpCodes.Ldind_Ref));
            }
            list.Add(Instruction.Create(OpCodes.Call, hook));
            return list.ToArray();
        }
        if (e.atEntry) Insert(e.method, e.method.Body.Instructions[0], retarget: false, Code);
        else foreach (var ret in e.method.Body.Instructions.Where(i => i.OpCode == OpCodes.Ret).ToList()) Insert(e.method, ret, retarget: true, Code);
    }
    foreach (var m in new[] { approval, connected, disconnected, say }.Concat(evidence.Select(e => e.method)).Distinct()) m.Body.OptimizeMacros();
    module.Write(output!);
    return sites;
}

// Read-only mirror of Plan()'s site-collection half (never the write half: a probe never patches), but each site is
// tried on its own, so one mismatch in a community build does not hide whether the OTHER 20 sites still match. Kept
// as its own function rather than a `strict` flag on Plan(): `check`/`patch` stay exactly as proven, untouched.
List<(bool ok, string line)> ProbeSites(string input) {
    var results = new List<(bool, string)>();
    void Try(string what, Func<string> body) { try { results.Add((true, body())); } catch (Exception e) { results.Add((false, $"{what}: {e.Message}")); } }

    using var module = ModuleDefMD.Load(input, Context(dir));
    MethodDef Method(string type, string name) =>
        module.Find(type, false)?.Methods.SingleOrDefault(m => m.Name == name && m.HasBody) ?? throw new InvalidOperationException($"{type}.{name} not found");
    MethodDef Exact(string type, string name, params string[] parameters) =>
        module.Find(type, false)?.Methods.SingleOrDefault(m => m.Name == name && m.HasBody && RealParams(m).Select(p => p.Type.FullName).SequenceEqual(parameters))
        ?? throw new InvalidOperationException($"{type}.{name}({string.Join(", ", parameters)}) not found");

    // The approval hook sits unconditionally at the very start of the method (Plan()'s own comment explains why), so
    // this no longer depends on the method body's shape at all — only on ClientConnection/NetworkPlayerApproval/
    // BitStream's own fields and methods, which a build that only rewrites uLink_OnPlayerApproval never touches.
    Try("ConnectionAcceptor.uLink_OnPlayerApproval (OnUserApprove site)", () => {
        var approval = Method("ConnectionAcceptor", "uLink_OnPlayerApproval");
        try {
            var napprovalType = RealParams(approval).Single().Type.ToTypeDefOrRef().ResolveTypeDef() ?? throw new InvalidOperationException("Could not resolve uLink.NetworkPlayerApproval");
            var loginDataField = napprovalType.Fields.SingleOrDefault(f => f.Name == "loginData") ?? throw new InvalidOperationException("NetworkPlayerApproval.loginData not found");
            var bitStreamType = loginDataField.FieldType.ToTypeDefOrRef().ResolveTypeDef() ?? throw new InvalidOperationException("Could not resolve uLink.BitStream");
            if (!bitStreamType.Methods.Any(m => m.IsConstructor && !m.IsStatic && RealParams(m).Count() == 2 && RealParams(m).ElementAt(0).Type.FullName == "System.Byte[]" && RealParams(m).ElementAt(1).Type.FullName == "System.Boolean"))
                throw new InvalidOperationException("BitStream(byte[], bool) constructor not found");
            if (!bitStreamType.Methods.Any(m => m.Name == "get__data")) throw new InvalidOperationException("BitStream._data getter not found");
            if (!bitStreamType.Fields.Any(f => f.Name == "isTypeSafe")) throw new InvalidOperationException("BitStream.isTypeSafe not found");
            foreach (var name in new[] { "ReadInt32", "ReadByte", "ReadUInt64", "ReadString", "ReadBytes" })
                if (!bitStreamType.Methods.Any(m => m.Name == name && RealParams(m).Count() == 0)) throw new InvalidOperationException($"BitStream.{name}() not found");
            var ccType = module.Find("ClientConnection", false) ?? throw new InvalidOperationException("ClientConnection not found");
            if (!ccType.Methods.Any(m => m.IsConstructor && !m.IsStatic && RealParams(m).Count() == 0)) throw new InvalidOperationException("ClientConnection() constructor not found");
            foreach (var name in new[] { "Protocol", "ConnectionMode", "UserID", "UserName", "SteamTicket" })
                if (!ccType.Fields.Any(f => f.Name == name)) throw new InvalidOperationException($"ClientConnection.{name} not found");
            return "ConnectionAcceptor.uLink_OnPlayerApproval: OnUserApprove at entry, from our own copy of loginData (works on any build, including one that rewrites the rest of the method)";
        } catch (Exception e) {
            // Only reachable if ClientConnection/NetworkPlayerApproval/BitStream themselves changed shape, not from
            // whatever uLink_OnPlayerApproval's own body does: dump its IL anyway, in case that is ever why.
            throw new InvalidOperationException($"{e.Message}\n    --- {approval.DeclaringType.Name}.{approval.Name} IL ---\n{Dump(approval)}");
        }
    });
    Try("ConnectionAcceptor.uLink_OnPlayerConnected (OnPlayerConnected site)", () => {
        var connected = Method("ConnectionAcceptor", "uLink_OnPlayerConnected");
        connected.Body.SimplifyMacros(connected.Parameters);
        int rets = connected.Body.Instructions.Count(i => i.OpCode == OpCodes.Ret);
        return $"ConnectionAcceptor.uLink_OnPlayerConnected: OnPlayerConnected before {rets} return(s)";
    });
    Try("ConnectionAcceptor.uLink_OnPlayerDisconnected (OnPlayerDisconnected site)", () => { Method("ConnectionAcceptor", "uLink_OnPlayerDisconnected"); return "ConnectionAcceptor.uLink_OnPlayerDisconnected: OnPlayerDisconnected at entry"; });
    Try("chat.say (OnChat site)", () => { Method("chat", "say"); return "chat.say: OnChat at entry (consumes /browserlink)"; });

    const string Info = "uLink.NetworkMessageInfo", Stream = "uLink.BitStream", Rep = "ItemRepresentation";
    void Site(string what, bool atEntry, Func<MethodDef> find) => Try(what, () => {
        var m = find();
        int count = atEntry ? 1 : m.Body.Instructions.Count(i => i.OpCode == OpCodes.Ret);
        if (count == 0) throw new InvalidOperationException($"{m.DeclaringType.Name}.{m.Name} has no return");
        return $"{m.DeclaringType.Name}.{m.Name}: {what} {(atEntry ? "at entry" : $"before {count} return(s)")}";
    });
    Site("OnSlotMoveBefore/After (ITMV)", false, () => Exact("Inventory", "ITMV", "NetEntityID", "System.Byte", "System.Byte", Info));
    Site("OnSlotMoveBefore/After (ITMG)", false, () => Exact("Inventory", "ITMG", "NetEntityID", "System.Byte", "System.Byte", "System.Boolean", Info));
    Site("OnSlotOp (ISMV)", true, () => Exact("Inventory", "ISMV", "System.Byte", "System.Byte", Info));
    Site("OnSlotOp (ITSM)", true, () => Exact("Inventory", "ITSM", "System.Byte", "System.Byte", "System.Boolean", Info));
    Site("OnSlotOp (ITSP)", true, () => Exact("Inventory", "ITSP", "System.Byte", Info));
    Site("OnDropItemAfter", false, () => Exact("DropHelper", "DropItem", "Inventory", "System.Int32", "ItemPickup&"));
    Site("OnDeathDropBefore/After", false, () => Exact("DropHelper", "DropInventoryContents", "Inventory", "Inventory&"));
    Site("OnPickupBefore/After", false, () => Exact("ItemPickup", "PlayerUse", "Controllable"));
    foreach (var weapon in new[] { "BulletWeaponDataBlock", "ShotgunDataBlock", "MeleeWeaponDataBlock", "BowWeaponDataBlock" })
        Site($"OnWeaponAction ({weapon})", true, () => Exact(weapon, "DoAction1", Stream, Rep, Info + "&"));
    Site("OnBulletHit", true, () => Exact("BulletWeaponDataBlock", "ApplyDamage", "UnityEngine.GameObject", "UnityEngine.Transform", "System.Boolean", "UnityEngine.Vector3", "BodyPart", Rep));
    return results;
}

// A readable instruction listing (offset, opcode, a short operand description) for a method we failed to recognise.
// Bounded so one huge method cannot flood a probe's output.
static string Dump(MethodDef method, int max = 250) {
    string Operand(Instruction i) => i.Operand switch {
        null => "",
        Instruction t => $"IL_{t.Offset:x4}",
        IMethod m => $"{(m as IMemberRef)?.DeclaringType?.Name}.{m.Name}",
        IField f => $"{(f as IMemberRef)?.DeclaringType?.Name}.{f.Name}",
        Local v => $"V_{v.Index}",
        Parameter p => p.Name,
        _ => i.Operand.ToString() ?? "",
    };
    var lines = method.Body.Instructions.Take(max).Select(i => $"    IL_{i.Offset:x4} {i.OpCode.Name,-12} {Operand(i)}");
    string s = string.Join("\n", lines);
    return method.Body.Instructions.Count > max ? s + $"\n    … {method.Body.Instructions.Count - max} more instruction(s)" : s;
}

// Inserts `code` before `at`. With retarget, branches and switch tables that jumped to `at` now jump to the new code,
// so every path that reached `at` passes through the hook.
static void Insert(MethodDef method, Instruction at, bool retarget, Func<Instruction[]> code) {
    var instructions = method.Body.Instructions;
    var block = code();
    if (retarget) {
        foreach (var i in instructions) {
            if (i.Operand == at && (i.OpCode.OperandType == OperandType.InlineBrTarget || i.OpCode.OperandType == OperandType.ShortInlineBrTarget)) i.Operand = block[0];
            else if (i.Operand is IList<Instruction> table) for (int k = 0; k < table.Count; k++) if (table[k] == at) table[k] = block[0];
        }
        foreach (var h in method.Body.ExceptionHandlers) {
            if (h.TryEnd == at) h.TryEnd = block[0];
            if (h.HandlerEnd == at) h.HandlerEnd = block[0];
        }
    }
    int idx = instructions.IndexOf(at);
    foreach (var instr in block) instructions.Insert(idx++, instr);
}

// Lists every (method -> hook) call site actually found, and separately every TypeDef whose own metadata couldn't
// be read at all -- a sign the FILE itself is malformed, not that nothing is there (the exact class of problem that
// moved this tool from Mono.Cecil to dnlib: Cecil's writer corrupted a TypeDef's own method-range metadata on at
// least one real-world build). `badTypes` must never be silently swallowed by a caller: a build whose own output we
// can't even read back correctly must never be treated as "patched".
static (List<string> sites, List<string> badTypes) Sites(string path) {
    using var module = ModuleDefMD.Load(path);
    var found = new List<string>();
    var bad = new List<string>();
    // Per TYPE as well as per method: one type's own malformed metadata (`.Methods`/`.NestedTypes` throwing) must
    // not hide every other type's hooks, any more than one method's bad IL should (same isolation ProbeSites() and
    // tools/rustuj-probe already use). Queue-based so nested types are covered too, not just module.Types' own
    // top-level list.
    var queue = new Queue<TypeDef>(module.Types);
    while (queue.Count > 0) {
        var type = queue.Dequeue();
        List<MethodDef> methods;
        try { methods = type.Methods.ToList(); }
        catch (Exception e) { bad.Add($"{type.FullName}: {e.GetType().Name}: {e.Message}"); continue; }
        foreach (var m in methods.Where(m => m.HasBody)) {
            CilBody body;
            try { body = m.Body; } catch { continue; } // this one method's IL failing to parse isn't fatal either
            foreach (var i in body.Instructions)
                if (i.OpCode == OpCodes.Call && i.Operand is IMethod r && (r as IMemberRef)?.DeclaringType?.FullName == HooksType)
                    found.Add($"{m.DeclaringType.Name}.{m.Name} → {r.Name}");
        }
        List<TypeDef> nested;
        try { nested = type.HasNestedTypes ? type.NestedTypes.ToList() : new List<TypeDef>(); }
        catch (Exception e) { bad.Add($"{type.FullName} (nested types): {e.GetType().Name}: {e.Message}"); continue; }
        foreach (var n in nested) queue.Enqueue(n);
    }
    return (found.Distinct().ToList(), bad);
}
static bool Patched(string path) => Sites(path).sites.Count > 0;

// dnlib's Importer, given a TypeRef whose AssemblyRef scope has the same simple name as the import target module's
// own assembly (true for every game type the Hooks adapter takes as a parameter -- ConnectionAcceptor,
// BulletWeaponDataBlock, etc. -- since the adapter was built against a copy of this same Assembly-CSharp), writes a
// ModuleRef back to the SOURCE module's own file name instead of recognising the type as already-local. CoreCLR then
// refuses to load that ModuleRef ("only single file assemblies are supported"). Mapping it to the real local TypeDef
// up front sidesteps that path entirely.
sealed class LocalTypeMapper(ModuleDef target) : ImportMapper {
    public override ITypeDefOrRef? Map(ITypeDefOrRef typeDefOrRef) => typeDefOrRef is TypeRef ? target.Find(typeDefOrRef.FullName, false) : null;
}
