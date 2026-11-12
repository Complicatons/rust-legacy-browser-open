"""Focused static scene dependency inventory."""
from pathlib import Path
import sys,json,collections
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.tools/python'))
import UnityPy
env=UnityPy.load(str(ROOT/'analysis/world-source/bundles/scenes.unity3d'))
for a in env.assets:
    print('ASSET',a.name,'objects',len(a.objects),'externals',[(i+1,e.path) for i,e in enumerate(a.externals)])
    counts=collections.Counter(o.type.name for o in a.objects.values())
    print(dict(counts))
    for kind in ['MeshFilter','MeshRenderer','MeshCollider','BoxCollider']:
        found=[o for o in a.objects.values() if o.type.name==kind]
        if found: print(kind,found[0].path_id,json.dumps(found[0].read_typetree())[:3500])
    if a.name=='BuildPlayer-rust_island_2013':
        for o in a.objects.values():
            if o.type.name=='MeshRenderer':
                d=o.read_typetree()
                if d['m_Enabled'] and d['m_SubsetIndices']:
                    print('BATCH',o.path_id,json.dumps(d));break
        for o in a.objects.values():
            if o.type.name=='Mesh':
                d=o.read_typetree()
                print('MESH',o.path_id,d['m_Name'],'submeshes',len(d['m_SubMeshes']),str(d['m_SubMeshes'])[:1000]);break
        colliders=[o.read_typetree() for o in a.objects.values() if o.type.name=='MeshCollider']
        print('COLLIDERS',collections.Counter((d['m_Enabled'],d['m_IsTrigger'],bool(d['m_Mesh']['m_PathID'])) for d in colliders))
        print('COLLIDER EXAMPLES',json.dumps([d for d in colliders if d['m_Mesh']['m_PathID']][:2]))
