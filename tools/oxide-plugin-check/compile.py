# Compiles every corpus plugin the way Oxide 2.0 for Rust Legacy (final build, March 2018) does: one assembly per
# plugin plus its "// Requires:" plugins; references = Oxide's DefaultReferences, every loaded extension assembly and
# the assemblies it references, "// Reference:" and "using Oxide.X.Y" assemblies plus the assemblies those reference
# (Compilation.AddReference, one level); "#define RUSTLEGACY" as Compilation.CacheScriptLines adds. Each compiled
# plugin is then read (never loaded) by inspect/ for Oxide's sandbox and its plugin class.
# Usage: python3 -I compile.py <work dir> <plugin source root>
import json, os, re, shutil, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

W, SRC = sys.argv[1], sys.argv[2]
corpus = json.load(open(f"{W}/corpus.json"))
# Stand-in for the server's Managed folder, where Oxide looks up referenced assemblies
MANAGED = [f"{W}/{d}" for d in ("game", "game-extra", "runtime", "out", "refs")]
REQUIRES = re.compile(r"^//\s*Requires:\s*(\S+?)(?:\.cs)?\s*$", re.M | re.I)
REFERENCE = re.compile(r"^//\s*Reference:\s*(\S+)\s*$", re.M | re.I)
USING = re.compile(r"^\s*using\s+(Oxide\.(?:Core|Ext|Game)\.(?:[^\.;\s]+))[^;]*;", re.M | re.I)
_refs = {}

def assembly_refs(path):
    if path not in _refs:
        out = subprocess.run(["ikdasm", "--assemblyref", path], capture_output=True, text=True).stdout
        _refs[path] = re.findall(r"Name=(\S+)", out)
    return _refs[path]

def locate(name):
    return next((f"{d}/{name}.dll" for d in MANAGED if os.path.exists(f"{d}/{name}.dll")), None)

def add_reference(refs, name, missing):
    hit = locate(name)
    if not hit:
        missing.append(name)
        return
    for path in [hit] + [locate(r) for r in assembly_refs(hit) if not r.startswith(("Newtonsoft.Json", "Rust.Workshop"))]:
        if path and path not in refs: refs.append(path)

BASE = [locate(n) for n in ("mscorlib", "System", "System.Core", "System.Data", "Oxide.Core", "Oxide.CSharp", "Oxide.Unity",
        "Oxide.RustLegacy", "Oxide.MySql", "Oxide.SQLite", "Newtonsoft.Json", "protobuf-net", "MySql.Data", "System.Data.SQLite",
        "Assembly-CSharp", "Facepunch.ID", "uLink", "UnityEngine")]
assert all(BASE), "missing base reference"

def read(path): return open(path, encoding="utf-8", errors="replace").read()

def run(row):
    wd = f"{W}/work/{row['sha'][:12]}"
    shutil.rmtree(wd, ignore_errors=True)
    os.makedirs(wd)
    first = os.path.join(SRC, row["sources"][0])
    files, missing_requires, queue = [first], [], list(row["requires"])
    while queue:
        dep = os.path.join(os.path.dirname(first), queue.pop(0) + ".cs")
        if not os.path.exists(dep): missing_requires.append(os.path.basename(dep)); continue
        if dep in files: continue
        files.append(dep)
        queue += REQUIRES.findall(read(dep))
    refs, missing_refs = list(BASE), []
    for path in files:
        text = read(path)
        for name in REFERENCE.findall(text):
            name = name[:-4] if name.lower().endswith(".dll") else name
            if not name.startswith(("Oxide.", "Newtonsoft.Json", "Rust.Workshop")):  # Oxide ignores these
                add_reference(refs, name, missing_refs)
        for name in USING.findall(text):
            short = re.sub(r"Oxide\.\w+\.(\w+)", r"Oxide.\1", name)
            add_reference(refs, short if locate(short) else name, [])
    local = []
    for path in files:
        shutil.copy(path, wd)
        local.append(os.path.join(wd, os.path.basename(path)))
    out = f"{wd}/plugin.dll"
    cmd = ["mcs", "-target:library", "-nostdlib", "-noconfig", "-define:RUSTLEGACY",
           "-nowarn:0618,0612,0414,0169,0649,0219,0168,0162,0067,0108,0114", "-out:" + out] + ["-r:" + r for r in refs] + local
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    errors = [l.replace(wd + "/", "") for l in (p.stdout + p.stderr).splitlines() if "error CS" in l]
    res = {"sha": row["sha"], "compiled": p.returncode == 0 and os.path.exists(out), "errors": errors,
           "missingRequires": missing_requires, "missingReferences": missing_refs, "withRequires": [os.path.basename(f) for f in files[1:]]}
    if res["compiled"]:
        names = [os.path.basename(f)[:-3].replace("_", "") for f in files]
        q = subprocess.run(["dotnet", f"{W}/bin/inspect/inspect.dll", out] + names, capture_output=True, text=True)
        res["inspect"] = json.loads(q.stdout) if q.returncode == 0 else {"error": q.stderr[-500:]}
    return res

with ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as ex:
    results = list(ex.map(run, corpus))
json.dump(results, open(f"{W}/results.json", "w"), indent=1)
print(sum(r["compiled"] for r in results), "of", len(results), "compiled")
