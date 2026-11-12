"""Static export of the original wildlife prefabs (NetMainPrefab ":" registry): skeletons, skinned meshes,
legacy animation clips, AI/movement/health/harvest settings and sounds. Client data bundles only.

Skinned geometry stays in Unity space: the browser places each animal under a root with the Z reflection
(H = diag(1,1,-1)), so original bindposes and bone curves are used unchanged. Triangle winding is reversed
to compensate for that reflection.
"""
import json,collections
from unity_common import ROOT,Bundles,Writer,identity,token
import numpy as np
from UnityPy.helpers.MeshHelper import MeshHandler

CLIENT=[ROOT/'analysis/client-source/bundles',ROOT/'analysis/client-source/data']
OUT=ROOT/'browser/assets/recovered/animals'
OUT.mkdir(parents=True,exist_ok=True)
for old in OUT.iterdir():
    if old.is_file():old.unlink()
b=Bundles(CLIENT,['gameobject.000.unity3d','scriptableobject.000.unity3d','sharedassets0.assets'])
writer=Writer(b,OUT);issues=collections.Counter()
items=json.loads((ROOT/'browser/assets/recovered/items/manifest.json').read_text())['items']
item_by_name={i['data']['m_Name']:k for k,i in items.items()}
so=b.asset('cab-scriptableobject.000')
registry={}
for o in so.objects.values():
    if o.type.name!='MonoBehaviour':continue
    try:d=o.read_typetree()
    except Exception:continue
    if '_serverPrefab' in d:registry[d['m_Name']]=d
ANIMALS=['chicken_prefab','rabbit_prefab_a','boar_prefab','stag_prefab','wolf_prefab','bear_prefab','mutant_wolf','mutant_bear']
AI_FIELDS=['afraidOfFootsteps','afraidOfDanger','walkSpeed','runSpeed','walkAnimScalar','runAnimScalar','loseTargetRange','attackRange','attackRangeMax','attackRate','attackDamageMin','attackDamageMax','dropOnDeathString']
sounds={}
def sound(obj):
    key=identity(obj)
    if key not in sounds:
        clip=obj.read();(name,data),=clip.samples.items()
        filename='sound-'+token(key)+'.'+name.rsplit('.',1)[-1];(OUT/filename).write_bytes(data);sounds[key]={'file':filename,'name':clip.m_Name}
    return sounds[key]['file']
def sound_array(owner,ptr):
    """AudioClipArray asset -> list of exported clips."""
    obj=b.resolve(owner,ptr)
    if obj is None:return []
    d=obj.read_typetree();arr=next((v for v in d.values() if isinstance(v,list)),[])
    out=[]
    for p in arr:
        try:
            c=b.resolve(obj.assets_file,p)
            if c is not None:out.append(sound(c))
        except Exception as exc:issues['sound: '+str(exc)]+=1
    return out
def tr_data(t):return {'position':[t['m_LocalPosition'][k] for k in 'xyz'],'rotation':[t['m_LocalRotation'][k] for k in 'xyzw'],'scale':[t['m_LocalScale'][k] for k in 'xyz']}

def skinned(owner,smr,bone_index,key):
    d=smr.read_typetree();mobj=b.resolve(owner,d['m_Mesh']);m=mobj.read();h=MeshHandler(m);h.process();md=mobj.read_typetree()
    prefix='skin-'+token(key)
    v=np.array(h.m_Vertices,dtype='<f4')[:,:3];n=np.array(h.m_Normals,dtype='<f4')[:,:3];uv=np.array(h.m_UV0,dtype='<f4')[:,:2]
    # Reverse winding: the browser root carries the Z reflection, which flips facing.
    tris=[np.asarray(t,dtype='<u4').reshape(-1,3)[:,[0,2,1]] for t in h.get_triangles()]
    bones=[bone_index[b.resolve(owner,p).path_id] for p in d['m_Bones']]
    binds=[[bp[f'e{r}{c}'] for c in range(4) for r in range(4)] for bp in md['m_BindPose']]  # column-major
    return {'name':m.m_Name,'position':writer.binary(prefix+'-position.bin',v,'<f4'),'normal':writer.binary(prefix+'-normal.bin',n,'<f4'),'uv':writer.binary(prefix+'-uv.bin',uv,'<f4'),
        'skinIndex':writer.binary(prefix+'-skinindex.bin',np.array(h.m_BoneIndices,dtype='<u2'),'<u2'),'skinWeight':writer.binary(prefix+'-skinweight.bin',np.array(h.m_BoneWeights,dtype='<f4'),'<f4'),
        'parts':[writer.binary(prefix+f'-indices-{i}.bin',t,'<u4') for i,t in enumerate(tris)],'bones':bones,'bindposes':binds,
        'materials':[writer.material(b.resolve(owner,p)) for p in d['m_Materials']]}

