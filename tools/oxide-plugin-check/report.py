# Picks the best copy of each plugin (works first, then the newest version, then the most trusted mirror) and writes
# all-files.csv, plugins.csv, plugins.md, a drop-in oxide/plugins folder of every plugin that loads, and the same for
# the plugins picked in shortlist.txt (bundle-shortlist/, shortlist.md).
# Usage: python3 -I report.py <work dir> <plugin source root>
import collections, csv, json, os, re, shutil, subprocess, sys, tempfile

W, SRC = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))
rows = json.load(open(f"{W}/classified.json"))
commits = json.load(open(f"{W}/sources.json"))
RANK = ["works", "loads-with-warnings", "wont-load", "compile-error", "old-oxide-api", "other-game", "missing-dependency", "needs-other-server-mod", "needs-RustExtended"]
# oxidemod.org mirrors first, then the authors' own repositories, then community dumps
MIRRORS = ["Calytic_oxideplugins", "RustServers-IO_oxideplugins", "strykes_Oxide2Plugins", "Crushedice_LatestPlugins", "erikmoch_OxidePlugins", "KichDM_RustLegacyPlugins"]
# Browser players reach the server through our gateway on the same machine, with website (non-Steam) user IDs
STEAM_API = {"FamilyShareBlocker", "VACKicker", "SteamChecks", "SteamGroups", "Autokick", "SteamReport", "EnhancedBanSystem"}
BY_IP = {"Banip", "Banvpn", "CountryBlock", "CountryBlocker", "IPBlacklist", "VPNBlock", "EnhancedBanSystem",
         "Antiflyfall", "AdminCompanion", "ServerTest", "AdminPunishment"}  # the last four ban by IP
# Compile and load, but Oxide for Rust Legacy gives them nothing to do
NO_EFFECT = {"AutoDoors": "only has door code for Rust and Hurtworld: does nothing on Legacy",
             "Rename": "Oxide for Rust Legacy never implemented IPlayer.Rename: does nothing"}
# Misspelled disconnect hooks: the bundle copy is renamed to the hook Oxide calls (same uLink.NetworkPlayer argument)
HOOK_FIXES = {"OnPlayerDisconnect": "OnPlayerDisconnected", "OnPlayerDisconected": "OnPlayerDisconnected"}
for r in rows:
    name = os.path.splitext(r["file"])[0]
    if r["status"] == "works" and name in NO_EFFECT:
        r["status"] = "loads-with-warnings"; r["issues"].append(NO_EFFECT[name])

def version(v): return tuple(int(x) for x in re.findall(r"\d+", (v or "").split('"')[0])[:4])
def mirror(r):
    repo = r["sources"][0].split("/")[0]
    return MIRRORS.index(repo) if repo in MIRRORS else len(MIRRORS)
def url(path):
    repo, rest = path.split("/", 1)
    owner, name = repo.split("_", 1)
    return f"https://github.com/{owner}/{name}/blob/{commits[repo]}/{rest.replace(' ', '%20')}"
def source_text(r): return open(os.path.join(SRC, r["sources"][0]), encoding="utf-8-sig", errors="replace").read()
def fixed_text(r):
    """The plugin with its misspelled disconnect hook renamed, or None when there is nothing to fix."""
    bad = [h for h in r.get("deadHooks", []) if h in HOOK_FIXES]
    text = source_text(r)
    if not bad or re.search(r"\bvoid\s+OnPlayerDisconnected\s*\(", text): return None
    for h in bad: text = re.sub(r"\bvoid\s+" + h + r"\s*\(", "void " + HOOK_FIXES[h] + "(", text)
    return text
def patched_text(r):
    """Our port of a plugin (patches/<file>.diff, made against the LF-normalised source), or None."""
    diff = os.path.join(HERE, "patches", r["file"] + ".diff")
    if not os.path.exists(diff): return None
    with tempfile.TemporaryDirectory() as d:
        open(f"{d}/in.cs", "w", encoding="utf-8").write(source_text(r).replace("\r\n", "\n"))
        p = subprocess.run(["patch", "--quiet", "-o", f"{d}/out.cs", f"{d}/in.cs", diff], capture_output=True, text=True)
        if p.returncode: sys.exit(f"{diff} does not apply: {p.stdout}{p.stderr}")
        return open(f"{d}/out.cs", encoding="utf-8").read()
def browser_note(r):
    name = os.path.splitext(r["file"])[0]
    notes = []
    if name in STEAM_API: notes.append("checks Steam accounts: browser players have website IDs, not Steam IDs")
    if name in BY_IP: notes.append("acts on player IP: every browser player shares the gateway's IP")
    return "; ".join(notes)

groups = collections.defaultdict(list)
for r in rows: groups[os.path.splitext(r["file"])[0].lower()].append(r)
best = []
for g in groups.values():
    g.sort(key=lambda r: (RANK.index(r["status"]), tuple(-x for x in version(r["version"])), mirror(r)))
    best.append(dict(g[0], copies=len(g)))
best.sort(key=lambda r: (RANK.index(r["status"]), r["base"] != "RustLegacyPlugin", (r["title"] or r["file"]).lower()))

FIELDS = ["file", "title", "author", "version", "type", "status", "issues", "browser_players", "first_error", "description", "source"]
def record(r):
    return {"file": r["file"], "title": r["title"], "author": r["author"], "version": (r["version"] or "").split('"')[0],
            "type": "Rust Legacy" if r["base"] == "RustLegacyPlugin" else "Universal", "status": r["status"],
            "issues": " | ".join(r["issues"] + (["bundle copy fixed: disconnect hook renamed to OnPlayerDisconnected"] if fixed_text(r) else [])
                                 + ([f"bundle copy is our port: tools/oxide-plugin-check/patches/{r['file']}.diff"] if os.path.exists(os.path.join(HERE, "patches", r["file"] + ".diff")) else [])), "browser_players": browser_note(r), "first_error": (r["errors"] or [""])[0][-200:],
            "description": (r["description"] or "").strip(), "source": url(r["sources"][0])}
