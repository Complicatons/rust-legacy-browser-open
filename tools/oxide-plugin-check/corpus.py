# Builds the plugin corpus: every Oxide 2 C# plugin that targets Rust Legacy (RustLegacyPlugin) or is a universal
# Covalence plugin, from the cloned collections. Output: corpus.json (one row per unique file content).
import os, re, json, hashlib, sys
src, out = sys.argv[1], sys.argv[2]
SKIP_REPOS = set()
rows = {}
for repo in sorted(os.listdir(src)):
    if repo in SKIP_REPOS or repo.startswith("full_"): continue
    for root, dirs, files in os.walk(os.path.join(src, repo)):
        dirs[:] = [d for d in dirs if d not in (".git", "bin", "obj")]
        rel = os.path.relpath(root, src)
        if "Fougerite-Plugins" in rel or "Oxide-1.8" in rel or "Servidores Rust LEgacy" in rel: continue
        for f in files:
            if not f.endswith(".cs"): continue
            p = os.path.join(root, f)
            raw = open(p, "rb").read()
            txt = raw.decode("utf-8", "replace")
            m = re.search(r"class\s+(\w+)\s*:\s*(RustLegacyPlugin|CovalencePlugin|CSPlugin|CSharpPlugin)\b", txt)
            if not m: continue
            base = m.group(2)
            meta = {}
            j = p[:-3] + ".json"
            if os.path.exists(j):
                try: meta = json.load(open(j, encoding="utf-8-sig"))
                except Exception: pass
            games = [g.lower() for g in meta.get("games", [])]
            folder = rel.lower()
            if base != "RustLegacyPlugin":
                # universal plugins only when the source or its metadata says they run on Legacy / any game
                if not ("rustlegacy" in games or "universal" in folder): continue
            info = re.search(r'\[Info\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*([^\)\]]*?)\)\s*\]', txt)
            desc = re.search(r'\[Description\(\s*"([^"]*)"', txt)
            sha = hashlib.sha1(raw.replace(b"\r\n", b"\n").strip()).hexdigest()
            row = rows.setdefault(sha, {"sha": sha, "file": f, "class": m.group(1), "base": base,
                "title": info.group(1) if info else None, "author": info.group(2) if info else None,
                "version": info.group(3).strip().strip('"') if info else None,
                "description": (desc.group(1) if desc else None) or meta.get("description"),
                "games": games, "requires": re.findall(r"^//\s*Requires:\s*(\S+?)(?:\.cs)?\s*$", txt, re.M | re.I),
                "references": re.findall(r"^//\s*Reference:\s*(\S+)\s*$", txt, re.M | re.I),
                "sources": []})
            row["sources"].append(os.path.relpath(p, src))
json.dump(sorted(rows.values(), key=lambda r: (r["file"].lower(), r["sha"])), open(out, "w"), indent=1)
print(len(rows), "unique files;", len({r["file"].lower() for r in rows.values()}), "plugin names")
from collections import Counter
print(Counter(r["base"] for r in rows.values()))
print(Counter(s.split("/")[0] for r in rows.values() for s in r["sources"][:1]))