def clip(obj,paths):
    """Legacy AnimationClip curves (uncompressed, 30 Hz keys) as per-bone time/value arrays."""
    d=obj.read_typetree()
    if d['m_Compressed']:issues['compressed clip '+d['m_Name']]+=1;return None
    tracks=collections.defaultdict(dict);length=0
    for kind,field,comps in [('rotation','m_RotationCurves','xyzw'),('position','m_PositionCurves','xyz'),('scale','m_ScaleCurves','xyz')]:
        for c in d[field]:
            if c['path'] not in paths:issues['unbound curve path']+=1;continue
            keys=c['curve']['m_Curve'];times=[k['time'] for k in keys];length=max(length,times[-1] if times else 0)
            tracks[paths[c['path']]][kind]={'times':times,'values':[k['value'][x] for k in keys for x in comps]}
    return {'name':d['m_Name'],'length':length,'wrapMode':d['m_WrapMode'],'tracks':[{'bone':i,**t} for i,t in sorted(tracks.items())]}

animals={};clips={}
for name in ANIMALS:
    reg=registry[name];obj=b.resolve(so,reg['_serverPrefab']);owner=obj.assets_file
    go=b.resolve(owner,obj.read_typetree()['m_GameObject']).read_typetree();cs=b.components(owner,go)
    ai_class=next(k for k in cs if k.endswith('AI'));ai=cs[ai_class][0].read_typetree()
    # Skeleton: every transform under the prefab root, parent-first; the root's own position/rotation come from spawn.
    skeleton=[];bone_index={};paths={}
    def walk(t_obj,parent,path):
        t=t_obj.read_typetree();g=b.resolve(owner,t['m_GameObject']).read_typetree()
        i=len(skeleton);bone_index[t_obj.path_id]=i;paths[path]=i
        skeleton.append({'name':g['m_Name'],'parent':parent,'path':path,**tr_data(t)})
        for c in t['m_Children']:walk(b.resolve(owner,c),i,(path+'/' if path else '')+b.resolve(owner,b.resolve(owner,c).read_typetree()['m_GameObject']).read_typetree()['m_Name'])
    walk(cs['Transform'][0],-1,'')
    skins=[]
    for i,s in enumerate(skeleton):
        g_obj=None
    for t_id,i in bone_index.items():
        t=owner.objects[t_id].read_typetree();g=b.resolve(owner,t['m_GameObject']).read_typetree();gcs=b.components(owner,g)
        for smr in gcs.get('SkinnedMeshRenderer',[]):
            if smr.read_typetree()['m_Enabled']:skins.append({**skinned(owner,smr,bone_index,name+':'+str(smr.path_id)),'transform':i})
    an=cs['Animation'][0].read_typetree();names=[]
    for p in an['m_Animations']:
        c=b.resolve(owner,p)
        if c is None:continue
        key=name+':'+c.read().m_Name
        data=clip(c,paths)
        if data:clips[key]=data;names.append(data['name'])
    default=b.resolve(owner,an['m_Animation']);
    move=next(k for k in ['BasicWildLifeMovement','NavMeshMovement'] if k in cs);mv=cs[move][0].read_typetree()
    td=cs['ProtectionTakeDamage'][0].read_typetree();rt=cs['ResourceTarget'][0].read_typetree();box=cs['BoxCollider'][0].read_typetree()
    trait=None
    character=cs['Character'][0].read_typetree()
    if character.get('_traitMapName'):
        maps={o.read_typetree()['m_Name']:o for o in so.objects.values() if o.type.name=='MonoBehaviour' and b.script(o,o.read_typetree())=='CharacterTraitMap'}
        tm=maps.get(character['_traitMapName'])
        while tm is not None and trait is None:
            td_map=tm.read_typetree()
            for p in td_map['K']:
                t=b.resolve(tm.assets_file,p)
                if t is not None and b.script(t,t.read_typetree())=='CharacterNavAgentTrait':trait={k:v for k,v in t.read_typetree().items() if k not in('m_Script','m_GameObject','m_Enabled')}
            tm=b.resolve(tm.assets_file,td_map['B'])
    variants={}
    for field in ['roosterMat','ChickenMatA','ChickenMatB']:
        if field in ai and ai[field]['m_PathID']:variants[field]=writer.material(b.resolve(owner,ai[field]))
    if 'mats' in ai:variants['mats']=[writer.material(b.resolve(owner,p)) for p in ai['mats'] if p['m_PathID']]
    snd={k:sound_array(owner,ai[k]) for k in ['idleSounds','fleeStartSounds','deathSounds','attackSounds','chaseSoundsClose','chaseSoundsFar'] if k in ai}
    resources=[]
    for pair in rt['resourcesAvailable']:
        key=item_by_name.get(pair['ResourceItemName'])
        if key is None:issues['unresolved item '+pair['ResourceItemName']]+=1
        resources.append({'item':key,'name':pair['ResourceItemName'],'amountMin':pair['amountMin'],'amountMax':pair['amountMax']})
    animals[name]={'name':go['m_Name'],'netName':':'+name,'aiClass':ai_class,'layer':go['m_Layer'],'ai':{k:ai[k] for k in AI_FIELDS if k in ai},'hostile':'attackRange' in ai,
        'movement':{'type':move,**{k:mv[k] for k in ['lookDegreeSpeed','maxSlope','simRate','moveCastOffset'] if k in mv}},'navAgent':trait,
        'takeDamage':{'maxHealth':td['_maxHealth'],'armor':td['_startArmorValues']['damageArray'],'sendMessageWhenDead':bool(td['sendMessageWhenDead'])},
        'resourceTarget':{'resourcesAvailable':resources,'gatherEfficiencyMultiplier':rt['gatherEfficiencyMultiplier'],'type':rt['type']},
        'collider':{'size':[box['m_Size'][k] for k in 'xyz'],'center':[box['m_Center'][k] for k in 'xyz']},
        'skeleton':skeleton,'skins':skins,'clips':names,'defaultClip':default.read().m_Name if default else None,'materialVariants':variants,'sounds':snd}
clip_file='clips.json';(OUT/clip_file).write_text(json.dumps(clips,separators=(',',':')),encoding='utf-8')
writer.finish({'animals':animals,'clipsFile':clip_file,'sounds':sounds,'summary':dict(issues),
    'conversion':'Skeleton, skinned vertices, bindposes (column-major) and clip curves are Unity space; the browser root applies H=diag(1,1,-1) with the spawn position/rotation. Triangle winding reversed for that reflection.'})
print(json.dumps({k:{'ai':a['aiClass'],'move':a['movement']['type'],'health':a['takeDamage']['maxHealth'],'bones':len(a['skeleton']),'skins':len(a['skins']),'clips':a['clips'],'nav':bool(a['navAgent']),'sounds':{s:len(v) for s,v in a['sounds'].items()},'resources':[r['name'] for r in a['resourceTarget']['resourcesAvailable']]} for k,a in animals.items()},indent=1)[:6000])
print('issues',dict(issues))
