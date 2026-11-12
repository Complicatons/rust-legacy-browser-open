"""Static export of original loot spawners, lootable crate prefabs and LootSpawnLists (data bundles only).

Runtime rules come from decompiled LootableObjectSpawner, LootableObject, LootSpawnList and WeightSelection.
"""
from pathlib import Path
import sys,json,hashlib,collections
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.tools/python'))
import UnityPy
import numpy as np
from UnityPy.helpers.MeshHelper import MeshHandler
SOURCE=ROOT/'analysis/world-source/bundles'
OUT=ROOT/'browser/assets/recovered/loot'
OUT.mkdir(parents=True,exist_ok=True)
H=np.diag([1.,1.,-1.,1.])
sources={};assets={};issues=collections.Counter()
def load(path):
    sources[path.name]=hashlib.sha256(path.read_bytes()).hexdigest()
    for a in UnityPy.load(str(path)).assets:assets[a.name.lower()]=a
for name in ['scenes.unity3d','sharedassets0.assets','scriptableobject.000.unity3d','gameobject.000.unity3d','gameobject.001.unity3d']:load(SOURCE/name)
scene=assets['buildplayer-rust_island_2013']
def resolve(owner,ptr):
    if not ptr['m_PathID']:return None
    if not ptr['m_FileID']:a=owner
    else:
        key=owner.externals[ptr['m_FileID']-1].path.lower().split('/')[-1]
        if key not in assets:
            path=SOURCE/(key.removeprefix('cab-')+'.unity3d') if key.startswith('cab-') else SOURCE/key
            if not path.exists():raise ValueError('Missing dependency: '+key)
            load(path)
        a=assets[key]
    return a.objects[ptr['m_PathID']]
def identity(obj):return obj.assets_file.name.lower()+':'+str(obj.path_id)
def token(text):return hashlib.sha256(text.encode()).hexdigest()[:20]
script_names={}
def script_name(obj,d):
    k=identity(obj).split(':')[0]+json.dumps(d['m_Script'],sort_keys=True)
    if k not in script_names:
        try:script_names[k]=resolve(obj.assets_file,d['m_Script']).read_typetree()['m_ClassName']
        except Exception:script_names[k]=None
    return script_names[k]
def binary(name,values,dtype):
    a=np.asarray(values,dtype=dtype);a.tofile(OUT/name);return {'file':name,'count':int(a.size)}
def trs(t):
    q=t['m_LocalRotation'];x,y,z,w=[q[k] for k in 'xyzw']
    r=np.array([[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w],[2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w],[2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y]])
    m=np.eye(4);m[:3,:3]=r@np.diag([t['m_LocalScale'][k] for k in 'xyz']);m[:3,3]=[t['m_LocalPosition'][k] for k in 'xyz'];return m
textures={};materials={};meshes={}
def texture(obj):
    key=identity(obj)
    if key not in textures:
        image=obj.read().image;filename='texture-'+token(key)+'.png';image.save(OUT/filename)
        textures[key]={'file':filename,'width':image.width,'height':image.height,'source':key}
    return textures[key]['file']
def material(obj):
    key=identity(obj)
    if key not in materials:
        d=obj.read_typetree();props=d['m_SavedProperties']
        envs={k['name']:v for k,v in props['m_TexEnvs']};floats={k['name']:v for k,v in props['m_Floats']};colors={k['name']:v for k,v in props['m_Colors']}
        main=envs.get('_MainTex');tex=resolve(obj.assets_file,main['m_Texture']) if main else None
        materials[key]={'name':d['m_Name'],'texture':texture(tex) if tex else None,'color':colors.get('_Color',{'r':1,'g':1,'b':1,'a':1}),'cutoff':floats.get('_Cutoff'),'offset':main.get('m_Offset') if main else None,'scale':main.get('m_Scale') if main else None,'source':key}
    return key
def write_mesh(key,name,vertices,normals,uv,triangles):
    """Vertices/normals already in Unity space; reflect Z and reverse winding for the browser."""
    prefix='mesh-'+token(key);v=np.array(vertices,dtype='<f4')[:,:3].copy();v[:,2]*=-1
    n=np.array(normals,dtype='<f4')[:,:3].copy() if normals is not None and len(normals) else np.array([])
    if n.size:n[:,2]*=-1
    u=np.array(uv,dtype='<f4')[:,:2] if uv is not None and len(uv) else np.array([])
    parts=[binary(prefix+f'-indices-{i}.bin',np.asarray(t,dtype='<u4').reshape(-1,3)[:,[0,2,1]],'<u4') for i,t in enumerate(triangles)]
    meshes[key]={'name':name,'position':binary(prefix+'-position.bin',v,'<f4'),'normal':binary(prefix+'-normal.bin',n,'<f4') if n.size else None,'uv':binary(prefix+'-uv.bin',u,'<f4') if u.size else None,'parts':parts,'bounds':[v.min(axis=0).tolist(),v.max(axis=0).tolist()],'source':key}
    return key
