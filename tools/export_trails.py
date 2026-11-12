"""Static export of TrailRenderer components on the weapon projectile prefabs (data bundles only; nothing executes).

tools/export_deployables.py keeps the projectile prefabs (arrowPrefab, tracerPrefab, throwObjectPrefab) but not their
TrailRenderer. The only shipped one is WorldArrow's: ArrowMovement disables it when the arrow impacts.
Unity 4 TrailRenderer fields kept verbatim: m_Time, m_StartWidth, m_EndWidth, m_MinVertexDistance, m_Autodestruct,
m_Colors (five ColorRGBA keys, packed little-endian RGBA bytes) and the material (shader name, _MainTex, _TintColor).
Output: browser/assets/recovered/trails/manifest.json (+ textures). Keys are the deployables manifest prefab keys.
"""
import json
from unity_common import ROOT,Bundles,Writer

CLIENT=[ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data',ROOT/'analysis/world-source/bundles']
OUT=ROOT/'browser/assets/recovered/trails'
OUT.mkdir(parents=True,exist_ok=True)
for old in OUT.iterdir():
    if old.is_file():old.unlink()
b=Bundles(CLIENT,['gameobject.000.unity3d','gameobject.001.unity3d','scriptableobject.000.unity3d','sharedassets0.assets'])
writer=Writer(b,OUT)
deploy=json.loads((ROOT/'browser/assets/recovered/deployables/manifest.json').read_text())
keys=sorted({k for w in deploy['weapons'].values() for k in (w.get('prefabs') or {}).values() if k})

def rgba(packed):
    return {c:((packed>>(8*i))&255)/255 for i,c in enumerate('rgba')}

trails={}
for key in keys:
    prefab=deploy['prefabs'].get(key)
    if not prefab:continue
    asset,pid=prefab['source'].rsplit(':',1);owner=b.asset(asset);root=owner.objects[int(pid)]
    found=[]
    def walk(t,index):
        d=t.read_typetree();go=b.resolve(t.assets_file,d['m_GameObject']);gd=go.read_typetree();cs=b.components(t.assets_file,gd)
        for tr in cs.get('TrailRenderer',[]):
            td=tr.read_typetree();mats=[writer.material(b.resolve(tr.assets_file,p)) for p in td['m_Materials'] if p['m_PathID']]
            found.append({'node':index[0],'name':gd['m_Name'],'enabled':bool(td['m_Enabled']),'materials':mats,'time':td['m_Time'],'startWidth':td['m_StartWidth'],'endWidth':td['m_EndWidth'],
                'minVertexDistance':td['m_MinVertexDistance'],'autodestruct':bool(td['m_Autodestruct']),'colors':[rgba(td['m_Colors'][f'm_Color[{i}]']['rgba']) for i in range(5)],
                'castShadows':bool(td['m_CastShadows']),'receiveShadows':bool(td['m_ReceiveShadows'])})
        index[0]+=1
        for c in d['m_Children']:walk(b.resolve(t.assets_file,c),index)
    walk(b.components(owner,root.read_typetree())['Transform'][0],[0])
    if found:trails[key]={'prefab':prefab['name'],'trails':found}
writer.finish({'trails':trails})
print(json.dumps({k:{'prefab':v['prefab'],'trails':[{x:t[x] for x in ('time','startWidth','endWidth','minVertexDistance','colors','materials')} for t in v['trails']]} for k,v in trails.items()},indent=1))
print(json.dumps(writer.materials,indent=1))
