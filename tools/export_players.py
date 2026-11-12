"""Export original MalePlayer skin, legacy clips and movement configuration by static data reading only."""
import json,math
from unity_common import ROOT,Bundles,Writer,identity
from unity_skin import skeleton,skin,clip
from unity_armor import ArmorExport,SLOTS
OUT=ROOT/'browser/assets/recovered/players'
b=Bundles([ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data'],['gameobject.000.unity3d','scriptableobject.000.unity3d','sharedassets0.assets'])
writer=Writer(b,OUT);so=b.asset('cab-scriptableobject.000')
owner=b.asset('cab-gameobject.000')
go=next(o.read_typetree() for o in owner.objects.values() if o.type.name=='GameObject' and o.read_typetree()['m_Name']=='MalePlayer')
cs=b.components(owner,go)
nodes,indices,paths=skeleton(b,cs['Transform'][0]);skins=[]
hit_components={};hit_shapes=[]
for tid,i in indices.items():
    t=owner.objects[tid].read_typetree();g=b.resolve(owner,t['m_GameObject']).read_typetree()
    components=b.components(owner,g)
    for obj in components.get('HitBox',[]):
        d=obj.read_typetree();hit_components[obj.path_id]={'bone':i,'bodyPart':d['bodyPart'],'priority':d['priority'],'damageFactor':d['damageFactor']}
    for obj in components.get('HitBoxSystem',[]):hit_shapes.extend(obj.read_typetree()['shapes'])
hitboxes=[]
for shape in hit_shapes:
    part=hit_components[shape['component']['m_PathID']]
    if shape['kind'] not in (1,2,4):raise ValueError('Unsupported original player hit shape')
    hitboxes.append({**part,**{k:shape[k] for k in ('kind','inversion','origin','directionOrSize','length','radius')}})
for tid,i in indices.items():
    t=owner.objects[tid].read_typetree();g=b.resolve(owner,t['m_GameObject']).read_typetree()
    if not g['m_IsActive']:continue
    for smr in b.components(owner,g).get('SkinnedMeshRenderer',[]):
        if smr.read_typetree()['m_Enabled']:skins.append({**skin(b,writer,smr,indices,identity(smr)),'transform':i})
an=cs['Animation'][0].read_typetree();clips={};unbound=set()
for p in an['m_Animations']+[an['m_Animation']]:
    o=b.resolve(owner,p)
    if o is not None:
        c=clip(o,paths,unbound);clips[c['name']]=c
trait=next(o for o in so.objects.values() if o.type.name=='MonoBehaviour' and b.script(o,o.read_typetree())=='CharacterAnimationTrait')
movement=b.resolve(so,trait.read_typetree()['_movementAnimationSetup']).read_typetree()
armor=ArmorExport(b,writer,paths)
attachment=next(o.read_typetree()['_socket'] for o in so.objects.values() if o.type.name=='MonoBehaviour' and b.script(o,o.read_typetree())=='CharacterItemAttachmentTrait')
attachment['bone']=next(h['bone'] for h in hitboxes if h['bodyPart']==attachment['parent'])
default_skins=[armor.resolve(s)['skin'] for s in SLOTS]
def finite(v):
    if isinstance(v,dict):return {k:finite(x) for k,x in v.items() if k not in ('m_GameObject','m_Enabled','m_Script')}
    if isinstance(v,list):return [finite(x) for x in v]
    if isinstance(v,float) and not math.isfinite(v):return None # Unity +Infinity = inherit from parent.
    return v
(OUT/'clips.json').write_text(json.dumps(clips,separators=(',',':'),allow_nan=False),encoding='utf8')
writer.finish({'player':{'name':go['m_Name'],'netName':':player_soldier','skeleton':nodes,'hitboxes':hitboxes,'itemAttachment':attachment,'skins':default_skins,'originalSkin':skins,'clips':list(clips),'defaultClip':b.resolve(owner,an['m_Animation']).read().m_Name},'armor':armor.manifest(),
    'movement':finite(movement),'clipsFile':'clips.json','unboundCurves':sorted(unbound),'conversion':'Unity bones/bindposes/curves; H=diag(1,1,-1) at world root, triangle winding reversed.'})
print(json.dumps({'bones':len(nodes),'skins':len(default_skins),'armorModels':len(armor.models),'clips':list(clips),'unboundCurves':len(unbound),'movementGroups':[g['name'] for g in movement['groupMatrices']]}))
