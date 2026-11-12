"""Static Unity data inspection; does not load or execute game assemblies."""
from pathlib import Path
import sys, json, collections

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/python'))
import UnityPy

def shape(value, depth=0):
    if depth > 4:
        return type(value).__name__
    if isinstance(value, dict):
        return {k: shape(v, depth+1) for k, v in value.items()}
    if isinstance(value, (list, tuple, bytes, bytearray)):
        return {'length':len(value), 'first':shape(value[0], depth+1) if value else None}
    return value

out = ROOT / 'analysis/world-inspection'
out.mkdir(parents=True, exist_ok=True)
for filename in sys.argv[1:] or ['terraindata.000.unity3d','scenes.unity3d']:
    path = ROOT / 'analysis/world-source/bundles' / filename
    env = UnityPy.load(str(path))
    counts = collections.Counter(obj.type.name for obj in env.objects)
    print(filename, dict(counts), flush=True)
    report = {'file':filename,'counts':dict(counts),'objects':[]}
    for obj in env.objects:
        if obj.type.name in ('TerrainData','Terrain','GameObject','Transform'):
            try:
                data = obj.read_typetree()
                item = {'path_id':obj.path_id,'type':obj.type.name,'shape':shape(data)}
                if obj.type.name == 'TerrainData':
                    print(json.dumps(item)[:18000], flush=True)
                report['objects'].append(item)
            except Exception as exc:
                report['objects'].append({'path_id':obj.path_id,'type':obj.type.name,'error':str(exc)})
    (out / (filename + '.json')).write_text(json.dumps(report, indent=2), encoding='utf-8')
