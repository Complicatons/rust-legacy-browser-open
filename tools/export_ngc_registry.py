"""Exports the NGC entity registry the gateway needs to decode Rust Legacy's NGC traffic (GAMEPLAY-PROTOCOL.md).

Static only: reads the server's ngcconfiguration/gameobject bundles with UnityPy and the decompiled server
Assembly-CSharp text. For each NGCConfiguration entry: name (";"-prefixed handle), content path, prefab index
(NGCConfiguration.PrefabEntry.hash: MurmurHash2 over the reordered guid words, seed 2260766486), the NGCView
`scripts` in serialized order, and the message table NGC.Prefab.Installation.Create builds: per script, instance
methods with [RPC] (unless [NGCRPCSkip] without [NGCRPC]) or [NGCRPC], including non-private inherited ones,
sorted by name with String.CompareTo (culture). Output: browser/assets/recovered/ngc/registry.json (ignored).
"""
import json, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from unity_common import ROOT, Bundles

SERVER = ROOT / 'analysis/world-source/bundles'
SOURCE = ROOT / 'analysis/decompiled/server/Assembly-CSharp'
OUT = ROOT / 'browser/assets/recovered/ngc/registry.json'
M = 1540483477

def murmur2_ints(words, seed):
    h = (seed ^ (len(words) * 4)) & 0xffffffff
    for w in words:
        k = (w & 0xffffffff) * M & 0xffffffff
        k ^= k >> 24
        k = k * M & 0xffffffff
        h = h * M & 0xffffffff
        h ^= k
    h ^= h >> 13
    h = h * M & 0xffffffff
    h ^= h >> 15
    return h - (1 << 32) if h & 0x80000000 else h

def prefab_hash(guid):
    if not guid: return 0
    ints, start = [], len(guid)
    while start >= 8:
        start -= 8
        ints.append(int(guid[start:start + 8], 16))
    if start > 0: ints.append(int(guid[:start], 16))
    n = (ints + [0] * 6)[:6]
    return murmur2_ints([n[0], n[5], n[4], n[2], n[3], n[1]], 2260766486)

# --- RPC methods per class from the decompiled source (one top-level type per file) ---
method_re = re.compile(r'((?:\s*\[[^\]]+\])+)\s*\n\s*((?:(?:public|private|protected|internal|static|virtual|override|new|sealed|abstract)\s+)*)[\w.<>\[\],]+\s+(\w+)\s*\(([^)]*)\)')
classes = {}
for f in SOURCE.rglob('*.cs'):
    text = f.read_text(encoding='utf-8', errors='replace')
    m = re.search(r'\b(?:class)\s+(\w+)(?:\s*:\s*([\w.]+))?', text)
    if not m or m.group(1) != f.stem: continue
    methods = []
    for mm in method_re.finditer(text):
        attrs, mods, name, params = mm.groups()
        rpc, ngcrpc, skip = '[RPC]' in attrs, 'NGCRPC]' in attrs or 'NGCRPC(' in attrs, 'NGCRPCSkip' in attrs
        if 'static' in mods or not (rpc or ngcrpc): continue
        if rpc and skip and not ngcrpc: continue
        wire = [re.sub(r'\s+\w+$', '', p.strip()) for p in params.split(',') if p.strip() and 'NetworkMessageInfo' not in p]
        methods.append({'name': name, 'params': wire, 'private': 'private' in mods or not mods.strip(), 'info': 'NetworkMessageInfo' in params})
    classes[f.stem] = {'base': (m.group(2) or '').split('.')[-1], 'methods': methods}

def collect(cls):
    out, seen, own = [], set(), True
    while cls in classes:
        for meth in classes[cls]['methods']:
            if not own and meth['private']: continue
            if meth['name'] in seen: continue
            seen.add(meth['name']); out.append({**meth, 'declaredIn': cls})
        cls, own = classes[cls]['base'], False
    return out

def culture_key(name):  # approximation of .NET culture compare for identifiers: case-insensitive, then lower before upper
    return ([(0 if c == '_' else 1, c.lower()) for c in name], [c.isupper() for c in name])

b = Bundles(SERVER, ['ngcconfiguration.000.unity3d', 'gameobject.000.unity3d', 'gameobject.001.unity3d'])
ngc_asset = next(a for n, a in b.assets.items() if n.startswith('cab-ngcconfiguration'))
conf = next(d for o in ngc_asset.objects.values() if o.type.name == 'MonoBehaviour' for d in [o.read_typetree()] if 'entries' in d)
containers = {}
for n, a in b.assets.items():
    for o in a.objects.values():
        if o.type.name == 'AssetBundle':
            for k, v in o.read_typetree()['m_Container']: containers.setdefault(k.lower(), []).append((a, v['asset']))
prefabs, issues = [], []
for e in conf['entries']:
    entry = {'handle': ';' + e['name'], 'path': e['path'], 'index': prefab_hash(e['guidText'])}
    found = containers.get(e['path'].lower())
    if not found:
        issues.append('no container entry for ' + e['path']); prefabs.append(entry); continue
    view = go = None
    for owner, ptr in found:  # several assets share a path; Bundling.Load(path, typeof(NGCView)) picks the NGCView one
        go_obj = b.resolve(owner, ptr)
        if go_obj is None or go_obj.type.name != 'GameObject': continue
        candidate = go_obj.read_typetree()
        comps = b.components(go_obj.assets_file, candidate)
        if 'NGCView' in comps: view, go = comps['NGCView'][0], candidate; break
    if view is None:
        issues.append('no NGCView on ' + e['path']); prefabs.append(entry); continue
    scripts, table, ambiguous = [], [], False
    for i, ptr2 in enumerate(view.read_typetree().get('scripts', [])):
        mb = b.resolve(view.assets_file, ptr2)
        cls = b.script(mb, mb.read_typetree()) if mb else None
        scripts.append(cls)
        methods = collect(cls) if cls else []
        if cls and cls not in classes: issues.append(f'{entry["handle"]}: script {cls} not in decompiled source')
        ordered = sorted(methods, key=lambda m: culture_key(m['name']))
        ambiguous |= [m['name'] for m in ordered] != sorted(m['name'] for m in methods)
        table += [{'id': len(table) + j, 'script': i, 'class': cls, 'name': m['name'], 'params': m['params'], 'declaredIn': m['declaredIn']} for j, m in enumerate(ordered)]
    entry.update({'gameObject': go['m_Name'], 'scripts': scripts, 'messages': table, 'cultureOrderDiffersFromOrdinal': ambiguous})
    prefabs.append(entry)
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({'source': 'server ngcconfiguration.000 + gameobject bundles; decompiled server Assembly-CSharp', 'prefabs': prefabs, 'issues': issues}, indent=1))
print(len(prefabs), 'NGC prefabs;', sum(len(p.get('messages', [])) for p in prefabs), 'messages;', len(issues), 'issues;', sum(p.get('cultureOrderDiffersFromOrdinal', False) for p in prefabs), 'prefabs where culture order differs from ordinal')
for i in issues[:15]: print(' -', i)
