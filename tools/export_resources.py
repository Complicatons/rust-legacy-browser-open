"""Static export of original GenericSpawners, resource-node prefabs and terrain tree colliders.

Rules come from decompiled GenericSpawner, GenericSpawnerSpawnList, ResourceTarget, ResourceGivePair,
ResourceObject, MeleeWeaponDataBlock and client TreeUnpack/WoodBlockerTemp. Data bundles only.
"""
import json,collections
import numpy as np
from unity_common import ROOT,H,Bundles,Writer,identity,trs

SERVER=ROOT/'analysis/world-source/bundles'
CLIENT=ROOT/'analysis/client-source/bundles'
OUT=ROOT/'browser/assets/recovered/resources'
server=Bundles(SERVER,['scenes.unity3d','sharedassets0.assets','scriptableobject.000.unity3d','gameobject.000.unity3d','gameobject.001.unity3d','ngcconfiguration.000.unity3d'])
writer=Writer(server,OUT);issues=collections.Counter()
items=json.loads((ROOT/'browser/assets/recovered/items/manifest.json').read_text())['items']
# DatablockDictionary.GetByName: ItemDataBlocks by datablock name.
item_by_name={i['data']['m_Name']:k for k,i in items.items()}

# NGC prefab registry (NetCull.InstantiateStatic by name) -> content path -> AssetBundle container entry.
ngc_asset=next(a for a in server.assets.values() for o in a.objects.values() if o.type.name=='MonoBehaviour' and a.name.lower().startswith('cab-ngcconfiguration'))
ngc=next(d for o in ngc_asset.objects.values() if o.type.name=='MonoBehaviour' for d in [o.read_typetree()] if 'entries' in d)
registry={e['name']:e for e in ngc['entries']}
go_bundle=server.asset('cab-gameobject.000');ab=next(o.read_typetree() for o in go_bundle.objects.values() if o.type.name=='AssetBundle')
container={k.lower():v for k,v in ab['m_Container']}

prefabs={}
def resource_prefab(name):
    if name in prefabs:return name
    entry=registry.get(name)
    if not entry or entry['path'].lower() not in container:return None
    obj=server.resolve(go_bundle,container[entry['path'].lower()]['asset']);owner=obj.assets_file;go=obj.read_typetree();cs=server.components(owner,go)
    if 'ResourceTarget' not in cs:return None
    t=cs['Transform'][0].read_typetree();rt=cs['ResourceTarget'][0].read_typetree();ro=cs['ResourceObject'][0].read_typetree()
    renderer=cs['MeshRenderer'][0].read_typetree()
    resources=[]
    for pair in rt['resourcesAvailable']:
        key=item_by_name.get(pair['ResourceItemName'])
        if key is None:issues['unresolved resource item '+pair['ResourceItemName']]+=1
        resources.append({'item':key,'name':pair['ResourceItemName'],'amountMin':pair['amountMin'],'amountMax':pair['amountMax']})
    prefabs[name]={'name':go['m_Name'],'ngcName':name,'path':entry['path'],'source':identity(obj),'rootScale':t['m_LocalScale'],'layer':go['m_Layer'],
        'resourceTarget':{'resourcesAvailable':resources,'gatherEfficiencyMultiplier':rt['gatherEfficiencyMultiplier'],'type':rt['type']},
        'visualMeshes':[writer.mesh(server.resolve(owner,p)) for p in ro['visualMeshes']],
        'collisionMeshes':[writer.mesh(server.resolve(owner,p)) for p in ro['collisionMeshes']],
        'materials':[writer.material(server.resolve(owner,p)) for p in renderer['m_Materials']]}
    return name

# Scene GenericSpawners (OnServerLoad order is the scene object order here).
scene=server.asset('buildplayer-rust_island_2013')
gos={};transforms={}
for obj in scene.objects.values():
    if obj.type.name=='GameObject':gos[obj.path_id]=obj.read_typetree()
    elif obj.type.name=='Transform':transforms[obj.path_id]=obj.read_typetree()