def mesh(obj):
    key=identity(obj)
    if key not in meshes:
        h=MeshHandler(obj.read());h.process();write_mesh(key,obj.read().m_Name,h.m_Vertices,h.m_Normals,h.m_UV0,h.get_triangles())
    return key
def skinned_mesh(obj,bone_matrices,owner_key):
    """Bake the prefab rest pose: v' = sum_i w_i * (bone_i relative to prefab root) * bindpose_i * v."""
    key=identity(obj)+'@'+owner_key
    if key not in meshes:
        m=obj.read();h=MeshHandler(m);h.process();d=obj.read_typetree()
        binds=[np.array([[b[f'e{r}{c}'] for c in range(4)] for r in range(4)]) for b in d['m_BindPose']]
        skin=[bone_matrices[i]@binds[i] for i in range(len(binds))]
        v=np.c_[np.array(h.m_Vertices,dtype=float)[:,:3],np.ones(len(h.m_Vertices))];n=np.array(h.m_Normals,dtype=float)[:,:3] if h.m_Normals else None
        outv=np.zeros((len(v),3));outn=np.zeros((len(v),3)) if n is not None else None
        for i,(idx,w) in enumerate(zip(h.m_BoneIndices,h.m_BoneWeights)):
            for b,wt in zip(idx,w):
                if wt<=0:continue
                outv[i]+=wt*(skin[b]@v[i])[:3]
                if n is not None:outn[i]+=wt*(skin[b][:3,:3]@n[i])
        if outn is not None:outn/=np.maximum(np.linalg.norm(outn,axis=1,keepdims=True),1e-9)
        write_mesh(key,m.m_Name,outv,outn,h.m_UV0,h.get_triangles())
    return key
def components(owner,go):
    out=collections.defaultdict(list)
    for c in go['m_Component']:
        p=c[1] if isinstance(c,(tuple,list)) else c['component'];co=resolve(owner,p)
        if co is not None:out[co.type.name].append(co)
    return out

prefabs={}
def prefab(lootable):
    key=identity(lootable)
    if key in prefabs:return key
    owner=lootable.assets_file;ld=lootable.read_typetree()
    root_go=resolve(owner,ld['m_GameObject']);root_t=components(owner,root_go.read_typetree())['Transform'][0].read_typetree()
    rel={};nodes=[]
    def walk(t_obj,matrix,depth):
        t=t_obj.read_typetree();rel[t_obj.path_id]=matrix;go=resolve(owner,t['m_GameObject']).read_typetree();nodes.append((t_obj,t,go,matrix))
        for c in t['m_Children']:
            child=resolve(owner,c);walk(child,matrix@trs(child.read_typetree()),depth+1)
    root_obj=components(owner,root_go.read_typetree())['Transform'][0];walk(root_obj,np.eye(4),0)
    renderers=[];colliders=[]
    for t_obj,t,go,matrix in nodes:
        if not go['m_IsActive']:continue
        cs=components(owner,go)
        for f in cs.get('MeshFilter',[]):
            r=next((x for x in cs.get('MeshRenderer',[])),None)
            if r is None or not r.read_typetree()['m_Enabled']:continue
            rd=r.read_typetree();mobj=resolve(owner,f.read_typetree()['m_Mesh'])
            renderers.append({'name':go['m_Name'],'layer':go['m_Layer'],'mesh':mesh(mobj),'materials':[material(resolve(owner,p)) for p in rd['m_Materials']],'matrix':(H@matrix@H).T.ravel().tolist()})
        for s in cs.get('SkinnedMeshRenderer',[]):
            sd=s.read_typetree()
            if not sd['m_Enabled']:continue
            bones=[rel[resolve(owner,b).path_id] for b in sd['m_Bones']]
            mkey=skinned_mesh(resolve(owner,sd['m_Mesh']),bones,key)
            renderers.append({'name':go['m_Name'],'layer':go['m_Layer'],'mesh':mkey,'materials':[material(resolve(owner,p)) for p in sd['m_Materials']],'matrix':np.eye(4).T.ravel().tolist(),'skinnedRestPose':True})
        for kind in ['BoxCollider','MeshCollider']:
            for c in cs.get(kind,[]):
                d=c.read_typetree()
                if not d['m_Enabled'] or d['m_IsTrigger']:continue
                entry={'type':kind,'name':go['m_Name'],'layer':go['m_Layer'],'matrix':(H@matrix@H).T.ravel().tolist()}
                if kind=='BoxCollider':entry.update(center=[d['m_Center']['x'],d['m_Center']['y'],-d['m_Center']['z']],size=[d['m_Size'][k] for k in 'xyz'])
                else:entry['mesh']=mesh(resolve(owner,d['m_Mesh']))
                colliders.append(entry)
    child0=resolve(owner,root_t['m_Children'][0]).read_typetree() if root_t['m_Children'] else None
    prefabs[key]={'name':root_go.read_typetree()['m_Name'],'source':key,'rootScale':root_t['m_LocalScale'],
        'child0LocalRotation':child0['m_LocalRotation'] if child0 else {'x':0,'y':0,'z':0,'w':1},
        'lootable':{k:ld[k] for k in ['LootCycle','lifeTime','destroyOnEmpty','NumberOfSlots','lateSized']}|{'spawnList':ld['_lootSpawnListName']['name']},
        'renderers':renderers,'colliders':colliders}
    return key

