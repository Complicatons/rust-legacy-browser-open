"""Static, data-only census of the client's shipped prefabs and which of them the game can actually reach.

A prefab (root GameObject in gameobject.000/001) counts as used when something reaches it:
  - a PPtr from a scene object, a ScriptableObject (datablocks, traits, loot lists) or another used prefab, or
  - a serialized string naming it (datablock prefab names such as DeployableObjectPrefabName), or
  - a string literal in the decompiled client/server C# naming it (NetCull/Bundling loads by name).
Reads data with UnityPy; no target code is loaded. Writes analysis/port-coverage/prefab-usage.json.

Usage: python tools/probe_prefab_usage.py [repo-root-with-analysis]
"""
from pathlib import Path
import sys, json, re, collections
ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/python'))
import UnityPy

SRC = ROOT / 'analysis/client-source'
files = sorted((SRC / 'bundles').glob('*.unity3d')) + [p for p in sorted((SRC / 'data').iterdir()) if p.is_file()]
assets = {}
for f in files:
    for a in UnityPy.load(str(f)).assets: assets[a.name.lower()] = a

def target(asset, fid, pid):
    if not pid: return None
    a = asset if fid == 0 else assets.get(asset.externals[fid - 1].path.lower().split('/')[-1])
    return a.objects.get(pid) if a else None

PREFAB_FILES = {k for k in assets if k.startswith('cab-gameobject') or 'gameobject' in k}
# root of every GameObject in the prefab bundles
go_root = {}      # (asset, pid) of GameObject -> root key
comp_go = {}      # (asset, pid) of component -> (asset, pid) of its GameObject
roots = {}        # root key -> {name, file, scripts}
for an in PREFAB_FILES:
    a = assets[an]
    trs = {}
    for pid, o in a.objects.items():
        if o.type.name in ('Transform', 'RectTransform'):
            t = o.read(); trs[pid] = (t.m_GameObject.m_PathID, t.m_Father.m_PathID if t.m_Father else 0)
    tr_of_go = {g: pid for pid, (g, _) in trs.items()}
    def root_tr(pid):
        for _ in range(128):
            f = trs[pid][1]
            if not f or f not in trs: return pid
            pid = f
        return pid
    for pid, o in a.objects.items():
        if o.type.name != 'GameObject': continue
        g = o.read()
        rt = root_tr(tr_of_go[pid]) if pid in tr_of_go else None
        rkey = (an, trs[rt][0] if rt else pid)
        go_root[(an, pid)] = rkey
        for c in g.m_Component:
            p = c[1] if isinstance(c, tuple) else c
            if p.m_FileID == 0: comp_go[(an, p.m_PathID)] = (an, pid)
    for (fa, gp), rk in list(go_root.items()):
        if fa == an and rk not in roots:
            roots[rk] = {'name': a.objects[rk[1]].read().m_Name, 'file': an, 'scripts': collections.Counter()}

def root_of(o):
    k = (o.assets_file.name.lower(), o.path_id)
    if k in go_root: return go_root[k]
    if k in comp_go: return go_root.get(comp_go[k])
    return None

def walk(v, out_ptrs, out_strs):
    if isinstance(v, dict):
        if 'm_PathID' in v and 'm_FileID' in v: out_ptrs.append((v['m_FileID'], v['m_PathID'])); return
        for x in v.values(): walk(x, out_ptrs, out_strs)
    elif isinstance(v, list):
        for x in v: walk(x, out_ptrs, out_strs)
    elif isinstance(v, str) and 2 < len(v) < 128: out_strs.append(v)