go_transform={t['m_GameObject']['m_PathID']:pid for pid,t in transforms.items()}
def world(pid):return np.eye(4) if not pid else world(transforms[pid]['m_Father']['m_PathID'])@trs(transforms[pid])
def active(pid):return True if not pid else gos[transforms[pid]['m_GameObject']['m_PathID']]['m_IsActive'] and active(transforms[pid]['m_Father']['m_PathID'])
spawners=[];omissions=[]
for obj in scene.objects.values():
    if obj.type.name!='MonoBehaviour':continue
    d=obj.read_typetree()
    if server.script(obj,d)!='GenericSpawner':continue
    goid=d['m_GameObject']['m_PathID'];tid=go_transform[goid]
    if not active(tid) or not d['m_Enabled']:omissions.append({'pathID':obj.path_id,'reason':'inactive or disabled'});continue
    override=server.resolve(scene,d['spawnListObjectOverride'])
    if override is not None:
        # GenericSpawnerSpawnList.GetCopy -> Clone(), which does not copy useNavmeshSample (default true).
        od=override.read_typetree();entries=[{**s,'useNavmeshSample':1} for s in od['_spawnList']];source={'override':od['m_Name']}
    else:entries=d['_spawnList'];source={'override':None}
    spawn=[]
    for s in entries:
        name=s['prefabName'];static=name.startswith(';')
        prefab=resource_prefab(name.lstrip(';:')) if static else None
        spawn.append({'prefabName':name,'targetPopulation':s['targetPopulation'],'numToSpawnPerTick':s['numToSpawnPerTick'],'forceStaticInstantiate':bool(s['forceStaticInstantiate']),'useNavmeshSample':bool(s['useNavmeshSample']),'prefab':prefab,'ported':prefab is not None})
    spawners.append({'pathID':obj.path_id,'name':gos[goid]['m_Name'],'position':(H@world(tid))[:3,3].tolist(),'radius':d['radius'],'thinkDelay':d['thinkDelay'],'spawnList':spawn,**source})

# Client TreeUnpack: world-space tree collision meshes tagged "Tree Collider" (plus the scene's capsule trees).
client=Bundles(CLIENT,['scenes.unity3d'])
trees=client.asset('buildplayer-rust_island_2013-trees')
positions=[];indices=[];chunks=[];count=0;capsules=[];unpack=None
for obj in trees.objects.values():
    d=obj.read_typetree()
    if obj.type.name=='MonoBehaviour' and 'unpackGroups' in d:
        unpack=[{k:v for k,v in g.items() if k!='meshes'}|{'meshCount':len(g['meshes'])} for g in d['unpackGroups']]
        for g in d['unpackGroups']:
            for p in g['meshes']:
                m=client.resolve(trees,p)
                if m is None:continue
                v,_,_,parts=writer.raw_mesh(m);base=sum(len(x) for x in positions);start=sum(x.size for x in indices)
                tri=np.concatenate(parts);positions.append(v);indices.append(tri+base);count+=1
                chunks.append({'indexStart':int(start),'indexCount':int(tri.size),'bounds':[v.min(axis=0).tolist(),v.max(axis=0).tolist()]})
    elif obj.type.name=='CapsuleCollider' and d['m_Enabled'] and not d['m_IsTrigger']:
        t=transforms_t=trees.objects[next(o.path_id for o in trees.objects.values() if o.type.name=='Transform' and o.read_typetree()['m_GameObject']['m_PathID']==d['m_GameObject']['m_PathID'])].read_typetree()
        go=trees.objects[d['m_GameObject']['m_PathID']].read_typetree()
        capsules.append({'tag':go['m_Tag'],'layer':go['m_Layer'],'matrix':(H@trs(t)@H).T.ravel().tolist(),'center':[d['m_Center']['x'],d['m_Center']['y'],-d['m_Center']['z']],'radius':d['m_Radius'],'height':d['m_Height'],'direction':d['m_Direction']})
tree_colliders={'unpackGroups':unpack,'meshes':count,'position':writer.binary('trees-position.bin',np.concatenate(positions),'<f4'),'indices':writer.binary('trees-indices.bin',np.concatenate(indices),'<u4'),'chunks':chunks,'capsules':capsules,
    'note':'TreeUnpack creates one world-space MeshCollider per mesh at the origin with the group tag/layer.'}
server.sources.update(client.sources)
writer.finish({'spawners':spawners,'spawnerOmissions':omissions,'prefabs':prefabs,'treeColliders':tree_colliders,'summary':dict(issues),
    'conversion':'Spawner positions and tree collision vertices are browser space (Unity Z reflected, winding reversed). Prefab meshes are prefab-local; spawn rotation/scale are applied at runtime.'})
ported=collections.Counter(s['prefabName'] for sp in spawners for s in sp['spawnList'] if s['ported'])
pending=collections.Counter(s['prefabName'] for sp in spawners for s in sp['spawnList'] if not s['ported'])
print(json.dumps({'spawners':len(spawners),'omitted':len(omissions),'prefabs':{k:{'type':p['resourceTarget']['type'],'resources':[r['name'] for r in p['resourceTarget']['resourcesAvailable']]} for k,p in prefabs.items()},'portedEntries':ported,'pendingEntries':pending,'treeMeshes':count,'treeTriangles':int(sum(i.size for i in indices)//3),'capsules':len(capsules),'issues':dict(issues)},indent=1))
