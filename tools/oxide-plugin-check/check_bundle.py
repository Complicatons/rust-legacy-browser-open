# Compiles a bundle's plugins together (as Oxide may batch them) against our Oxide build, then checks each plugin class
# as classify.py does: Oxide's sandbox and hook methods Oxide for Rust Legacy never calls. Catches what a patch, a hook
# rename or two plugins side by side break.
# Usage: python3 -I check_bundle.py <work dir> <bundle oxide/plugins folder>
import glob, json, os, re, subprocess, sys

W, PLUGINS = sys.argv[1], sys.argv[2]
hooks = json.load(open(f"{W}/hooks.json"))
known = set(hooks["opj"]) | set(hooks["code"])
refs = [f"{W}/runtime/{n}.dll" for n in ("mscorlib", "System", "System.Core", "System.Data")] + \
       [f"{W}/out/{n}.dll" for n in ("Oxide.Core", "Oxide.CSharp", "Oxide.Unity", "Oxide.RustLegacy", "Oxide.MySql", "Oxide.SQLite")] + \
       [f"{W}/refs/{n}.dll" for n in ("Newtonsoft.Json", "protobuf-net", "MySql.Data", "System.Data.SQLite")] + \
       sorted(glob.glob(f"{W}/game/*.dll")) + sorted(glob.glob(f"{W}/game-extra/*.dll"))  # every "// Reference:" target
files = sorted(glob.glob(f"{PLUGINS}/*.cs"))
out = f"{W}/bundle-check.dll"
p = subprocess.run(["mcs", "-target:library", "-nostdlib", "-noconfig", "-define:RUSTLEGACY", "-nowarn:0618,0612,0414,0169,0649,0219,0168,0162,0067,0108,0114",
                    "-out:" + out] + ["-r:" + r for r in refs] + files, capture_output=True, text=True)
errors = [l for l in (p.stdout + p.stderr).splitlines() if "error CS" in l]
if p.returncode or errors: sys.exit("bundle does not compile:\n" + "\n".join(errors[:20]))
names = [os.path.basename(f)[:-3].replace("_", "") for f in files]
info = json.loads(subprocess.run(["dotnet", f"{W}/bin/inspect/inspect.dll", out] + names, capture_output=True, text=True, check=True).stdout)
texts = {os.path.basename(f)[:-3]: open(f, encoding="utf-8-sig", errors="replace").read() for f in files}
inter = set()
for t in texts.values(): inter |= set(re.findall(r'(?:CallHook|\.Call|Interface\.Call)\(\s*"(\w+)"', t))
problems = 0
for name in names:
    cls = info["classes"].get(name)
    if not cls: print(f"{name}: no plugin class named after the file"); problems += 1; continue
    text = next(t for n, t in texts.items() if n.replace("_", "") == name)
    dead = [m for m in cls["methods"] if re.match(r"^(On|Can|Modify)[A-Z]", m) and m not in known and m not in inter and len(re.findall(r"\b" + m + r"\b", text)) == 1]
    if dead: print(f"{name}: hooks never called: {', '.join(dead)}")
for b in info["blocked"]: print(f"sandbox: {b['method']} uses {b['uses']}"); problems += 1
print(f"{len(files)} plugins compile together; {problems} load problems")