edges = collections.defaultdict(set)   # source key -> set(root keys)
named = collections.defaultdict(set)   # source key -> set(strings)
name_index = collections.defaultdict(list)
for rk, r in roots.items(): name_index[r['name'].lower()].append(rk)
# bundle container paths are the names Bundling/NGC load by; NGC handles (";name") map onto them
by_path = {}
for f in files:
    if 'gameobject' not in f.name: continue
    env = UnityPy.load(str(f))
    for path, ptr in [kv for sf in env.assets for kv in sf.container.items()]:
        try: o = ptr.deref() if hasattr(ptr, 'deref') else ptr
        except Exception: continue
        if getattr(o, 'type', None) and o.type.name == 'GameObject':
            rk = go_root.get((o.assets_file.name.lower(), o.path_id))
            if rk:
                by_path[path.lower()] = rk
                for alias in (path.lower(), path.lower().split('/')[-1]):
                    if rk not in name_index[alias]: name_index[alias].append(rk)
ngc_handles = {}
reg = ROOT / 'browser/assets/recovered/ngc/registry.json'
if reg.exists():
    for e in json.loads(reg.read_text(encoding='utf-8'))['prefabs']:
        rk = by_path.get(e['path'].lower())
        if rk:
            ngc_handles[rk] = e['handle']
            h = e['handle'].lower().lstrip(';')
            if rk not in name_index[h]: name_index[h].append(rk)
clip_refs = collections.defaultdict(set)   # AudioClip identity -> sources (prefab root key or ('asset', file))
SOURCE_TYPES = {'MonoBehaviour', 'Animation', 'AudioSource', 'ParticleSystem', 'ParticleEmitter', 'MeshRenderer', 'SkinnedMeshRenderer'}
for an, a in assets.items():
    for pid, o in a.objects.items():
        if o.type.name != 'MonoBehaviour': continue
        try: tree = o.read_typetree()
        except Exception: continue
        ptrs, strs = [], []
        walk(tree, ptrs, strs)
        src = root_of(o)
        skey = src if src else ('asset', an)
        if src and o.type.name == 'MonoBehaviour':
            try:
                sp = tree.get('m_Script'); so = target(o.assets_file, sp['m_FileID'], sp['m_PathID'])
                if so: roots[src]['scripts'][so.read().m_ClassName] += 1
            except Exception: pass
        for fid, p in ptrs:
            t = target(o.assets_file, fid, p)
            if t is None: continue
            if t.type.name == 'AudioClip': clip_refs[(t.assets_file.name.lower(), t.path_id)].add(skey)
            r = root_of(t)
            if r and r != src: edges[skey].add(r)
        for s in strs:
            for k in (s.lower().lstrip(':;!'), s.lower().lstrip(':;!').split('/')[-1]):
                if k in name_index: named[skey].add(k)

# string literals in decompiled C# (prefab names passed to NetCull/Bundling/Resources loads)
literals = collections.Counter()
for side in ('client', 'server'):
    for cs in (ROOT / 'analysis/decompiled' / side).rglob('*.cs'):
        for m in re.finditer(r'"([^"\\]{2,96})"', cs.read_text(encoding='utf-8', errors='replace')):
            for k in (m.group(1).lower().lstrip(':;!'), m.group(1).lower().lstrip(':;!').split('/')[-1]):
                if k in name_index: literals[k] += 1

# reachability: scenes, every ScriptableObject/asset-level behaviour, and C# literals are roots
reached = {}
queue = []
def mark(rk, why):
    if rk not in reached: reached[rk] = why; queue.append(rk)
for skey, targets in edges.items():
    if skey[0] == 'asset' or not skey[0].startswith('cab-gameobject') and skey not in roots:
        for t in targets: mark(t, 'referenced by ' + (skey[1] if skey[0] == 'asset' else str(skey)))
for skey, names in named.items():
    if skey[0] == 'asset':
        for n in names:
            for rk in name_index[n]: mark(rk, 'named by data in ' + skey[1])
for n in literals:
    for rk in name_index[n]: mark(rk, 'named in decompiled C#')
