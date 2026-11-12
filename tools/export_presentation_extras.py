"""Static export of small presentation data the other exporters skip (data bundles only; no target code is loaded or run).

- HeldItemDataBlock.deploySound per item (HeldItem.CreateViewModel plays it with the deploy animation).
- ExplosionEffect (Explosion1): initialLightIntensity and the Light it drives (myLight), so the flash fades like Update.
- QuickLight (MetalImpact): duration and the Light it shrinks.
- TorchItemRep.StrikeSound (flare.irp): RepIgnite plays it at a remote player's flare.
Prefab keys match the deployables manifest ('obj:' + identity of the root GameObject); item keys match the items manifest.
"""
import json,collections,os
from pathlib import Path
from unity_common import ROOT,Bundles,identity,token

DIRS=[ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data',ROOT/'analysis/world-source/bundles']
# RLB_EXPORT_OUT: write somewhere else first (e.g. to compare with the shared private copy before replacing it).
OUT=Path(os.environ['RLB_EXPORT_OUT']) if os.environ.get('RLB_EXPORT_OUT') else ROOT/'browser/assets/recovered/presentation'
OUT.mkdir(parents=True,exist_ok=True)
for old in OUT.iterdir():
    if old.is_file():old.unlink()
b=Bundles(DIRS,['gameobject.000.unity3d','gameobject.001.unity3d','scriptableobject.000.unity3d','sharedassets0.assets'])
# Uber Hatchet / Uber Hunting Bow datablocks (cab-datablock.000): their own deploySound plays with the view model too.
b.load(b.find('datablock.000.unity3d'))
items=json.loads((ROOT/'browser/assets/recovered/items/manifest.json').read_text())['items']
issues=collections.Counter();sounds={}

def sound(owner,ptr):
    """One AudioClip, written once as sound-<token(identity)>.<ext> (the deployables exporter's naming)."""
    if not ptr or not ptr.get('m_PathID'):return None
    obj=b.resolve(owner,ptr)
    if obj is None:issues['missing audio clip']+=1;return None
    key=identity(obj)
    if key not in sounds:
        clip=obj.read();(name,data),=clip.samples.items()
        filename='sound-'+token(key)+'.'+name.rsplit('.',1)[-1];(OUT/filename).write_bytes(data);sounds[key]={'file':filename,'name':clip.m_Name}
    return sounds[key]['file']

def root_key(obj,d):
    """'obj:' + identity of the prefab root GameObject that owns component `obj`."""
    go=b.resolve(obj.assets_file,d['m_GameObject'])
    while True:
        t=b.components(go.assets_file,go.read_typetree())['Transform'][0].read_typetree()
        if not t['m_Father']['m_PathID']:return 'obj:'+identity(go),go
        go=b.resolve(go.assets_file,b.resolve(go.assets_file,t['m_Father']).read_typetree()['m_GameObject'])

def light(owner,ptr):
    """The Light component a script field points to, with its GameObject's name."""
    o=b.resolve(owner,ptr) if ptr and ptr.get('m_PathID') else None
    if o is None:return None
    d=o.read_typetree();go=b.resolve(o.assets_file,d['m_GameObject']).read_typetree()
    return {'node':go['m_Name'],'intensity':d['m_Intensity'],'range':d['m_Range']}

held={};effects={};reps={}
by_uid={}
for a in list(b.assets.values()):
    for o in a.objects.values():
        if o.type.name!='MonoBehaviour':continue
        try:d=o.read_typetree()
        except Exception:continue
        if '_uniqueID' in d:by_uid[d['_uniqueID']]=(o,d);continue
        if not d.get('m_GameObject',{}).get('m_PathID'):continue
        script=b.script(o,d)
        if script=='ExplosionEffect':
            key,go=root_key(o,d);effects[key]={'prefab':go.read_typetree()['m_Name'],'script':script,'initialLightIntensity':d['initialLightIntensity'],'light':light(o.assets_file,d['myLight'])}
        elif script=='QuickLight':
            # QuickLight.Update shrinks the Light's own range (its `range` field is never read).
            key,go=root_key(o,d);own=b.components(o.assets_file,b.resolve(o.assets_file,d['m_GameObject']).read_typetree()).get('Light',[None])[0]
            effects[key]={'prefab':go.read_typetree()['m_Name'],'script':script,'duration':d['duration'],'light':light(own.assets_file,{'m_FileID':0,'m_PathID':own.path_id}) if own else None}
        elif script=='TorchItemRep':
            key,go=root_key(o,d);reps[key]={'prefab':go.read_typetree()['m_Name'],'StrikeSound':sound(o.assets_file,d.get('StrikeSound'))}
for key,item in items.items():
    o,d=by_uid.get(item['data']['_uniqueID'],(None,None))
    if o is None or 'deploySound' not in d:continue
    s=sound(o.assets_file,d['deploySound'])
    if s:held[key]={'item':d['m_Name'],'deploySound':s}
manifest={'held':held,'effects':effects,'reps':reps,'sounds':sounds,'summary':dict(issues)}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=1))
print(json.dumps({'held':{v['item']:sounds_name for v in held.values() for sounds_name in [next(s['name'] for s in sounds.values() if s['file']==v['deploySound'])]},'effects':effects,'reps':reps,'issues':dict(issues)},indent=1))