with open(f"{W}/all-files.csv", "w", newline="") as f:
    w = csv.DictWriter(f, FIELDS + ["sha1", "all_sources"]); w.writeheader()
    for r in sorted(rows, key=lambda r: r["file"].lower()):
        w.writerow(dict(record(r), sha1=r["sha"], all_sources=" ; ".join(r["sources"])))
with open(f"{W}/plugins.csv", "w", newline="") as f:
    w = csv.DictWriter(f, FIELDS); w.writeheader()
    for r in best: w.writerow(record(r))

def cell(s): return (s or "").replace("|", "\\|").replace("\n", " ").strip()
with open(f"{W}/plugins.md", "w") as f:
    f.write("# Oxide plugins on our Rust Legacy server: per-plugin results\n\nBest copy of each plugin, written by `tools/oxide-plugin-check/report.py`. Method and caveats: [OXIDE-PLUGINS.md](../../OXIDE-PLUGINS.md).\n")
    for status in RANK:
        group = [r for r in best if r["status"] == status]
        if not group: continue
        f.write(f"\n### {status} ({len(group)})\n\n| Plugin | Author | Version | Type | What it does | Notes |\n|---|---|---|---|---|---|\n")
        for r in group:
            rec = record(r)
            notes = "; ".join(x for x in (rec["issues"], rec["browser_players"]) if x)
            if status not in ("works", "loads-with-warnings", "wont-load"):
                notes = re.sub(r"^.*?error (CS\d+): ", r"\1: ", rec["first_error"])
            f.write(f"| [{cell(r['title'] or r['file'])}]({rec['source']}) | {cell(r['author'])} | {cell(rec['version'])} | {rec['type']} "
                    f"| {cell(rec['description'])[:160]} | {cell(notes)[:220]} |\n")

def write_bundle(folder, picks):
    out = f"{W}/{folder}/oxide/plugins"
    shutil.rmtree(f"{W}/{folder}", ignore_errors=True)
    os.makedirs(out)
    for r in picks:
        renamed = r["status"] == "wont-load" and len(r["issues"]) == 1 and "rename the file" in r["issues"][0]
        ported = patched_text(r)
        if r["status"] not in ("works", "loads-with-warnings") and not renamed and not ported: continue
        target = os.path.join(out, f"{r['class']}.cs" if renamed else r["file"])
        if renamed and os.path.exists(target): continue
        fixed = ported or fixed_text(r)
        if fixed: open(target, "w", encoding="utf-8").write(fixed)
        else: shutil.copy(os.path.join(SRC, r["sources"][0]), target)
        for dep in r["withRequires"]: shutil.copy(os.path.join(SRC, os.path.dirname(r["sources"][0]), dep), os.path.join(out, dep))
    shutil.copy(f"{W}/plugins.csv", f"{W}/{folder}/oxide/PLUGINS-STATUS.csv")
    return out
out = write_bundle("bundle", best)
print(collections.Counter(r["status"] for r in best))
print(len(os.listdir(out)), "plugin files in", out)

# Shortlist: picked plugins plus the plugins they reference that load and are safe for browser players
by_file = {r["file"]: r for r in best}
picks, why = [], {}
for line in open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "shortlist.txt")):
    if not line.strip() or line.startswith("#"): continue
    category, name, reason = (x.strip() for x in line.split("|", 2))
    picks.append(by_file[name]); why[name] = (category, reason)
queue = list(picks)
while queue:
    r = queue.pop(0)
    for ref in re.findall(r"\[PluginReference\][^;]*?Plugin\s+([\w\s,]+);", source_text(r)):
        for dep in (x.strip() for x in ref.split(",")):
            d = by_file.get(dep + ".cs")
            if d and d not in picks and d["status"] in ("works", "loads-with-warnings") and not browser_note(d):
                picks.append(d); queue.append(d); why[d["file"]] = ("Needed by others", f"used by {os.path.splitext(r['file'])[0]}")
out = write_bundle("bundle-shortlist", picks)
# Preset configs (presets/oxide/config, data) go over the bundle so the server starts with our settings.
shutil.copytree(os.path.join(HERE, "presets", "oxide"), f"{W}/bundle-shortlist/oxide", dirs_exist_ok=True)
with open(f"{W}/shortlist.md", "w") as f:
    f.write("# Shortlist: Oxide plugins worth running on our servers\n\nPicked from the plugins that load (`tools/oxide-plugin-check/shortlist.txt`); "
            "plugins they use are added. Method and caveats: [OXIDE-PLUGINS.md](../../OXIDE-PLUGINS.md).\n")
    for category in dict.fromkeys(c for c, _ in why.values()):
        f.write(f"\n### {category}\n\n| Plugin | Author | Why | Watch out |\n|---|---|---|---|\n")
        for r in picks:
            if why[r["file"]][0] != category: continue
            rec = record(r)
            f.write(f"| [{cell(r['title'] or r['file'])}]({rec['source']}) | {cell(r['author'])} | {cell(why[r['file']][1])} "
                    f"| {cell('; '.join(x for x in (rec['issues'], rec['browser_players']) if x))} |\n")
print(len(os.listdir(out)), "plugin files in", out)
