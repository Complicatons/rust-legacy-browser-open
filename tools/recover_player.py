"""Resolve original player configuration via static Unity script metadata and pointers."""
from pathlib import Path
import sys,json,hashlib,collections,math
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'.tools/python'))
import UnityPy
SOURCE=ROOT/'analysis/world-source/bundles'
files=['sharedassets0.assets','scriptableobject.000.unity3d','gameobject.000.unity3d','gameobject.001.unity3d']
assets={};sources={}
def normalize(value):
    if isinstance(value,float) and not math.isfinite(value):return {'$float':str(value)}
    if isinstance(value,dict):return {k:normalize(v) for k,v in value.items()}
    if isinstance(value,(list,tuple)):return [normalize(v) for v in value]
    return value
for filename in files:
    path=SOURCE/filename;sources[filename]=hashlib.sha256(path.read_bytes()).hexdigest()
    for a in UnityPy.load(str(path)).assets:assets[a.name.lower()]=a
def resolve(owner,p):
    if not p['m_PathID']:return None
    a=owner if not p['m_FileID'] else assets[owner.externals[p['m_FileID']-1].path.lower().split('/')[-1]]
    return a.objects[p['m_PathID']]
def script(o,d):
    try:return resolve(o.assets_file,d['m_Script']).read_typetree()['m_ClassName']
    except Exception:return 'unresolved'
records=[];counts=collections.Counter()
for a in list(assets.values()):
    for o in a.objects.values():
        if o.type.name not in ['MonoBehaviour','CharacterController','CapsuleCollider']:continue
        try:d=o.read_typetree()
        except Exception as exc:
            counts['unreadable '+o.type.name]+=1
            continue
        name=script(o,d) if o.type.name=='MonoBehaviour' else o.type.name;counts[name]+=1
        if (name.startswith('Character') and name.endswith('Trait')) or name in ['CharacterTraitMap','CharacterPrefab','Crouchable','CCDesc','ControllablePrefab','ViewModel'] or any(k in name.lower() for k in ['motor','controller','cctotem','charactertrait','charactereyes','characterstate','controlconfiguration','archetype','inventory','datablock','itemdatablock','blueprintdatablock','playerclient']):
            records.append({'file':a.name,'pathID':o.path_id,'script':name,'data':d})
OUT=ROOT/'analysis/player-inspection';OUT.mkdir(exist_ok=True)
(OUT/'resolved.json').write_text(json.dumps(normalize({'sources':sources,'records':records,'counts':dict(counts)}),indent=2,allow_nan=False),encoding='utf-8')
print('Retained',len(records),'records;',len(counts),'script types')
for r in records:
    if r['script'] in ['CharacterCrouchTrait','Crouchable','CCDesc','CharacterTraitMap','CharacterPrefab','ControllablePrefab']:print(r['file'],r['pathID'],r['script'],json.dumps(r['data'])[:2800])
for pid in [1156260163]:
    o=assets['cab-gameobject.000'].objects[pid]
    d=o.read_typetree();print('TARGET',pid,o.type.name,json.dumps(d)[:3500])
    eye=resolve(o.assets_file,d['_eyesTransform']);print('PLAYER EYES',json.dumps(eye.read_typetree()))
    go=resolve(o.assets_file,d['m_GameObject'])
    print('PLAYER GAMEOBJECT',go.path_id,json.dumps(go.read_typetree()))
    for kind,p in go.read_typetree()['m_Component']:
        c=resolve(go.assets_file,p)
        if c.type.name=='Transform':print('PLAYER TRANSFORM',json.dumps(c.read_typetree()))

# Resolve the actual Male -> Human -> Default inheritance, with derived traits overriding bases.
scriptable=assets['cab-scriptableobject.000']
maps={o.read_typetree()['m_Name']:o for o in scriptable.objects.values() if o.type.name=='MonoBehaviour' and script(o,o.read_typetree())=='CharacterTraitMap'}
chain=[];traits={}
def bind_map(o):
    d=o.read_typetree();base=resolve(o.assets_file,d['B'])
    if base:bind_map(base)
    chain.append({'name':d['m_Name'],'pathID':o.path_id})
    for p in d['K']:
        trait=resolve(o.assets_file,p)
        if trait:
            td=trait.read_typetree();traits[script(trait,td)]={'file':trait.assets_file.name,'pathID':trait.path_id,'data':td}
bind_map(maps['Male'])
motor=traits['CharacterCCMotorTrait'];mdata=motor['data'];motor_obj=scriptable.objects[motor['pathID']]
settings_obj=resolve(motor_obj.assets_file,mdata['_settings'])
totem=resolve(motor_obj.assets_file,mdata['_prefab']);totem_data=totem.read_typetree()
desc=resolve(totem.assets_file,totem_data['prefab']);desc_data=desc.read_typetree()
player=assets['cab-gameobject.000'].objects[1156260163];pd=player.read_typetree();eye=resolve(player.assets_file,pd['_eyesTransform']).read_typetree()
# The player's HumanBodyTakeDamage (max health, bleed interval) lives on the same GameObject as the Character.
player_go=resolve(player.assets_file,pd['m_GameObject']).read_typetree();body=None
for kind,p in player_go['m_Component']:
    c=resolve(player.assets_file,p)
    if c is not None and c.type.name=='MonoBehaviour' and script(c,c.read_typetree())=='HumanBodyTakeDamage':body={'file':c.assets_file.name,'pathID':c.path_id,'data':c.read_typetree()}
export={'sourceSHA256':sources,'player':{'file':player.assets_file.name,'pathID':player.path_id,'data':pd},'traitChain':chain,'traits':traits,'motorSettings':{'file':settings_obj.assets_file.name,'pathID':settings_obj.path_id,'data':settings_obj.read_typetree()},'totem':{'file':totem.assets_file.name,'pathID':totem.path_id,'data':totem_data},'controller':{'file':desc.assets_file.name,'pathID':desc.path_id,'data':desc_data},'eyes':eye,'takeDamage':body}
target=ROOT/'browser/assets/recovered/player.json';target.write_text(json.dumps(normalize(export),separators=(',',':'),allow_nan=False),encoding='utf-8')
catalogue=[r for r in records if 'datablock' in r['script'].lower()]
(ROOT/'browser/assets/recovered/catalogue.json').write_text(json.dumps(normalize({'sourceSHA256':sources,'records':catalogue}),separators=(',',':'),allow_nan=False),encoding='utf-8')
print('EXPORTED player.json; trait chain',chain,'items/blueprints',len(catalogue))
