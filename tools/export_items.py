"""Recover item definitions, blueprint pointer links, loadout and original icon images."""
from pathlib import Path
import sys,json,hashlib,math
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'.tools/python'))
import UnityPy
SOURCE=ROOT/'analysis/world-source/bundles';OUT=ROOT/'browser/assets/recovered/items';OUT.mkdir(exist_ok=True)
assets={};sources={};missing=[]
def load(path):
    sources[path.name]=hashlib.sha256(path.read_bytes()).hexdigest()
    for a in UnityPy.load(str(path)).assets:assets[a.name.lower()]=a
for name in ['sharedassets0.assets','scriptableobject.000.unity3d','gameobject.000.unity3d','gameobject.001.unity3d','datablock.000.unity3d']:load(SOURCE/name)
def resolve(owner,p):
    if not p['m_PathID']:return None
    a=owner if not p['m_FileID'] else assets[owner.externals[p['m_FileID']-1].path.lower().split('/')[-1]]
    return a.objects[p['m_PathID']]
def key(o):return o.assets_file.name.lower()+':'+str(o.path_id)
def script(o,d):
    try:return resolve(o.assets_file,d['m_Script']).read_typetree()['m_ClassName']
    except Exception:return ''
def normalize(value):
    if isinstance(value,float) and not math.isfinite(value):return {'$float':str(value)}
    if isinstance(value,dict):return {k:normalize(v) for k,v in value.items()}
    if isinstance(value,list):return [normalize(v) for v in value]
    return value
items={};blueprints={};loadouts={};objects={}
for a in list(assets.values()):
    for o in a.objects.values():
        if o.type.name!='MonoBehaviour':continue
        try:d=o.read_typetree()
        except Exception:continue
        kind=script(o,d)
        if 'datablock' in kind.lower() and '_uniqueID' in d:
            objects[key(o)]=o;items[key(o)]={'source':key(o),'class':kind,'data':normalize(d)}
        if kind=='Loadout':loadouts[key(o)]={'source':key(o),'data':normalize(d)};objects[key(o)]=o
for identity,item in items.items():
    d=item['data'];o=objects[identity]
    if item['class']=='BlueprintDataBlock':
        result=resolve(o.assets_file,d['resultItem'])
        ingredients=[]
        for ingredient in d['ingredients']:
            target=resolve(o.assets_file,ingredient['Ingredient'])
            if key(target) not in items:raise ValueError('Unresolved ingredient '+key(target))
            ingredients.append({'item':key(target),'amount':ingredient['amount']})
        if key(result) not in items:raise ValueError('Unresolved result '+key(result))
        blueprints[identity]={'source':identity,'name':d['m_Name'],'result':key(result),'amount':d['numResultItem'],'ingredients':ingredients,'seconds':d['craftingDuration'],'workbench':bool(d['RequireWorkbench'])}
# Original texture AssetBundle containers map import GUIDs to PPtrs; editorbundle maps paths to GUIDs.
index=json.loads((SOURCE/'editorbundle.txt').read_text())
sources['editorbundle.txt']=hashlib.sha256((SOURCE/'editorbundle.txt').read_bytes()).hexdigest()
icons={};needed={i['data'].get('icon') for i in items.values()}
for bundle_name,entries in index.items():
    selected={p:g for p,g in entries.items() if p in needed}
    if not selected:continue
    path=SOURCE/(bundle_name+'.unity3d')
    if not path.exists():missing.extend(selected);continue
    load(path);a=assets['cab-'+bundle_name]
    ab=next(o.read_typetree() for o in a.objects.values() if o.type.name=='AssetBundle')
    container={k.lower():v for k,v in ab['m_Container']}
    for icon,guid in selected.items():
        try:
            entry=container.get(guid.lower()) or container.get(icon.lower())
            if not entry:raise ValueError('No container mapping')
            obj=resolve(a,entry['asset']);image=obj.read().image
            filename='icon-'+hashlib.sha256(icon.encode()).hexdigest()[:20]+'.png';image.save(OUT/filename)
            icons[icon]={'file':filename,'source':key(obj),'width':image.width,'height':image.height}
        except Exception as exc:missing.append({'icon':icon,'error':str(exc)})
for identity,loadout in loadouts.items():
    owner=objects[identity].assets_file;d=loadout['data']
    loadout['resolved']={}
    for kind in ['_inventory','_belt','_wearable']:
        entries=[]
        for entry in d[kind]:
            target=resolve(owner,entry['item'])
            if not target or not entry['enabled']:continue
            item=items[key(target)]['data']
            if item['_splittable'] and entry['_useCount']<=0:continue
            entries.append({'item':key(target),'uses':min(item['_maxUses'],entry['_useCount']),'minimumRequirement':bool(entry['_minimumRequirement'])})
        loadout['resolved'][kind]=entries
    loadout['resolved']['blueprints']=[key(resolve(owner,p)) for p in d['_defaultBlueprints']]
manifest={'sourceSHA256':sources,'items':items,'blueprints':blueprints,'loadouts':loadouts,'icons':icons,'missingIcons':missing}
manifest['outputSHA256']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(OUT.iterdir()) if p.is_file() and p.name!='manifest.json'}
(OUT/'manifest.json').write_text(json.dumps(manifest,separators=(',',':'),allow_nan=False),encoding='utf-8')
print(json.dumps({'items':len(items),'blueprints':len(blueprints),'icons':len(icons),'missing':missing[:8],'loadouts':{k:v['resolved'] for k,v in loadouts.items()}},indent=2))