for rk, h in ngc_handles.items(): mark(rk, 'NGC registry ' + h + ' (server-instantiable)')
# the server build spawns prefabs from its own data (spawn lists, scene spawners): names and PPtrs to its own copies
SERVER = ROOT / 'analysis/world-source/bundles'
if SERVER.exists():
    sassets = {}
    spaths = {}
    for f in sorted(SERVER.iterdir()):
        if not f.is_file() or f.suffix == '.txt': continue
        env = UnityPy.load(str(f))
        for a in env.assets: sassets[a.name.lower()] = a
        if 'gameobject' in f.name:
            for path, ptr in [kv for sf in env.assets for kv in sf.container.items()]:
                try: o = ptr.deref() if hasattr(ptr, 'deref') else ptr
                except Exception: continue
                if getattr(o, 'type', None) and o.type.name == 'GameObject': spaths[(o.assets_file.name.lower(), o.path_id)] = path.lower()
    for an, a in sassets.items():
        if 'gameobject' in an: continue   # prefabs only count when the server's scenes or data reach them
        for pid, o in a.objects.items():
            if o.type.name != 'MonoBehaviour': continue
            try: tree = o.read_typetree()
            except Exception: continue
            ptrs, strs = [], []
            walk(tree, ptrs, strs)
            for s_ in strs:
                for k in (s_.lower().lstrip(':;!'), s_.lower().lstrip(':;!').split('/')[-1]):
                    for rk in name_index.get(k, ()): mark(rk, 'named by server data (' + an + ')')
            for fid, p in ptrs:
                try:
                    ta = a if fid == 0 else sassets.get(a.externals[fid - 1].path.lower().split('/')[-1])
                    t = ta.objects.get(p) if ta else None
                except Exception: t = None
                if t is None: continue
                if t.type.name != 'GameObject':
                    # a component of a server prefab (e.g. LootableObjectSpawner chances point at LootableObject)
                    try:
                        g = t.read().m_GameObject
                        t = t.assets_file.objects.get(g.m_PathID) if g.m_FileID == 0 else None
                    except Exception: t = None
                    if t is None: continue
                path = spaths.get((t.assets_file.name.lower(), t.path_id))
                if path and path in by_path: mark(by_path[path], 'referenced by server data (' + an + ')')
while queue:
    rk = queue.pop()
    for t in edges.get(rk, ()): mark(t, 'referenced by prefab ' + roots[rk]['name'])
    for n in named.get(rk, ()):
        for t in name_index[n]: mark(t, 'named by prefab ' + roots[rk]['name'])

# AudioSource components reference clips directly (not through MonoBehaviour fields)
for an, a in assets.items():
    for pid, o in a.objects.items():
        if o.type.name != 'AudioSource': continue
        try: c = o.read().m_audioClip
        except Exception: continue
        if not c or not c.m_PathID: continue
        t = target(a, c.m_FileID, c.m_PathID)
        if t is not None: clip_refs[(t.assets_file.name.lower(), t.path_id)].add(root_of(o) or ('asset', an))
import hashlib
clips = []
for an, a in assets.items():
    for pid, o in a.objects.items():
        if o.type.name != 'AudioClip': continue
        ident = an + ':' + str(pid)
        srcs = clip_refs.get((an, pid), set())
        live = sorted({(roots[s]['name'] if s in roots else s[1]) for s in srcs if s not in roots or s in reached})
        clips.append({'identity': ident, 'name': o.read().m_Name, 'token': hashlib.sha256(ident.encode()).hexdigest()[:20],
                      'usedBy': live[:8], 'deadOnly': bool(srcs) and not live})
out = {'source': 'analysis/client-source, UnityPy data-only + string literals in analysis/decompiled',
       'prefabs': sorted(({'name': r['name'], 'file': r['file'], 'pathID': rk[1], 'reached': reached.get(rk), 'ngc': ngc_handles.get(rk),
                           'paths': sorted(p for p, r in by_path.items() if r == rk),
                           'scripts': dict(r['scripts'])} for rk, r in roots.items()), key=lambda x: x['name'].lower()),
       'audioClips': sorted(clips, key=lambda c: c['name'].lower())}
dst = ROOT / 'analysis/port-coverage/prefab-usage.json'
dst.parent.mkdir(parents=True, exist_ok=True)
dst.write_text(json.dumps(out, indent=1))
print(len(roots), 'prefab roots;', sum(1 for r in out['prefabs'] if r['reached']), 'reached ->', dst)
