"""Read scene interaction metadata without executing game code."""
from pathlib import Path
import sys,json,collections
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'.tools/python'))
import UnityPy
SOURCE=ROOT/'analysis/world-source/bundles'
assets={}
for filename in ['scenes.unity3d','sharedassets0.assets']:
    for a in UnityPy.load(str(SOURCE/filename)).assets:assets[a.name.lower()]=a
scene=assets['buildplayer-rust_island_2013'];counts=collections.Counter();records=[]
for o in scene.objects.values():
    if o.type.name!='MonoBehaviour':continue
    d=o.read_typetree();ptr=d['m_Script']
    try:
        a=scene if ptr['m_FileID']==0 else assets[scene.externals[ptr['m_FileID']-1].path.lower().split('/')[-1]]
        kind=a.objects[ptr['m_PathID']].read_typetree()['m_ClassName']
    except Exception:kind='unresolved'
    counts[kind]+=1
    if kind in ['MovingDoor','Useable','Contextual','ResourceTarget','GenericSpawner','LootableObjectSpawner','LootableObject','ResourceObject','SlowSpawn']:
        records.append({'pathID':o.path_id,'class':kind,'data':d})
out=ROOT/'analysis/scene-interactions.json';out.write_text(json.dumps({'counts':dict(counts),'records':records},indent=2),encoding='utf-8')
print(dict(counts))
for r in records[:10]:print(r['pathID'],r['class'],json.dumps(r['data'])[:2400])
