"""Static, data-only census of which client scripts the shipped content references.

Reads every client bundle and loose data file with UnityPy (no target code is loaded) and counts the
MonoBehaviour/ScriptableObject instances per MonoScript, split by source file and by enabled flag.
Writes analysis/port-coverage/script-usage.json for tools/build_port_ledger.mjs.

Usage: python tools/probe_script_usage.py [repo-root-with-analysis]
"""
from pathlib import Path
import sys, json, collections
ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/python'))
import UnityPy

SRC = ROOT / 'analysis/client-source'
files = sorted((SRC / 'bundles').glob('*.unity3d')) + [p for p in sorted((SRC / 'data').iterdir()) if p.is_file()]

scripts = {}      # (assetfile, pathid) -> (assembly, namespace, class)
uses = collections.defaultdict(lambda: {'instances': 0, 'enabled': 0, 'files': collections.Counter()})
envs = []
for f in files:
    env = UnityPy.load(str(f))
    envs.append((f.name, env))
    for a in env.assets:
        for pid, obj in a.objects.items():
            if obj.type.name == 'MonoScript':
                d = obj.read()
                scripts[(a.name.lower(), pid)] = (getattr(d, 'm_AssemblyName', ''), getattr(d, 'm_Namespace', ''), d.m_ClassName)

def resolve(asset, ptr):
    fid, pid = ptr.m_FileID, ptr.m_PathID
    if not pid: return None
    if fid == 0: key = asset.name.lower()
    else: key = asset.externals[fid - 1].path.lower().split('/')[-1]
    return scripts.get((key, pid))

def obj_in(asset, ptr):
    if not ptr.m_PathID: return None
    a = asset if ptr.m_FileID == 0 else assets_by_name.get(asset.externals[ptr.m_FileID - 1].path.lower().split('/')[-1])
    return a.objects.get(ptr.m_PathID) if a else None

assets_by_name = {a.name.lower(): a for _, env in envs for a in env.assets}

def root_name(asset, go_ptr):
    """Name of the top-most GameObject above a component (its prefab or scene root)."""
    try:
        go = obj_in(asset, go_ptr).read()
        tr = None
        for c in go.m_Component:
            o = obj_in(go.assets_file, c[1] if isinstance(c, tuple) else c)
            if o and o.type.name == 'Transform': tr = o.read(); break
        name = go.m_Name
        for _ in range(64):
            if not tr or not tr.m_Father or not tr.m_Father.m_PathID: break
            tr = obj_in(tr.assets_file, tr.m_Father).read()
            name = obj_in(tr.assets_file, tr.m_GameObject).read().m_Name
        return name
    except Exception:
        return None

unresolved = 0
assets_list = []
for name, env in envs:
    for a in env.assets:
        for pid, obj in a.objects.items():
            if obj.type.name != 'MonoBehaviour': continue
            try: d = obj.read()
            except Exception: unresolved += 1; continue
            s = resolve(a, d.m_Script)
            if not s: unresolved += 1; continue
            k = '|'.join(s)
            u = uses[k]; u['instances'] += 1; u['files'][name] += 1
            if getattr(d, 'm_Enabled', 1): u['enabled'] += 1
            go = getattr(d, 'm_GameObject', None)
            if go is not None and go.m_PathID:
                r = root_name(a, go)
                if r: u.setdefault('roots', collections.Counter())[r] += 1
            else:
                u.setdefault('roots', collections.Counter())['<asset> ' + (getattr(d, 'm_Name', '') or '')] += 1
                assets_list.append({'name': getattr(d, 'm_Name', '') or '', 'class': s[2], 'file': name, 'pathID': pid})

out = {
    'source': 'analysis/client-source (bundles + data), UnityPy data-only',
    'monoScripts': sorted({'|'.join(v) for v in scripts.values()}),
    'unresolvedBehaviours': unresolved,
    'assets': sorted(assets_list, key=lambda x: (x['class'], x['name'])),
    'uses': {k: {'instances': v['instances'], 'enabled': v['enabled'], 'files': dict(v['files']),
                 'roots': dict(v.get('roots', collections.Counter()).most_common(12))} for k, v in sorted(uses.items())},
}
dst = ROOT / 'analysis/port-coverage/script-usage.json'
dst.parent.mkdir(parents=True, exist_ok=True)
dst.write_text(json.dumps(out, indent=1))
print(len(out['monoScripts']), 'MonoScripts;', len(out['uses']), 'used;', unresolved, 'unresolved behaviours ->', dst)
