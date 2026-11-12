# Lists the hook names the final Oxide for Rust Legacy actually calls: the hooks patched into the game by
# RustLegacy.opj, plus every hook name Oxide.Core/CSharp/Unity/RustLegacy call or subscribe to in their source.
# Usage: python3 -I hooks.py <oxide source dir> <out hooks.json>
import json, os, re, sys

oxide, out = sys.argv[1], sys.argv[2]
opj = json.load(open(os.path.join(oxide, "Oxide.RustLegacy/resources/RustLegacy.opj"), encoding="utf-8-sig"))
patched = {h.get("Hook", h)["HookName"] for m in opj["Manifests"] for h in m["Hooks"]}
called = set()
for repo in ("Oxide.RustLegacy/src", "Oxide.Core/Oxide.Core", "Oxide.CSharp/Oxide.CSharp", "Oxide.Unity/Oxide.Unity"):
    for root, _, files in os.walk(os.path.join(oxide, repo)):
        for f in files:
            if not f.endswith(".cs"): continue
            text = open(os.path.join(root, f), encoding="utf-8", errors="replace").read()
            called |= set(re.findall(r'(?:CallHook|Call|CallDeprecatedHook|\bCall<\w+>)\(\s*"(\w+)"', text))
            called |= set(re.findall(r'\[HookMethod\("(\w+)"\)\]', text))
json.dump({"opj": sorted(patched), "code": sorted(called)}, open(out, "w"), indent=1)
print(len(patched), "patched hooks,", len(called - patched), "more called from Oxide source")
