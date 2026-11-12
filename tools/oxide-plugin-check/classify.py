# Turns compile results into one status per plugin file, following Oxide's own load rules.
# Usage: python3 -I classify.py <work dir> <plugin source root>
import json, os, re, sys, collections

W, SRC = sys.argv[1], sys.argv[2]
corpus = {c["sha"]: c for c in json.load(open(f"{W}/corpus.json"))}
results = {r["sha"]: r for r in json.load(open(f"{W}/results.json"))}
hooks = json.load(open(f"{W}/hooks.json"))
known = set(hooks["opj"]) | set(hooks["code"])
source = {s: open(os.path.join(SRC, c["sources"][0]), encoding="utf-8", errors="replace").read() for s, c in corpus.items()}
# hooks one plugin raises for others (ZoneManager's OnEnterZone and so on) are not dead
inter = set()
for text in source.values(): inter |= set(re.findall(r'(?:CallHook|\.Call|Interface\.Call)\(\s*"(\w+)"', text))
OTHER_GAME = ("BasePlayer", "Item", "BaseOven", "ItemContainer", "BaseEntity", "PlayerLoot", "ItemCategory", "BaseLock",
              "Connection", "ServerUsers", "PlayerSession")
OLD_OXIDE = ("ILivePlayer", "UserData", "Oxide.Ext", "`Ext' does not exist", "ConnectedPlayer", "RustExtension",
             "`RustLegacy' does not exist in the namespace `Oxide'")

rows = []
for sha, c in corpus.items():
    r, text, err = results[sha], source[sha], " ".join(results[sha]["errors"])
    row = dict(c, compiled=r["compiled"], errors=r["errors"][:6], withRequires=r["withRequires"],
               missingRequires=r["missingRequires"], missingReferences=r["missingReferences"], issues=[], deadHooks=[], sandboxBlocked=[])
    if r["compiled"]:
        info = r["inspect"]
        cls = info["classes"].get(os.path.splitext(c["file"])[0].replace("_", ""))
        if not cls:
            row["issues"].append(f"class '{c['class']}' does not match file name '{c['file']}': Oxide won't find the plugin class (rename the file to {c['class']}.cs)")
        elif cls["privateCtor"]:
            row["issues"].append("main class constructor is not public: refused at load")
        if not c["title"]:
            row["issues"].append("no [Info] attribute: refused at load")
        row["sandboxBlocked"] = sorted({f"{b['method'].split('::')[-1]} uses {b['uses'].split('::')[0]}" for b in info["blocked"]})
        if row["sandboxBlocked"]:
            row["issues"].append("Oxide's sandbox replaces these methods with an access error: " + "; ".join(row["sandboxBlocked"]))
        if cls:
            row["deadHooks"] = sorted(m for m in cls["methods"] if re.match(r"^(On|Can|Modify)[A-Z]", m) and m not in known
                                      and m not in inter and len(re.findall(r"\b" + m + r"\b", text)) == 1)
        if row["deadHooks"]:
            row["issues"].append("hooks Oxide for Rust Legacy never calls (that part does nothing): " + ", ".join(row["deadHooks"]))
        refused = any("refused" in i or "won't find" in i for i in row["issues"])
        row["status"] = "wont-load" if refused else "loads-with-warnings" if row["issues"] else "works"
    elif re.search(r"\bRustExtended\b", text) or "RustExtended" in err:
        row["status"] = "needs-RustExtended"
    elif "NBSLegacy" in err:
        row["status"] = "needs-other-server-mod"
    elif any(f"`{n}'" in err for n in OTHER_GAME) or "`Rust' does not exist in the namespace `Oxide.Game'" in err:
        row["status"] = "other-game"
    elif any(n in err for n in OLD_OXIDE):
        row["status"] = "old-oxide-api"
    elif r["missingRequires"]:
        row["status"] = "missing-dependency"
    else:
        row["status"] = "compile-error"
    rows.append(row)
json.dump(rows, open(f"{W}/classified.json", "w"), indent=1)
print(collections.Counter(r["status"] for r in rows))