# Scene hierarchy for spawner world positions.
gos={};transforms={}
for obj in scene.objects.values():
    if obj.type.name=='GameObject':gos[obj.path_id]=obj.read_typetree()
    elif obj.type.name=='Transform':transforms[obj.path_id]=obj.read_typetree()
go_transform={t['m_GameObject']['m_PathID']:pid for pid,t in transforms.items()}
def world(pid):return np.eye(4) if not pid else world(transforms[pid]['m_Father']['m_PathID'])@trs(transforms[pid])
def active(pid):return True if not pid else gos[transforms[pid]['m_GameObject']['m_PathID']]['m_IsActive'] and active(transforms[pid]['m_Father']['m_PathID'])
spawners=[];spawner_omissions=[]
for obj in scene.objects.values():
    if obj.type.name!='MonoBehaviour':continue
    d=obj.read_typetree()
    if script_name(obj,d)!='LootableObjectSpawner':continue
    goid=d['m_GameObject']['m_PathID'];tid=go_transform[goid]
    if not active(tid) or not d['m_Enabled'] or not d['_lootableChances']:spawner_omissions.append({'pathID':obj.path_id,'reason':'inactive, disabled or empty (Awake destroys empty spawners)'});continue
    chances=[{'prefab':prefab(resolve(scene,c['obj'])),'weight':c['weight']} for c in d['_lootableChances']]
    spawners.append({'pathID':obj.path_id,'gameObjectPathID':goid,'name':gos[goid]['m_Name'],'position':(H@world(tid))[:3,3].tolist(),'chances':chances,'spawnOnStart':bool(d['spawnOnStart']),'spawnTimeMin':d['spawnTimeMin'],'spawnTimeMax':d['spawnTimeMax']})

# LootSpawnLists are looked up by name (LootSpawnListReference -> DatablockDictionary.GetLootSpawnListByName).
items_manifest=json.loads((ROOT/'browser/assets/recovered/items/manifest.json').read_text())
lists={};unresolved=[]
for a in list(assets.values()):
    for o in list(a.objects.values()):
        if o.type.name!='MonoBehaviour':continue
        try:d=o.read_typetree()
        except Exception:continue
        if script_name(o,d)!='LootSpawnList':continue
        packages=[]
        for entry in d['LootPackages']:
            target=None
            try:target=resolve(o.assets_file,entry['obj'])
            except Exception as exc:unresolved.append({'list':d['m_Name'],'reason':str(exc)})
            package={'weight':entry['weight'],'amountMin':entry['amountMin'],'amountMax':entry['amountMax']}
            if target is None:package['nullReference']=True  # original pointer is null: the pick yields nothing
            else:
                td=target.read_typetree();kind=script_name(target,td)
                if kind=='LootSpawnList':package['list']=td['m_Name']
                elif identity(target) in items_manifest['items']:package['item']=identity(target)
                else:package['missing']=True;unresolved.append({'list':d['m_Name'],'reason':'Item not in items export','target':identity(target),'class':kind})
            packages.append(package)
        lists[d['m_Name']]={'source':identity(o),'packages':packages,'minPackagesToSpawn':d['minPackagesToSpawn'],'maxPackagesToSpawn':d['maxPackagesToSpawn'],'noDuplicates':bool(d['noDuplicates']),'spawnOneOfEach':bool(d['spawnOneOfEach'])}
for p in prefabs.values():
    if p['lootable']['spawnList'] not in lists:issues['missing spawn list '+p['lootable']['spawnList']]+=1
manifest={'spawners':spawners,'spawnerOmissions':spawner_omissions,'prefabs':prefabs,'lists':lists,'unresolvedLootEntries':unresolved,'meshes':meshes,'materials':materials,'textures':textures,'summary':dict(issues),'sourceSHA256':sources,
 'conversion':'Spawner positions are browser space (Unity Z reflected). Prefab part matrices are H*relative*H relative to the prefab root, excluding root position/rotation but not root scale (rootScale), matching NetCull.InstantiateStatic(prefab, pos, rot). Skinned renderers are baked to their rest pose.'}
manifest['outputSHA256']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(OUT.iterdir()) if p.is_file() and p.name!='manifest.json'}
(OUT/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')),encoding='utf-8')
print(json.dumps({'spawners':len(spawners),'omitted':len(spawner_omissions),'prefabs':{p['name']:{'renderers':len(p['renderers']),'colliders':len(p['colliders']),'list':p['lootable']['spawnList']} for p in prefabs.values()},'lists':len(lists),'unresolved':unresolved[:10],'issues':dict(issues)},indent=1))
